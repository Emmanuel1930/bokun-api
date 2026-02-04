import crypto from 'crypto';

export default async function handler(req, res) {
  // --- CORS HEADERS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  // SPEED BOOST: Cache for 60s
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=604800');
  
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

  const slugify = (text) => text ? text.toString().toLowerCase().trim()
    .replace(/['’]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-') : "";

  // --- 🖼️ IMAGE OPTIMIZER ---
  const getBestImage = (activity) => {
      let photo = activity.keyPhoto;
      if (!photo && activity.photos && activity.photos.length > 0) {
          photo = activity.photos[0] || activity.photos[1] || activity.photos[2];
      }
      
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

  // --- DATA STRIPPER ---
  const simplifyProduct = (item) => {
      if (!item.activity) return item; 
      
      const act = item.activity;
      return {
          id: act.id,
          title: act.title,
          slug: slugify(act.title),
          optimizedImage: getBestImage(act),
          price: act.nextDefaultPriceMoney?.amount || "Check Price",
          durationWeeks: act.durationWeeks,
          durationDays: act.durationDays,
          durationHours: act.durationHours,
          location: act.googlePlace?.name || act.locationCode?.location
      };
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

    // 3. RECURSIVE HYDRATION
    const hydrateTree = async (nodes, onlyGroupTours = false) => {
        const promises = nodes.map(async (node) => {
            if (onlyGroupTours && (node.title.includes("Private") || node.title.includes("School"))) return node; 

            if (node.children && node.children.length > 0) {
                node.children = await hydrateTree(node.children, onlyGroupTours);
            } 
            else if (node.size > 0 && (!node.children || node.children.length === 0)) {
                const realItems = await fetchProductsForList(node.id);
                const processedChildren = await Promise.all(realItems.map(async (item) => {
                    if (item.activity) {
                        return simplifyProduct(item);
                    }
                    return item; 
                }));
                node.children = processedChildren;
            }
            return node;
        });
        return Promise.all(promises);
    };

    const hydratedData = await hydrateTree(listData, isUpcomingMode);
    
    // --- FAST EXIT: STANDARD MODE ---
    if (!isUpcomingMode) return res.status(200).json(hydratedData);

    // --- UPCOMING MODE ONLY ---
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
        
        const collect = (nodes) => {
            nodes.forEach(node => {
                if (node.children && node.children.length > 0) collect(node.children);
                else if (node.id && node.title) {
                    if (!uniqueProducts.has(node.id)) uniqueProducts.set(node.id, node);
                }
            });
        };
        
        if (groupFolder) collect(groupFolder.children || []);
        else collect(hydratedData); 

        // DATE RANGE
        const today = new Date();
        const futureDate = new Date();
        futureDate.setMonth(today.getMonth() + 6);
        
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const startStr = yesterday.toISOString().split('T')[0];
        const endStr = futureDate.toISOString().split('T')[0];
        const productsToCheck = Array.from(uniqueProducts.values());

        // 🚀 OPTIMIZED FETCH
        const results = [];
        
        while (productsToCheck.length > 0) {
            const chunk = productsToCheck.splice(0, 8); 
            
            const chunkPromises = chunk.map(async (product) => {
                if (!product.id) return null;
                const availPath = `/activity.json/${product.id}/availabilities?start=${startStr}&end=${endStr}&includeSoldOut=false`;
                
                const fetchWithRetry = async (retries = 2) => {
                    try {
                        await new Promise(r => setTimeout(r, 10)); 
                        const res = await fetch(`https://api.bokun.io${availPath}`, { method: 'GET', headers: getHeaders('GET', availPath) });
                        if (!res.ok) {
                            if (retries > 0) {
                                await new Promise(r => setTimeout(r, 200));
                                return fetchWithRetry(retries - 1); 
                            }
                            return null;
                        }
                        return res.json();
                    } catch (e) {
                        if (retries > 0) return fetchWithRetry(retries - 1);
                        return null;
                    }
                };

                const dates = await fetchWithRetry();
                if (dates?.length > 0) return { ...product, nextDates: dates };
                return null;
            });
            
            const chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults.filter(p => p !== null));
        }
       
        // --- 3. FLATTEN & PROCESS DATES (Clean Version) ---
        let calendarEntries = [];
        const cutoffDate = new Date(); 
        cutoffDate.setDate(cutoffDate.getDate() - 1); // Yesterday
        cutoffDate.setHours(0,0,0,0);

        results.forEach(product => {
            if (!product.nextDates) return;

            product.nextDates.forEach(dateEntry => {
                // 🛑 SAFETY FIX: Prevents 500 Error on Bad Dates
                let rawDate = dateEntry.date;
                // If no date timestamp, try parsing startTime (only if it has 'T')
                if (!rawDate && dateEntry.startTime && dateEntry.startTime.includes('T')) {
                     rawDate = dateEntry.startTime.split('T')[0];
                }

                if (!rawDate) return; // Skip if date is invalid

                const startDate = new Date(rawDate);
                if (startDate < cutoffDate) return;

                let endDate = new Date(startDate);
                let daysToAdd = 0;
                if (product.durationWeeks) daysToAdd = (product.durationWeeks * 7) - 1;
                else if (product.durationDays) daysToAdd = product.durationDays - 1;
                if (daysToAdd < 0) daysToAdd = 0; 
                endDate.setDate(startDate.getDate() + daysToAdd);

                // No Smart Math: Just use the product's base price
                let finalPrice = product.price;

                calendarEntries.push({
                    ...product,
                    startDate: rawDate,
                    endDate: endDate.toISOString().split('T')[0], 
                    spotsLeft: dateEntry.availabilityCount,
                    dateSpecificPrice: finalPrice // Standard "From" Price
                });
            });
        });

        calendarEntries.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        return res.status(200).json(calendarEntries);
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
}
