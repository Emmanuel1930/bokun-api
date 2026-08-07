import crypto from 'crypto';

export default async function handler(req, res) {
    // --- CORS HEADERS ---
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Cache for 60s
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=604800');

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

        // 1. FETCH FOLDER STRUCTURE
        const listPath = '/product-list.json/list';
        const listRes = await fetch(`https://api.bokun.io${listPath}`, { method: 'GET', headers: getHeaders('GET', listPath) });
        if (!listRes.ok) throw new Error("Failed to fetch folder tree");
        const listData = await listRes.json();

        // --- 🔥 THE HEAVY LIFTER: FETCH ALL 55 CURRENCIES ---
        const fetchProductsMultiCurrency = async (listId) => {
            // 🌍 The Full List (55 Countries)
            const currencies = [
                'AED', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD', // GCC 6
                'EUR', 'GBP', 'CAD', 'AUD',               // Others 4
                'USD'                                     // Base
            ];

            const path = `/product-list.json/${listId}`;

            // 🚀 BATCH FETCHING (Process in chunks of 10 to avoid instant blocking)
            const results = [];
            const chunkSize = 10;

            for (let i = 0; i < currencies.length; i += chunkSize) {
                const chunk = currencies.slice(i, i + chunkSize);

                const chunkPromises = chunk.map(curr => {
                    const currPath = `${path}?currency=${curr}`;
                    return fetch(`https://api.bokun.io${currPath}`, {
                        method: 'GET',
                        headers: getHeaders('GET', currPath)
                    })
                        .then(r => r.ok ? r.json() : { items: [] }) // Handle errors gracefully
                        .then(data => ({ code: curr, items: data.items || [] }))
                        .catch(err => ({ code: curr, items: [] })); // Prevent crash on one fail
                });

                // Wait for this chunk to finish before starting the next (Safety)
                const chunkResults = await Promise.all(chunkPromises);
                results.push(...chunkResults);
            }

            // We use AED (Index 0) as the "Main" list to build the structure
            const mainList = results.find(r => r.code === 'AED')?.items || results[0].items;

            // Merge the prices into the main items
            return mainList.map(item => {
                if (!item.activity) return item;

                const act = item.activity;
                const allPrices = {};

                // Loop through results and grab the price for this product ID
                results.forEach(res => {
                    const match = res.items.find(i => i.activity && i.activity.id === act.id);
                    if (match && match.activity.nextDefaultPriceMoney) {
                        // 🎯 This is the EXACT Bókun Price (No Math)
                        allPrices[res.code] = match.activity.nextDefaultPriceMoney.amount;
                    }
                });

                // Return the enriched item
                return {
                    ...item,
                    activity: {
                        ...act,
                        allPrices: allPrices // 🌍 { AED: 9500, USD: 2660, GBP: 1960... }
                    }
                };
            });
        };

        // --- RECURSIVE HYDRATION ---
        const hydrateTree = async (nodes, onlyGroupTours = false) => {
            const promises = nodes.map(async (node) => {
                if (onlyGroupTours && (node.title.includes("Private") || node.title.includes("School"))) return node;

                if (node.children && node.children.length > 0) {
                    node.children = await hydrateTree(node.children, onlyGroupTours);
                }
                else if (node.size > 0 && (!node.children || node.children.length === 0)) {

                    // 🔥 CALL THE HEAVY LIFTER
                    const realItems = await fetchProductsMultiCurrency(node.id);

                    const processedChildren = realItems.map((item) => {
                        if (item.activity) {
                            const act = item.activity;
                            return {
                                id: act.id,
                                title: act.title,
                                slug: slugify(act.title),
                                optimizedImage: getBestImage(act),
                                price: act.nextDefaultPriceMoney?.amount || 0,
                                currency: act.nextDefaultPriceMoney?.currency || 'AED',
                                allPrices: act.allPrices, // ✅ Contains REAL API PRICES
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
            // Every date and time here is resolved in the OPERATOR's timezone (UAE),
            // never the server's. Vercel runs in UTC, so without this the calendar
            // shifts by a day for anything happening in the first 4 hours of a UAE day.
            const OPERATOR_TIMEZONE = 'Asia/Dubai';

            const operatorDateStr = (date) => new Intl.DateTimeFormat('en-CA', {
                timeZone: OPERATOR_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
            }).format(date); // -> "YYYY-MM-DD"

            const operatorTimeStr = (date) => new Intl.DateTimeFormat('en-GB', {
                timeZone: OPERATOR_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
            }).format(date); // -> "HH:mm"

            const nowUtc = new Date();
            const futureDate = new Date(nowUtc);
            futureDate.setMonth(nowUtc.getMonth() + 6);
            const yesterday = new Date(nowUtc);
            yesterday.setDate(nowUtc.getDate() - 1);
            const startStr = operatorDateStr(yesterday);
            const endStr = operatorDateStr(futureDate);
            const productsToCheck = Array.from(uniqueProducts.values());

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
                                if (retries > 0) { await new Promise(r => setTimeout(r, 200)); return fetchWithRetry(retries - 1); }
                                return null;
                            }
                            return res.json();
                        } catch (e) { if (retries > 0) return fetchWithRetry(retries - 1); return null; }
                    };

                    const dates = await fetchWithRetry();
                    if (dates?.length > 0) return { ...product, nextDates: dates };
                    return null;
                });
                const chunkResults = await Promise.all(chunkPromises);
                results.push(...chunkResults.filter(p => p !== null));
            }

            let calendarEntries = [];

            // --- OVERNIGHT TRAVEL PRODUCTS ---
            // Bókun stores ONE duration per product, but Salalah sells both a morning and
            // an evening departure. The evening one travels out overnight, so it spans one
            // more calendar day than the stored duration.
            //
            // Scoped by Bókun product ID so it can NEVER leak onto another product — not
            // even a future "Salalah Day Trip", which a title match would have caught.
            // 782352 = Salalah's Khareef: Waterfalls & Greenery. Add IDs here to extend.
            const OVERNIGHT_TRAVEL_PRODUCT_IDS = [782352];
            const EVENING_DEPARTURE_HOUR = 12; // operator (UAE) local time

            // Same cut-off the API was queried with: yesterday, in the operator's timezone.
            const cutoffStr = startStr;

            results.forEach(product => {
                if (!product.nextDates) return;
                product.nextDates.forEach(dateEntry => {
                    let rawDate = dateEntry.date;
                    if (!rawDate && dateEntry.startTime && String(dateEntry.startTime).includes('T')) rawDate = dateEntry.startTime;
                    if (!rawDate) return;

                    // Bókun may send an epoch number or an ISO string; normalise both to the
                    // operator's calendar date so the day never shifts under UTC.
                    rawDate = typeof rawDate === 'number'
                        ? operatorDateStr(new Date(rawDate))
                        : String(rawDate).split('T')[0];

                    // YYYY-MM-DD strings compare correctly as strings — no Date parsing needed.
                    if (rawDate < cutoffStr) return;

                    // Calendar arithmetic only: anchor at UTC midnight and stay in UTC, so
                    // adding days is pure day-counting with no timezone drift.
                    const startDate = new Date(`${rawDate}T00:00:00Z`);
                    let endDate = new Date(startDate);
                    let daysToAdd = 0;
                    if (product.durationWeeks) daysToAdd = (product.durationWeeks * 7) - 1;
                    else if (product.durationDays) daysToAdd = product.durationDays - 1;

                    // --- EVENING DEPARTURE: spans one extra calendar day ---
                    // The extra day comes from the departure TIME, not the weekday. A product
                    // can sell a morning and an evening departure on the SAME date; only the
                    // evening one runs a day longer.
                    const rawStartTime = dateEntry.startTime == null ? '' : String(dateEntry.startTime);
                    // The clock time can arrive as a plain "HH:mm", as a full timestamp in
                    // startTime, or only inside the date field. Cover all three, otherwise
                    // the time is lost and an evening departure is silently treated as morning.
                    const timestamp = rawStartTime.includes('T')
                        ? rawStartTime
                        : (typeof dateEntry.date === 'string' && dateEntry.date.includes('T') ? dateEntry.date : '');

                    let departureTime = '';
                    if (timestamp) {
                        // Bókun reports availability in the OPERATOR's local time. Only convert
                        // when the value actually carries a zone (Z or +04:00) — a bare
                        // "2026-08-21T19:00:00" is already operator-local and must be read
                        // literally, or Node would parse it as server time and shift it.
                        const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp);
                        const stamp = hasZone ? new Date(timestamp) : null;
                        departureTime = (stamp && !isNaN(stamp.getTime()))
                            ? operatorTimeStr(stamp)
                            : timestamp.split('T')[1].slice(0, 5);
                    } else if (rawStartTime) {
                        departureTime = rawStartTime; // already operator-local, e.g. "19:00"
                    }

                    const startHour = parseInt(departureTime.split(':')[0], 10);
                    const isEveningDeparture = Number.isFinite(startHour) && startHour >= EVENING_DEPARTURE_HOUR;

                    const travelsOvernight = OVERNIGHT_TRAVEL_PRODUCT_IDS.includes(Number(product.id));

                    let displayDurationDays = product.durationDays || 0;
                    if (travelsOvernight && isEveningDeparture) {
                        daysToAdd += 1;
                        displayDurationDays += 1;
                    }

                    if (daysToAdd < 0) daysToAdd = 0;
                    endDate.setUTCDate(startDate.getUTCDate() + daysToAdd);

                    calendarEntries.push({
                        ...product,
                        // Unique per departure, so two start times on the same date are not
                        // mistaken for duplicates by the front-end.
                        departureKey: `${product.id}|${rawDate}|${departureTime || 'na'}`,
                        departureTime: departureTime || null,
                        durationDays: displayDurationDays,
                        startDate: rawDate,
                        endDate: endDate.toISOString().split('T')[0],
                        spotsLeft: dateEntry.availabilityCount,
                        dateSpecificPrice: product.price
                    });
                });
            });

            calendarEntries.sort((a, b) => {
                const diff = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
                if (diff !== 0) return diff;
                // Same date: order by departure time so the morning trip lists first.
                return (a.departureTime || '').localeCompare(b.departureTime || '');
            });
            return res.status(200).json(calendarEntries);
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
}
