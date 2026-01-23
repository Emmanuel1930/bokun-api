import crypto from 'crypto';

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // --- AUTH ---
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;

  const getHeaders = (method, path) => {
    const now = new Date();
    const dateStr = now.toISOString().replace(/\.\d{3}Z$/, '').replace(/T/, ' ') + 'Z';
    // Bókun-specific legacy format just in case
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    const cleanDateStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    const stringToSign = cleanDateStr + accessKey + method + path;
    const signature = crypto.createHmac('sha1', secretKey).update(stringToSign).digest('base64');

    return {
      'X-Bokun-AccessKey': accessKey,
      'X-Bokun-Date': cleanDateStr,
      'X-Bokun-Signature': signature,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  };

  const slugify = (text) => {
    if (!text) return "";
    return text.toString().toLowerCase().trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
  };

  try {
    const isUpcomingMode = req.query.mode === 'upcoming';
    
    // 1. FETCH SKELETON
    const listPath = '/product-list.json/list';
    const listResponse = await fetch(`https://api.bokun.io${listPath}`, {
      method: 'GET',
      headers: getHeaders('GET', listPath)
    });
    if (!listResponse.ok) throw new Error("Failed to fetch folder tree");
    const listData = await listResponse.json();

    // 2. DEFINE HYDRATION LOGIC
    const fetchProductsForList = async (listId) => {
        const path = `/product-list.json/${listId}`;
        const resp = await fetch(`https://api.bokun.io${path}`, {
            method: 'GET',
            headers: getHeaders('GET', path)
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.items || [];
    };

    const hydrateTree = async (nodes, onlyGroupTours = false) => {
        const promises = nodes.map(async (node) => {
            // OPTIMIZATION: If we only want upcoming, SKIP anything that isn't "Active Tours" or "Group Tours"
            if (onlyGroupTours) {
                 if (node.title === "Private Tours" || node.title === "School Trips") {
                     return node; // Skip hydrating these
                 }
            }

            if (node.children && node.children.length > 0) {
                node.children = await hydrateTree(node.children, onlyGroupTours);
            } else if (node.size > 0 && (!node.children || node.children.length === 0)) {
                // Fetch products
                const realProducts = await fetchProductsForList(node.id);
                node.children = realProducts.map(p => {
                    const productData = p.activity || p;
                    return {
                        ...productData,
                        slug: slugify(productData.title)
                    };
                });
            }
            return node;
        });
        return Promise.all(promises);
    };

    // 3. EXECUTE SMART HYDRATION
    // If upcoming mode, we pass 'true' to only hydrate Group Tours
    const hydratedData = await hydrateTree(listData, isUpcomingMode);

    // 4. STANDARD MODE RETURN
    if (!isUpcomingMode) {
        return res.status(200).json(hydratedData);
    }

    // 5. UPCOMING MODE: FAST SCAN
    if (isUpcomingMode) {
        let groupProducts = [];
        
        // Helper to find "Group Tours" specifically
        const findGroupFolder = (nodes) => {
            for (const node of nodes) {
                if (node.title === "Active Tours") return findGroupFolder(node.children);
                if (node.title === "Group Tours") return node;
            }
            return null;
        };

        const groupFolder = findGroupFolder(hydratedData);
        
        if (groupFolder) {
            // Collect all products inside Group Tours (recursively)
            const collect = (nodes) => {
                nodes.forEach(node => {
                    if (node.children && node.children.length > 0) collect(node.children);
                    else if (node.id) groupProducts.push(node);
                });
            };
            collect(groupFolder.children || []);
        }

        // Check availability ONLY for these Group Products
        const availabilityPromises = groupProducts.map(async (product) => {
            try {
                const productId = product.id; 
                if (!productId) return null;

                // Limit to 10 upcoming dates to reduce payload
                const availPath = `/activity.json/${productId}/upcoming-availabilities/10?includeSoldOut=false`;
                const availRes = await fetch(`https://api.bokun.io${availPath}`, {
                    method: 'GET',
                    headers: getHeaders('GET', availPath)
                });
                
                if (!availRes.ok) return null;
                const dates = await availRes.json();
                
                if (dates && dates.length > 0) {
                    return {
                        ...product,
                        nextDates: dates
                    };
                }
                return null;
            } catch (e) {
                return null;
            }
        });

        const productsWithDates = (await Promise.all(availabilityPromises)).filter(p => p !== null);

        // 6. EXPAND DATES (The "Elfsight" Grouping Trick)
        // Instead of returning 1 product with 5 dates, we create 1 entry PER DATE
        // This allows sorting by date in the calendar view.
        let calendarEntries = [];
        
        productsWithDates.forEach(product => {
            product.nextDates.forEach(dateEntry => {
                calendarEntries.push({
                    ...product,
                    // Overwrite the 'nextDates' array with THIS specific date for the card
                    specificDate: dateEntry.date, 
                    spotsLeft: dateEntry.availabilityCount
                });
            });
        });

        // Sort by Date
        calendarEntries.sort((a, b) => {
            return new Date(a.specificDate).getTime() - new Date(b.specificDate).getTime();
        });

        // Return the clean, flattened calendar list
        return res.status(200).json(calendarEntries);
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
