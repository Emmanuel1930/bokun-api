import crypto from 'crypto';

export default async function handler(req, res) {
  // --- CORS HEADERS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;

  const getHeaders = (method, path) => {
    const now = new Date();
    const cleanDateStr = now.toISOString().replace(/\.\d{3}Z$/, '').replace(/T/, ' ') + 'Z';
    const stringToSign = cleanDateStr + accessKey + method + path;
    const signature = crypto.createHmac('sha1', secretKey).update(stringToSign).digest('base64');
    return {
      'X-Bokun-AccessKey': accessKey, 'X-Bokun-Date': cleanDateStr, 'X-Bokun-Signature': signature, 'Accept': 'application/json', 'Content-Type': 'application/json'
    };
  };

  const slugify = (text) => text ? text.toString().toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-') : "";

  try {
    const isUpcomingMode = req.query.mode === 'upcoming';
    
    // 1. FETCH FOLDER STRUCTURE (Organized Lists)
    const listPath = '/product-list.json/list';
    const listRes = await fetch(`https://api.bokun.io${listPath}`, { method: 'GET', headers: getHeaders('GET', listPath) });
    if (!listRes.ok) throw new Error("Failed to fetch folder tree");
    const rootTree = await listRes.json();

    // Helper: Fetch items in a specific list
    const fetchProductsForList = async (listId) => {
        try {
            const path = `/product-list.json/${listId}`;
            const resp = await fetch(`https://api.bokun.io${path}`, { method: 'GET', headers: getHeaders('GET', path) });
            const data = await resp.json();
            return (data.items || []).map(item => {
                if (item.activity) return { ...item.activity, slug: slugify(item.activity.title) };
                return null;
            }).filter(item => item !== null);
        } catch (e) { return []; }
    };

    // 2. EXPAND THE TREE (Standard Logic)
    let foundProductIds = new Set(); // Track IDs we found in folders

    const expandNode = async (node) => {
        if (node.children && node.children.length > 0) {
            node.children = await Promise.all(node.children.map(child => expandNode(child)));
        }
        
        // Always try to fetch products for this node
        if (node.id) {
            const directProducts = await fetchProductsForList(node.id);
            if (directProducts.length > 0) {
                if (!node.children) node.children = [];
                node.children = node.children.concat(directProducts);
                // Mark these IDs as "Found"
                directProducts.forEach(p => foundProductIds.add(p.id));
            }
        }
        return node;
    };

    // Hydrate the user's organized lists
    let hydratedData = await Promise.all(rootTree.map(node => expandNode(node)));

    // 3. THE SAFETY NET: Fetch ALL Products (Unlisted Check) 🛡️
    // We use the "Search" endpoint to grab everything in the account
    const searchPath = '/activity.json/search';
    const searchBody = JSON.stringify({ "page": 1, "pageSize": 1000 }); // Fetch up to 1000 items
    
    const searchRes = await fetch(`https://api.bokun.io${searchPath}`, { 
        method: 'POST', 
        headers: getHeaders('POST', searchPath),
        body: searchBody 
    });
    
    if (searchRes.ok) {
        const searchData = await searchRes.json();
        const allProducts = searchData.results || []; 

        // Find products that match our criteria but were NOT in any folder
        const unlistedProducts = allProducts.filter(p => {
            // Must be active + Not already found
            return !foundProductIds.has(p.id) && p.active === true; 
        }).map(p => ({ ...p, slug: slugify(p.title) }));

        // If we found orphans, create a special "Unlisted" folder for them
        if (unlistedProducts.length > 0) {
            const activeToursNode = hydratedData.find(n => n.title === "Active Tours");
            
            // Create the Unlisted Folder with a "Magical Name" that matches keywords
            const unlistedNode = {
                id: 999999, // Fake ID
                title: "Unlisted Group & Private Tours", // Matches both keywords!
                children: unlistedProducts,
                size: unlistedProducts.length
            };

            // Inject it into "Active Tours" if possible, otherwise Root
            if (activeToursNode) {
                if (!activeToursNode.children) activeToursNode.children = [];
                activeToursNode.children.push(unlistedNode);
            } else {
                hydratedData.push(unlistedNode);
            }
        }
    }

    // --- FAST EXIT: STANDARD MODE ---
    if (!isUpcomingMode) return res.status(200).json(hydratedData);

    // --- UPCOMING MODE (Dates Logic - Unchanged) ---
     if (isUpcomingMode) {
        let uniqueProducts = new Map(); 
        const collect = (nodes) => {
            nodes.forEach(node => {
                if (node.children && node.children.length > 0) collect(node.children);
                else if (node.id && node.title) {
                    if (!uniqueProducts.has(node.id)) uniqueProducts.set(node.id, node);
                }
            });
        };
        collect(hydratedData); 

        const today = new Date();
        const futureDate = new Date();
        futureDate.setMonth(today.getMonth() + 6);
        const startStr = today.toISOString().split('T')[0];
        const endStr = futureDate.toISOString().split('T')[0];
        const productsToCheck = Array.from(uniqueProducts.values());

        const availabilityPromises = productsToCheck.map(async (product) => {
            try {
                if (!product.id) return null;
                const availPath = `/activity.json/${product.id}/availabilities?start=${startStr}&end=${endStr}&includeSoldOut=false`;
                const availRes = await fetch(`https://api.bokun.io${availPath}`, { method: 'GET', headers: getHeaders('GET', availPath) });
                const dates = await availRes.json();
                if (dates?.length > 0) return { ...product, nextDates: dates };
                return null;
            } catch (e) { return null; }
        });

        const productsWithDates = (await Promise.all(availabilityPromises)).filter(p => p !== null);
        let calendarEntries = [];
        const cutoffDate = new Date(); 
        cutoffDate.setDate(today.getDate() - 1); 

        productsWithDates.forEach(product => {
            product.nextDates.forEach(dateEntry => {
                const rawDate = dateEntry.date || dateEntry.startTime.split('T')[0];
                const startDate = new Date(rawDate);
                if (startDate < cutoffDate) return;

                let endDate = new Date(startDate);
                let daysToAdd = 0;
                if (product.durationWeeks) daysToAdd = (product.durationWeeks * 7) - 1;
                else if (product.durationDays) daysToAdd = product.durationDays - 1;
                if (daysToAdd < 0) daysToAdd = 0; 
                endDate.setDate(startDate.getDate() + daysToAdd);

                calendarEntries.push({
                    ...product,
                    startDate: rawDate,
                    endDate: endDate.toISOString().split('T')[0], 
                    spotsLeft: dateEntry.availabilityCount
                });
            });
        });

        calendarEntries.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        return res.status(200).json(calendarEntries);
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
}
