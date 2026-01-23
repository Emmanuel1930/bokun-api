import crypto from 'crypto';

export default async function handler(req, res) {
  // --- 1. ENABLE CORS ---
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

  // --- 2. AUTH SETUP ---
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;

  const getHeaders = (method, path) => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    const stringToSign = dateStr + accessKey + method + path;
    const signature = crypto.createHmac('sha1', secretKey).update(stringToSign).digest('base64');

    return {
      'X-Bokun-AccessKey': accessKey,
      'X-Bokun-Date': dateStr,
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
    
    // FETCH ROOT LIST
    const listPath = '/product-list.json/list';
    const listResponse = await fetch(`https://api.bokun.io${listPath}`, {
      method: 'GET',
      headers: getHeaders('GET', listPath)
    });

    if (!listResponse.ok) throw new Error("Failed to fetch folder tree");
    const listData = await listResponse.json();

    // ==========================================
    //  MODE A: UPCOMING TRIPS (Calendar Logic)
    // ==========================================
    if (isUpcomingMode) {
        // 1. Flatten the tree to find ALL products inside all folders
        let allProducts = [];
        
        // Recursive function to extract products from folders
        const collectProducts = (nodes) => {
            nodes.forEach(node => {
                if (node.children && node.children.length > 0) {
                    collectProducts(node.children);
                } 
                // If it has a keyPhoto or an ID, we assume it might be a product
                if (node.id && !node.children) {
                    allProducts.push(node);
                }
            });
        };
        collectProducts(listData);

        // 2. Check Availability for EVERY product found
        // We limit to the next 90 days to keep it fast
        const today = new Date();
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + 90);
        
        // To prevent timeouts, we process in chunks or just Promise.all
        const availabilityPromises = allProducts.map(async (product) => {
            try {
                // Fetch next 5 available dates
                const availPath = `/activity.json/${product.id}/upcoming-availabilities/5?includeSoldOut=false`;
                const availRes = await fetch(`https://api.bokun.io${availPath}`, {
                    method: 'GET',
                    headers: getHeaders('GET', availPath)
                });
                
                if (!availRes.ok) return null;
                const dates = await availRes.json();
                
                if (dates && dates.length > 0) {
                    // It has dates! Return the product + the dates
                    return {
                        ...product,
                        slug: slugify(product.title),
                        nextDates: dates // Array of { date: "2026-01-24", spots: 5 }
                    };
                }
                return null; 
            } catch (e) {
                return null;
            }
        });

        // Wait for all checks to finish
        const productsWithDates = (await Promise.all(availabilityPromises)).filter(p => p !== null);

        // 3. Sort by the SOONEST date
        productsWithDates.sort((a, b) => {
            return new Date(a.nextDates[0].date).getTime() - new Date(b.nextDates[0].date).getTime();
        });

        return res.status(200).json(productsWithDates);
    }

    // ==========================================
    //  MODE B: STANDARD FOLDERS (Hydration Logic)
    // ==========================================
    
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

    const hydrateTree = async (nodes) => {
        const promises = nodes.map(async (node) => {
            if (node.children && node.children.length > 0) {
                node.children = await hydrateTree(node.children);
            } else if (node.size > 0 && (!node.children || node.children.length === 0)) {
                // Fetch missing products for this folder
                const realProducts = await fetchProductsForList(node.id);
                node.children = realProducts.map(p => ({
                    ...p,
                    slug: slugify(p.title)
                }));
            }
            node.slug = slugify(node.title);
            return node;
        });
        return Promise.all(promises);
    };

    const hydratedData = await hydrateTree(listData);
    res.status(200).json(hydratedData);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
