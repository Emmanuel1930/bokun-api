import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;

  // --- HELPER FUNCTIONS ---
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
      if (!photo && activity.photos && activity.photos.length > 0) photo = activity.photos[0]; 
      if (!photo) return 'https://via.placeholder.com/600x400?text=No+Image';
      if (photo.derived) {
          const large = photo.derived.find(d => d.name === 'large');
          if (large) return large.cleanUrl;
      }
      const baseUrl = photo.cleanUrl || photo.originalUrl;
      return baseUrl.includes('?') ? `${baseUrl}&w=600` : `${baseUrl}?w=600`;
  };

  try {
    console.log("Starting Manual Update...");

    // 1. FETCH FROM BÓKUN (Standard Mode)
    const listPath = '/product-list.json/list';
    const listRes = await fetch(`https://api.bokun.io${listPath}`, { method: 'GET', headers: getHeaders('GET', listPath) });
    const listData = await listRes.json();

    const fetchProductsForList = async (listId) => {
        const path = `/product-list.json/${listId}`;
        const resp = await fetch(`https://api.bokun.io${path}`, { method: 'GET', headers: getHeaders('GET', path) });
        const data = await resp.json();
        return data.items || [];
    };

    const hydrateTree = async (nodes) => {
        const promises = nodes.map(async (node) => {
            if (node.children && node.children.length > 0) {
                node.children = await hydrateTree(node.children);
            } 
            else if (node.size > 0 && (!node.children || node.children.length === 0)) {
                const realItems = await fetchProductsForList(node.id);
                const processedChildren = await Promise.all(realItems.map(async (item) => {
                    if (item.activity) {
                        return { 
                            ...item.activity, 
                            slug: slugify(item.activity.title),
                            optimizedImage: getBestImage(item.activity)
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

    const hydratedData = await hydrateTree(listData);
    
    // 2. SAVE TO DATABASE 💾
    // We are saving the result to a key named 'bokun_tours_standard'
    await kv.set('bokun_tours_standard', hydratedData);

    res.status(200).json({ success: true, message: "Database Updated Successfully!", timestamp: new Date() });

  } catch (error) { 
      console.error(error);
      res.status(500).json({ error: error.message }); 
  }
}
