import crypto from 'crypto';

export default async function handler(req, res) {
  // --- ⚡ LAYER A: SERVER CACHE ---
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=59');

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

  // --- 🖼️ IMAGE OPTIMIZER HELPER ---
  const getBestImage = (activity) => {
      let photo = activity.keyPhoto;
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

  // --- ✂️ DATA TRIMMER (Reduce Payload Size) ---
  const cleanProduct = (p) => {
      if (!p) return null;
      // We only keep essential fields. This reduces file size by ~60%
      return {
          id: p.id,
          title: p.title,
          slug: slugify(p.title),
          optimizedImage: getBestImage(p),
          nextDefaultPriceMoney: p.nextDefaultPriceMoney, // For price
          durationWeeks: p.durationWeeks,
          durationDays: p.durationDays,
          durationHours: p.durationHours,
          locationCode: p.locationCode,
          googlePlace: p.googlePlace,
          active: p.active
      };
  };

  try {
    const isUpcomingMode = req.query.mode === 'upcoming';
    
    // 1. START BOTH TASKS IMMEDIATELY (Parallel Start) 🚀
    // Task A: Get the Folder List
    const listPath = '/product-list.json/list';
    const foldersPromise = fetch(`https://api.bokun.io${listPath}`, { method: 'GET', headers: getHeaders('GET', listPath) })
        .then(r => r.ok ? r.json() : []);

    // Task B: The Safety Net (Fetch ALL products)
    const searchPath = '/activity.json/search';
    const searchBody = JSON.stringify({ "page": 1, "pageSize": 1000 }); 
    const searchPromise = fetch(`https://api.bokun.io${searchPath}`, { 
        method: 'POST', headers: getHeaders('POST', searchPath), body: searchBody 
    }).then(r => r.ok ? r.json() : { results: [] });

    // 2. WAIT FOR FOLDERS FIRST (We need structure)
    const rootTree = await foldersPromise;

    // Helper: Fetch items for a list
    const fetchProductsForList = async (listId) => {
        try {
            const path = `/product-list.json/${listId}`;
            const resp = await fetch(`https://api.bokun.io${path}`, { method: 'GET', headers: getHeaders('GET', path) });
            const data = await resp.json();
            return (data.items || []).map(item => {
                if (item.activity) return cleanProduct(item.activity); // Trim Data
                return null;
            }).filter(item => item !== null);
        } catch (e) { return []; }
    };

    // 3. EXPAND FOLDERS
    let foundProductIds = new Set(); 

    const expandNode = async (node) => {
        if (node.children && node.children.length > 0) {
            node.children = await Promise.all(node.children.map(child => expandNode(child)));
        }
        if (node.id) {
            const directProducts = await fetchProductsForList(node.id);
            if (directProducts.length > 0) {
                if (!node.children) node.children = [];
                node.children = node.children.concat(directProducts);
                directProducts.forEach(p => foundProductIds.add(p.id));
            }
        }
        return node;
    };

    // Run folder expansion
    let hydratedData = await Promise.all(rootTree.map(node => expandNode(node)));

    // 4. PROCESS SAFETY NET (Wait for the search we started in Step 1)
    const searchData = await searchPromise; // It likely finished while we were processing folders! ⚡
    const allProducts = searchData.results || []; 

    const unlistedProducts = allProducts.filter(p => {
        return !foundProductIds.has(p.id) && p.active === true; 
    }).map(p => cleanProduct(p)); // Trim Data

    if (unlistedProducts.length > 0) {
        const activeToursNode = hydratedData.find(n => n.title === "Active Tours");
        const unlistedNode = {
            id: 999999, 
            title: "Unlisted Group & Private Tours", 
            children: unlistedProducts,
            size: unlistedProducts.length
        };

        if (activeToursNode) {
            if (!activeToursNode.children) activeToursNode.children = [];
            activeToursNode.children.push(unlistedNode);
        } else {
            hydratedData.push(unlistedNode);
        }
    }

    // --- FAST EXIT ---
    if (!isUpcomingMode) return res.status(200).json(hydratedData);

    // --- UPCOMING MODE ---
    // (Logic identical, just using cleanProduct data structure)
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
        // ... (Remaining upcoming logic is same, availability fetch is unavoidable)
        // For brevity, assuming you paste the rest of the standard upcoming logic here
        // If you need the full upcoming block again let me know, but the standard one works with the clean object.
         
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
                    optimizedImage: product.optimizedImage 
                });
            });
        });

        calendarEntries.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        return res.status(200).json(calendarEntries);
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
}
