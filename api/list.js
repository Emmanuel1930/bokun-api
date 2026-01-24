import crypto from 'crypto';

export default async function handler(req, res) {
  // --- ⚡ LAYER A: SERVER CACHE (1 HOUR) ---
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

  // --- ✂️ DATA TRIMMER ---
  const cleanProduct = (p) => {
      if (!p) return null;
      return {
          id: p.id,
          title: p.title,
          slug: slugify(p.title),
          optimizedImage: getBestImage(p),
          nextDefaultPriceMoney: p.nextDefaultPriceMoney, 
          durationWeeks: p.durationWeeks,
          durationDays: p.durationDays,
          durationHours: p.durationHours,
          locationCode: p.locationCode,
          googlePlace: p.googlePlace,
          active: p.active,
          startDate: p.startDate,
          endDate: p.endDate 
      };
  };

  try {
    const isUpcomingMode = req.query.mode === 'upcoming';
    
    // 1. FETCH FOLDER STRUCTURE ONLY 📂
    // We strictly fetch the list. We DO NOT search for unlisted items anymore.
    const listPath = '/product-list.json/list';
    const listRes = await fetch(`https://api.bokun.io${listPath}`, { method: 'GET', headers: getHeaders('GET', listPath) });
    
    if (!listRes.ok) throw new Error("Failed to fetch folder tree");
    const rootTree = await listRes.json();

    // Helper: Fetch items for a list
    const fetchProductsForList = async (listId) => {
        try {
            const path = `/product-list.json/${listId}`;
            const resp = await fetch(`https://api.bokun.io${path}`, { method: 'GET', headers: getHeaders('GET', path) });
            const data = await resp.json();
            return (data.items || []).map(item => {
                if (item.activity) return cleanProduct(item.activity); 
                return null;
            }).filter(item => item !== null);
        } catch (e) { return []; }
    };

    // 2. EXPAND FOLDERS 🌲
    const expandNode = async (node) => {
        if (node.children && node.children.length > 0) {
            node.children = await Promise.all(node.children.map(child => expandNode(child)));
        }
        if (node.id) {
            const directProducts = await fetchProductsForList(node.id);
            if (directProducts.length > 0) {
                if (!node.children) node.children = [];
                node.children = node.children.concat(directProducts);
            }
        }
        return node;
    };

    // Run folder expansion
    let hydratedData = await Promise.all(rootTree.map(node => expandNode(node)));

    // ❌ DELETED: The "Safety Net" Search block is completely gone.
    // The API now strictly returns ONLY what is in your Bókun folders.

    // --- RETURN DATA ---
    if (!isUpcomingMode) return res.status(200).json(hydratedData);

    // --- UPCOMING MODE ---
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
