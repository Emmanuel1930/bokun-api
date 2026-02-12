// api/test_fallback.js
export default async function handler(req, res) {
    // Standard Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    try {
        // 1. Get IP
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();

        // 2. 🧪 TEST ONLY: Force connection to ipwho.is (The Fallback)
        console.log("🧪 TESTING FALLBACK: Connecting to ipwho.is...");
        
        const response = await fetch(`http://ipwho.is/${ip}`);
        const data = await response.json();

        // 3. Report Results
        if (data.success !== false) {
            return res.status(200).json({
                status: "✅ FALLBACK IS WORKING",
                provider: "ipwho.is",
                country: data.country,
                country_code: data.country_code,
                raw_data: data // Show full data to prove it
            });
        } else {
            return res.status(500).json({
                status: "❌ FALLBACK FAILED",
                message: "ipwho.is returned success: false",
                error: data
            });
        }

    } catch (error) {
        return res.status(500).json({
            status: "❌ SYSTEM ERROR",
            error: error.message
        });
    }
}
