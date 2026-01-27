import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // --- CORS HEADERS (Standard) ---
  // We keep these so your widget can talk to this API from any domain
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // No Cache Header needed here because the database is already fast!
  // But if you want extra speed for repeat visitors, you can uncomment this:
  // res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=59');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // 1. READ FROM VAULT (Redis) ⚡
    // This fetches the data you saved with api/update.js
    const cachedData = await kv.get('bokun_tours_standard');

    // Safety Check: If the Vault is empty, tell the user
    if (!cachedData) {
        return res.status(404).json({ 
            error: "Cache is empty.", 
            action: "Please visit /api/update to fill the database first." 
        });
    }

    // 2. SEND DATA TO USER 🚀
    res.status(200).json(cachedData);

  } catch (error) {
    console.error("Database Read Error:", error);
    res.status(500).json({ error: error.message });
  }
}
