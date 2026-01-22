import crypto from 'crypto';

export default async function handler(req, res) {
  // --- 1. ENABLE CORS ---
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

  // --- 2. AUTH SETUP ---
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;

  const getHeaders = (method, path) => {
    const now = new Date();
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

  const slugify = (text) => {
    if (!text) return "";
    return text.toString().toLowerCase().trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
  };

  try {
    const isUpcomingMode = req.query.mode === 'upcoming';
    
    // STEP 1: Fetch the Skeleton (Folders)
    const listPath = '/product-list.json/list';
    const listResponse = await fetch(`https://api.bokun.io${listPath}`, {
      method: 'GET',
      headers: getHeaders('GET', listPath)
    });

    if (!listResponse.ok) throw new Error("Failed to fetch folder tree");
    const listData = await listResponse.json();

    // If Upcoming Mode, logic remains similar (flatten & search dates)
    if (isUpcomingMode) {
        // ... (Keep your upcoming logic or ask me to paste it back if needed)
        // For now, let's focus on fixing the Grid view
    }

    // STEP 2: HYDRATE THE FOLDERS (The Fix)
    // We need to dig into "Active Tours" -> "Group/Private" -> "Countries" 
    // and fetch the actual products for each Country.

    // Helper to fetch products for a specific list ID
    const fetchProductsForList = async (listId) => {
        const path = `/product-list.json/${listId}`;
        const resp = await fetch(`https://api.bokun.io${path}`, {
            method: 'GET',
            headers: getHeaders('GET', path)
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.items || []; // The products are usually in 'items'
    };

    // Recursive function to find Country folders and fill them
    const hydrateTree = async (nodes) => {
        const promises = nodes.map(async (node) => {
            // Logic: If a node has "size > 0" but "children" is empty, it's likely a Product List we need to fetch.
            // However, Active Tours/Group Tours are folders of folders. 
            // Socotra is a folder of PRODUCTS.
            
            // We assume Level 3 (Country) is where we need to fetch.
            // But to be safe, if we see a node with no children but size > 0, we check it.
            
            // Let's rely on structure: Active Tours -> Group/Private -> [Hydrate These]
            
            if (node.children && node.children.length > 0) {
                // It's a folder of folders (like "Group Tours"), recurse down
                node.children = await hydrateTree(node.children);
            } else if (node.size > 0 && (!node.children || node.children.length === 0)) {
                // 🚨 FOUND EMPTY FOLDER WITH ITEMS! (e.g. Socotra)
                // Fetch the actual products now.
                const realProducts = await fetchProductsForList(node.id);
                // Attach them as children so the frontend sees them
                node.children = realProducts.map(p => ({
                    ...p,
                    slug: slugify(p.title)
                }));
            }
            
            node.slug = slugify(node.title);
            return node;
        });

        return Promise.all(promises);
    };

    const hydratedData = await hydrateTree(listData);

    res.status(200).json(hydratedData);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}