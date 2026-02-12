export default async function handler(req, res) {
    // 1. 🔥 THE MAGIC HEADERS (Kills CORS Errors Forever)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // 2. Handle Pre-flight
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // 3. Get Real User IP
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        if (ip && typeof ip === 'string' && ip.includes(',')) {
            ip = ip.split(',')[0].trim();
        }

        // --- 🚀 PRIMARY: ip-api.com ---
        try {
            const response1 = await fetch(`http://ip-api.com/json/${ip}`);
            const data1 = await response1.json();

            if (data1.status === 'success') {
                // ✅ Success! Map it to match what Duda expects.
                // ip-api uses "countryCode", Duda expects "country_code"
                return res.status(200).json({
                    success: true,
                    country_code: data1.countryCode, 
                    country: data1.country
                    // We send NO currency, so Duda will use its internal map.
                });
            }
        } catch (e) {
            console.warn("Primary API (ip-api) failed, trying fallback...", e);
        }

        // --- 🛡️ FALLBACK: ipwho.is ---
        // If primary failed, we try this one.
        console.log("Switching to fallback (ipwho)...");
        const response2 = await fetch(`http://ipwho.is/${ip}`);
        const data2 = await response2.json();

        if (data2.success !== false) {
             return res.status(200).json({
                success: true,
                country_code: data2.country_code,
                country: data2.country
            });
        }
        
        // If both fail, throw error to hit the catch block below
        throw new Error("All location providers failed");

    } catch (error) {
        console.error("Location API Error:", error);
        // Fail Safe: Default to US if the world is burning
        res.status(200).json({ success: false, country_code: 'US' });
    }
}
