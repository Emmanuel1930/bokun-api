import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  // --- HEADERS (We keep these for safety) ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  // No Cache for the Updater - We want it to run fresh every time!
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;

  // --- 1. HELPER FUNCTIONS (From your original code) ---
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
    .replace(/['’]/g, '-')      // Turn apostrophes into dashes
    .replace(/\s+/g, '-')       // Turn spaces into dashes
    .replace(/[^\w\-]+/g, '')   // Remove other special chars
    .replace(/\-\-+/g, '-')     // Clean up any double dashes
    : "";

  // --- 🖼️ IMAGE OPTIMIZER HELPER ---
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
    console.log("🔄 Starting Bókun Background Update...");

    // --- 2. FETCH DATA (Standard Mode Logic) ---
    // We force Standard mode here because this script fills the main cache.
    
    const listPath = '/product-list.json/list';
    const listRes = await fetch(`https://api.bokun.io${listPath}`, { method: 'GET', headers: getHeaders('GET', listPath) });
    if (!listRes.ok) throw new Error("Failed to fetch folder tree from Bókun");
    const listData = await listRes.json();

    const fetchProductsForList = async (listId) => {
        const path = `/product-list.json/${listId}`;
        const resp = await fetch(`https://api.bokun.io${path}`, { method: 'GET', headers: getHeaders('GET', path) });
        const data = await resp.json();
        return data.items || [];
    };

    const hydrateTree = async (nodes) => {
        const promises = nodes.map(async (node) => {
            // Recursively go deeper if children exist
            if (node.children && node.children.length > 0) {
                node.children = await hydrateTree(node.children);
            } 
            // If it's a List with items, fetch them!
            else if (node.size > 0 && (!node.children || node.children.length === 0)) {
                const realItems = await fetchProductsForList(node.id);
                
                // Process items (Slugify + Optimize Images)
                const processedChildren = await Promise.all(realItems.map(async (item) => {
                    if (item.activity) {
                        return { 
                            ...item.activity, 
                            slug: slugify(item.activity.title),
                            optimizedImage: getBestImage(item.activity) // Uses your helper!
                        };
                    }
                    return item; 
                }));
                node.children = processedChildren;
            }
            return node;
        });
        return Promise.all(promises);
    };

    // Run the heavy lifting...
    const hydratedData = await hydrateTree(listData);
    
    // --- 3. SAVE TO VAULT (The Important Change) 💾 ---
    // We lock the result into the database key 'bokun_tours_standard'
    await kv.set('bokun_tours_standard', hydratedData);

    console.log("✅ Data saved to Vercel KV successfully.");
    res.status(200).json({ 
        success: true, 
        message: "Database Updated Successfully! The widget will now load instantly.", 
        timestamp: new Date() 
    });

  } catch (error) { 
      console.error("❌ Update Failed:", error);
      res.status(500).json({ error: error.message }); 
  }
}
