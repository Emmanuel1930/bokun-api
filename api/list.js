import crypto from 'crypto';

export default async function handler(req, res) {
  // --- CORS HEADERS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  // SPEED BOOST: Fresh for 60s, Serve Stale (Instant) for 1 Week
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

  // --- 🖼️ IMAGE OPTIMIZER (UPDATED WITH FALLBACK) ---
  // Logic: Try KeyPhoto -> Photo 1 -> Photo 2 -> Photo 3 -> Placeholder
  const getBestImage = (activity) => {
      // 1. Try Key Photo first
      let photo = activity.keyPhoto;

      // 2. If missing, try the first 3 photos in the list
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

  // ---  THE DATA STRIPPER (NEW) ---
  // This takes the HUGE product and returns only the 6 things we need.
  const simplifyProduct = (item) => {
      if (!item.activity) return item; // If it's a folder/list, keep it as is
      
      const act = item.activity;
      return {
          // Keep Identifiers
          id: act.id,
          title: act.title,
          slug: slugify(act.title),
          
          // Generate ONE image string (Delete the huge photos array)
          optimizedImage: getBestImage(act),
          
          // Keep Price (Just the number)
          price: act.nextDefaultPriceMoney?.amount || "Check Price",
          
          // Keep Duration
          durationWeeks: act.durationWeeks,
          durationDays: act.durationDays,
          durationHours: act.durationHours,
          
          // Keep Location
          location: act.googlePlace?.name || act.locationCode?.location
          
          // 🗑️ DELETED: description, photos, videos, bookingQuestions, inclusions...
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
            // Skip private folders if we are in upcoming mode (Optimization)
            if (onlyGroupTours && (node.title.includes("Private") || node.title.includes("School"))) return node; 

            if (node.children && node.children.length > 0) {
                node.children = await hydrateTree(node.children, onlyGroupTours);
            } 
            else if (node.size > 0 && (!node.children || node.children.length === 0)) {
                const realItems = await fetchProductsForList(node.id);
                
                const processedChildren = await Promise.all(realItems.map(async (item) => {
                    // 🔥 HERE IS THE MAGIC: We simplify the product IMMEDIATELY
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

    // Hydrate the tree (Now contains "Slim" products)
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
                // Since we already ran simplifyProduct, these nodes are now the slim versions
                else if (node.id && node.title) {
                    if (!uniqueProducts.has(node.id)) uniqueProducts.set(node.id, node);
                }
            });
        };
        
        if (groupFolder) collect(groupFolder.children || []);
        else collect(hydratedData); 

        // DATE RANGE: 6 Months
        const today = new Date();
        const futureDate = new Date();
        futureDate.setMonth(today.getMonth() + 6);
        // 🔥 FIX 1: Fetch from YESTERDAY
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const startStr = yesterday.toISOString().split('T')[0]; // <--- NEW (Good)
        const endStr = futureDate.toISOString().split('T')[0];
        const productsToCheck = Array.from(uniqueProducts.values());

// 🚀 OPTIMIZED FETCH: Faster chunks to beat the 10s timeout
        const results = [];
        
        while (productsToCheck.length > 0) {
            // CHANGE 1: Increase chunk size from 5 to 8 (Faster)
            const chunk = productsToCheck.splice(0, 8); 
            
            const chunkPromises = chunk.map(async (product) => {
                if (!product.id) return null;
                const availPath = `/activity.json/${product.id}/availabilities?start=${startStr}&end=${endStr}&includeSoldOut=false`;
                
                const fetchWithRetry = async (retries = 2) => {
                    try {
                        // CHANGE 2: Reduce delay from 100ms to 10ms
                        await new Promise(r => setTimeout(r, 10)); 
                        
                        const res = await fetch(`https://api.bokun.io${availPath}`, { method: 'GET', headers: getHeaders('GET', availPath) });
                        
                        if (!res.ok) {
                            if (retries > 0) {
                                // CHANGE 3: Reduce retry wait from 500ms to 200ms
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
      
        let calendarEntries = [];
        // This ensures trips stay visible until the date actually changes to tomorrow.
        const cutoffDate = new Date(); 
        cutoffDate.setHours(0,0,0,0);

        results.forEach(product => {
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
                    // optimizedImage is already in 'product' from step 3
                });
            });
        });

        calendarEntries.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        return res.status(200).json(calendarEntries);
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
}
