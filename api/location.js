// api/location.js
export default async function handler(req, res) {
    // 1. 🔥 THE MAGIC HEADERS (Kills CORS Errors Forever)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // 2. Browser "Permission Check" (OPTIONS request)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // 3. Get User's Real IP
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();

        // 4. 🛡️ TRY PROVIDER 1 (IPWHO.IS)
        // We use a server-side request which normally bypasses CORS limits
        const response1 = await fetch(`http://ipwho.is/${ip}`);
        
        if (response1.ok) {
            const data = await response1.json();
            if (data.success !== false) { // Check if they sent a logic error
                return res.status(200).json(data);
            }
        }

        // 5. 🛡️ FALLBACK: PROVIDER 2 (IP-API.COM)
        // If Provider 1 fails, we try Provider 2 instantly
        console.log("Primary failed, switching to backup...");
        const response2 = await fetch(`http://ip-api.com/json/${ip}`);
        const data2 = await response2.json();
        
        // Map IP-API format to match expected format
        return res.status(200).json({
            success: true,
            country_code: data2.countryCode,
            country: data2.country,
            currency: 'USD' // Fallback currency since basic ip-api doesn't send it
        });

    } catch (error) {
        console.error("Proxy Error:", error);
        // 6. ULTIMATE FAIL-SAFE (Default to USD)
        // If everything crashes, the site stays alive in USD mode.
        res.status(200).json({ success: false, country_code: 'US', currency: 'USD' });
    }
}
