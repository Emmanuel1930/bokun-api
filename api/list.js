import crypto from 'crypto';

export default async function handler(req, res) {
  // --- CORS HEADERS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  // 🔥 SPEED BOOST: Fresh for 60s, Serve Stale (Instant) for 1 Week
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=800');
  
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

  // UPDATED SLUGIFY: Handles apostrophes, special chars, and double dashes perfectly
const slugify = (text) => text ? text.toString().toLowerCase().trim()
    .replace(/['’]/g, '-')      // Turn apostrophes into dashes
    .replace(/\s+/g, '-')       // Turn spaces into dashes
    .replace(/[^\w\-]+/g, '')   // Remove other special chars
    .replace(/\-\-+/g, '-')     // Clean up any double dashes
    : "";

  // --- 🖼️ IMAGE OPTIMIZER HELPER (ADDED) ---
  const getBestImage = (activity) => {
      let photo = activity.keyPhoto;
      // Fallback: If keyPhoto is missing, use the first photo in the list
      if (!photo && activity.photos && activity.photos.length > 0) photo = activity.photos[0]; 
      
      if (!photo) return 'https://via.placeholder.com/600x400?text=No+Image';

      if (photo.derived) {
          const large = photo.derived.find(d => d.name === 'large');
          if (large) return large.cleanUrl;
          const preview = photo.derived.find(d => d.name === 'preview');
          if (preview) return preview.cleanUrl;
      }
      const baseUrl = photo.cleanUrl || photo.originalUrl;
      return baseUrl.includes('?') ? `${baseUrl}&w=600` : `${baseUrl}?w=600`;
  };

  try {
    const isUpcomingMode = req.query.mode === 'upcoming';
    
    // 1. FETCH FOLDER STRUCTURE
    const listPath = '/product-list.json/list';
    const listRes = await fetch(`https://api.bokun.io${listPath}`, { method: 'GET', headers: getHeaders('GET', listPath) });
    if (!listRes.ok) throw new Error("Failed to fetch folder tree");
    const listData = await listRes.json();

    
    // 2. FETCH LIST ITEMS
    const fetchProductsForList = async (listId) => {
        const path = `/product-list.json/${listId}`;
        const resp = await fetch(`https://api.bokun.io${path}`, { method: 'GET', headers: getHeaders('GET', path) });
        const data = await resp.json();
        return data.items || [];
    };

    // 3. RECURSIVE HYDRATION (The "Deep Digger")
    const hydrateTree = async (nodes, onlyGroupTours = false) => {
        const promises = nodes.map(async (node) => {
            // OPTIMIZATION: In Upcoming Mode, skip Private/School folders to save time
            if (onlyGroupTours && (node.title.includes("Private") || node.title.includes("School"))) return node; 

            // If it has children already (Sub-lists from root)
            if (node.children && node.children.length > 0) {
                node.children = await hydrateTree(node.children, onlyGroupTours);
            } 
            // If it's a List but empty children, Fetch it!
            else if (node.size > 0 && (!node.children || node.children.length === 0)) {
                const realItems = await fetchProductsForList(node.id);
                
                // CRITICAL: Check if these items are PRODUCTS or MORE SUB-LISTS
                const processedChildren = await Promise.all(realItems.map(async (item) => {
                    // Case A: It's a Product
                    if (item.activity) {
                        return { 
                            ...item.activity, 
                            slug: slugify(item.activity.title),
                            optimizedImage: getBestImage(item.activity) // <--- ADDED THIS LINE
                        };
                    }
                    // Case B: It might be a sub-list
                    return item; 
                }));
                node.children = processedChildren;
            }
            return node;
        });
        return Promise.all(promises);
    };

    // Hydrate the whole tree structure
    const hydratedData = await hydrateTree(listData, isUpcomingMode);
    
    // --- FAST EXIT: STANDARD MODE ---
    if (!isUpcomingMode) return res.status(200).json(hydratedData);


    // --- UPCOMING MODE ONLY (Date Checks) ---
    if (isUpcomingMode) {
        let uniqueProducts = new Map(); 
        
        const findGroupFolder = (nodes) => {
            for (const node of nodes) {
                if (node.title === "Active Tours") return findGroupFolder(node.children);
                if (node.title === "Group Tours") return node;
            }
            return null;
        };
        const groupFolder = findGroupFolder(hydratedData);
        
        // Flatten the tree to find products
        const collect = (nodes) => {
            nodes.forEach(node => {
                if (node.children && node.children.length > 0) collect(node.children);
                else if (node.id) {
                    if (!uniqueProducts.has(node.id)) uniqueProducts.set(node.id, node);
                }
            });
        };
        
        if (groupFolder) collect(groupFolder.children || []);
        else collect(hydratedData); 

        // DATE RANGE: 6 Months (Kept safe for speed)
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
                    spotsLeft: dateEntry.availabilityCount,
                    optimizedImage: product.optimizedImage // <--- ADDED THIS LINE (for upcoming)
                });
            });
        });

        calendarEntries.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        return res.status(200).json(calendarEntries);
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
}
