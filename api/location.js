export default async function handler(req, res) {
    // 1. 🔥 THE MAGIC ASTERISK (Fixes CORS Forever)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // 2. Handle the "Pre-flight" check
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // 3. Get the Real User's IP Address
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        
        if (ip && typeof ip === 'string' && ip.includes(',')) {
            ip = ip.split(',')[0].trim();
        }

        // 4. 🔥 SWITCH TO IPAPI.CO (Server-to-Server)
        // Note: ipapi.co has a 1,000 requests/day limit on the free plan.
        const response = await fetch(`https://ipapi.co/${ip}/json/`);
        const data = await response.json();

        // 5. 🛠️ THE TRANSLATOR (Make it look like ipwho.is)
        // We manually add "success: true" so your Duda Widget understands it.
        const cleanData = {
            success: data.error ? false : true, // If no error, say Success!
            country_code: data.country_code,    // Returns "US", "GB", etc.
            currency: data.currency             // Returns "USD", "GBP", etc.
        };

        // 6. Send the Clean Data back
        res.status(200).json(cleanData);

    } catch (error) {
        console.error("Location API Error:", error);
        // Fail Safe: Default to USD
        res.status(200).json({ success: false, country_code: 'US', currency: 'USD' });
    }
}
