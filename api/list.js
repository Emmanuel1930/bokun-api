import crypto from 'crypto';

export default async function handler(req, res) {
  // --- 1. ENABLE CORS (The "Universal" Pass) ---
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

  // --- 2. SETUP AUTH ---
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;

  const getHeaders = (method, path) => {
    const now = new Date();
    // Bókun requires this specific format
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

  // --- HELPER: Slugify (Matches your other widget) ---
  const slugify = (text) => {
    if (!text) return "";
    return text.toString().toLowerCase().trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
  };

  try {
    // Check if we specifically want "Upcoming" logic
    const isUpcomingMode = req.query.mode === 'upcoming';
    
    // 1. Fetch the Master Structure (Folders & Products)
    const listPath = '/product-list.json/list';
    const listResponse = await fetch(`https://api.bokun.io${listPath}`, {
      method: 'GET',
      headers: getHeaders('GET', listPath)
    });

    if (!listResponse.ok) throw new Error("Failed to fetch product list");
    const listData = await listResponse.json();

    // If we just want the Folders (Group/Private/Countries), return the clean tree now
    if (!isUpcomingMode) {
       // We enrich it slightly with slugs before sending
       const enrichNode = (node) => {
           if (node.children) node.children = node.children.map(enrichNode);
           node.slug = slugify(node.title);
           return node;
       };
       const enrichedData = listData.map(enrichNode);
       return res.status(200).json(enrichedData);
    }

    // --- UPCOMING MODE LOGIC ---
    // We need to flatten the tree to find ALL tours, then check their dates.
    
    let allProducts = [];
    const collectProducts = (node) => {
        // If it has children (folders), dig deeper
        if (node.children && node.children.length > 0) {
            node.children.forEach(collectProducts);
        } 
        // If it has a keyPhoto, it's likely a real product we can display
        else if (node.keyPhoto) {
            allProducts.push(node);
        }
    };
    listData.forEach(collectProducts);

    // Now, fetch availability for these products (Limit to avoid timeout)
    // We check the next 60 days
    const today = new Date();
    const nextMonth = new Date();
    nextMonth.setDate(today.getDate() + 60);

    const upcomingPromises = allProducts.map(async (product) => {
        try {
            // "10" is the max dates to return per product
            const availPath = `/activity.json/${product.id}/upcoming-availabilities/10?includeSoldOut=false`;
            const availRes = await fetch(`https://api.bokun.io${availPath}`, {
                method: 'GET',
                headers: getHeaders('GET', availPath)
            });
            
            if (!availRes.ok) return null;
            const dates = await availRes.json();
            
            if (dates.length > 0) {
                return {
                    ...product,
                    slug: slugify(product.title),
                    nextDates: dates // This array contains { date: "2026-01-24", spots: 5 }
                };
            }
            return null; // No upcoming dates
        } catch (e) {
            return null;
        }
    });

    const productsWithDates = (await Promise.all(upcomingPromises)).filter(p => p !== null);

    // Sort by the SOONEST date
    productsWithDates.sort((a, b) => {
        return new Date(a.nextDates[0].date).getTime() - new Date(b.nextDates[0].date).getTime();
    });

    res.status(200).json(productsWithDates);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}