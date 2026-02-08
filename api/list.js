import crypto from 'crypto';

export default async function handler(req, res) {
  // --- CORS HEADERS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  // Cache for 60s
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

  try {
    const isUpcomingMode = req.query.mode === 'upcoming';
    
    // 🔥 STEP 1: PARALLEL FETCH (Products + ALL Rates)
    const listPath = '/product-list.json/list';
    const currencyPath = '/currency.json/findAll';

    const [listRes, currencyRes] = await Promise.all([
        fetch(`https://api.bokun.io${listPath}`, { method: 'GET', headers: getHeaders('GET', listPath) }),
        fetch(`https://api.bokun.io${currencyPath}`, { method: 'GET', headers: getHeaders('GET', currencyPath) })
    ]);

    if (!listRes.ok) throw new Error("Failed to fetch folder tree");
    
    const listData = await listRes.json();
    const currencyData = await currencyRes.ok ? await currencyRes.json() : [];

    // 🔥 STEP 2: BUILD RATES MAP
    // We Map ALL currencies from the API response
    const ratesMap = {};
    currencyData.forEach(c => {
        if (c.code && c.rate) {
            ratesMap[c.code] = c.rate;
        }
    });

    // 🧮 PRECISE CONVERTER (No Early Rounding)
    const convertPrice = (amount, fromCurrency, toCurrency) => {
        if (!amount || !ratesMap[fromCurrency] || !ratesMap[toCurrency]) return null;
        
        // 1. Convert to Base (ISK)
        // Formula: Amount / Rate = Value in ISK
        const valueInBase = amount / ratesMap[fromCurrency];
        
        // 2. Convert to Target
        // Formula: Value in ISK * Target Rate
        const converted = valueInBase * ratesMap[toCurrency];
        
        // 3. Final Rounding (Standard Math.round to match most displays)
        return Math.round(converted); 
    };

    // --- FETCH LIST ITEMS ---
    const fetchProductsForList = async (listId) => {
        const path = `/product-list.json/${listId}`;
        const resp = await fetch(`https://api.bokun.io${path}`, { method: 'GET', headers: getHeaders('GET', path) });
        const data = await resp.json();
        return data.items || [];
    };

    // --- RECURSIVE HYDRATION ---
    const hydrateTree = async (nodes, onlyGroupTours = false) => {
        const promises = nodes.map(async (node) => {
            if (onlyGroupTours && (node.title.includes("Private") || node.title.includes("School"))) return node; 

            if (node.children && node.children.length > 0) {
                node.children = await hydrateTree(node.children, onlyGroupTours);
            } 
            else if (node.size > 0 && (!node.children || node.children.length === 0)) {
                const realItems = await fetchProductsForList(node.id);
                const processedChildren = realItems.map((item) => {
                    if (item.activity) {
                        const act = item.activity;
                        const basePrice = act.nextDefaultPriceMoney?.amount || 0;
                        const baseCurrency = act.nextDefaultPriceMoney?.currency || 'AED';

                        // 🔥 GENERATE ALL PRICES (The Full List)
                        // We start with the base price
                        const allPrices = { [baseCurrency]: basePrice };
                        
                        // Loop through EVERY currency found in Bokun's system
                        Object.keys(ratesMap).forEach(targetCode => {
                            if (targetCode !== baseCurrency) {
                                const newPrice = convertPrice(basePrice, baseCurrency, targetCode);
                                if (newPrice !== null) {
                                    allPrices[targetCode] = newPrice;
                                }
                            }
                        });

                        return {
                            id: act.id,
                            title: act.title,
                            slug: slugify(act.title),
                            optimizedImage: getBestImage(act),
                            price: basePrice,
                            currency: baseCurrency,
                            allPrices: allPrices, // 🌍 Contains exact math for ALL currencies
                            durationWeeks: act.durationWeeks,
                            durationDays: act.durationDays,
                            durationHours: act.durationHours,
                            location: act.googlePlace?.name || act.locationCode?.location
                        };
                    }
                    return item; 
                });
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
       
        // --- 3. FLATTEN & PROCESS DATES ---
        let calendarEntries = [];
        const cutoffDate = new Date(); 
        cutoffDate.setDate(cutoffDate.getDate() - 1); 
        cutoffDate.setHours(0,0,0,0);

        results.forEach(product => {
            if (!product.nextDates) return;

            product.nextDates.forEach(dateEntry => {
                let rawDate = dateEntry.date;
                if (!rawDate && dateEntry.startTime && dateEntry.startTime.includes('T')) {
                     rawDate = dateEntry.startTime.split('T')[0];
                }
                if (!rawDate) return; 

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
                    dateSpecificPrice: product.price 
                });
            });
        });

        calendarEntries.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        return res.status(200).json(calendarEntries);
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
}
