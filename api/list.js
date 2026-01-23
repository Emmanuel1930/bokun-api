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
    // Note: Bókun is picky about date format, sticking to the manual construction that worked previously is safer:
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

    // 2. DEFINE HYDRATION LOGIC (Fetch items inside folders)
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
                // Fetch the actual products
                const realProducts = await fetchProductsForList(node.id);
                node.children = realProducts.map(p => {
                    // Unwrap activity if needed immediately
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

    // 3. EXECUTE HYDRATION (Crucial for BOTH modes)
    // We must do this first so we actually have products to check availability on
    const hydratedData = await hydrateTree(listData);

    // 4. IF STANDARD MODE: RETURN TREE
    if (!isUpcomingMode) {
        return res.status(200).json(hydratedData);
    }

    // 5. IF UPCOMING MODE: FLATTEN & CHECK DATES
    if (isUpcomingMode) {
        let allProducts = [];
        const collect = (nodes) => {
            nodes.forEach(node => {
                if (node.children && node.children.length > 0) {
                    collect(node.children);
                } 
                // Since we hydrated, 'node' might be a Folder or a Product.
                // Products usually have an 'id' and 'title', but NOT 'children'.
                // To be safe, we check if it has an ID and NO children.
                else if (node.id && (!node.children || node.children.length === 0)) {
                    allProducts.push(node);
                }
            });
        };
        collect(hydratedData);

        // Check availability
        const availabilityPromises = allProducts.map(async (product) => {
            try {
                // Use the correct ID (some products are wrapped, but we unwrapped them in hydration)
                const productId = product.id; 
                if (!productId) return null;

                const availPath = `/activity.json/${productId}/upcoming-availabilities/5?includeSoldOut=false`;
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

        // Sort by Date
        productsWithDates.sort((a, b) => {
            return new Date(a.nextDates[0].date).getTime() - new Date(b.nextDates[0].date).getTime();
        });

        return res.status(200).json(productsWithDates);
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
