export default async function handler(req, res) {
    // 1. 🔥 THE MAGIC ASTERISK (Fixes CORS Forever)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // 2. Handle the "Pre-flight" check (Browser asking permission)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // 3. Get the Real User's IP Address
        // (Since Vercel is the one calling, we must forward the user's IP, 
        // otherwise it will think the user is in the USA data center!)
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        
        // Sometimes the header has multiple IPs (e.g. "client, proxy1, proxy2")
        // We want the first one (the real client).
        if (ip && typeof ip === 'string' && ip.includes(',')) {
            ip = ip.split(',')[0].trim();
        }

        // 4. Server-to-Server Fetch (No CORS limits here!)
        // We pass the specific IP to get the correct location
        const response = await fetch(`http://ipwho.is/${ip}`);
        const data = await response.json();

        // 5. Send the Clean Data back to Duda
        res.status(200).json(data);

    } catch (error) {
        console.error("Location API Error:", error);
        // Fail Safe: If ipwho.is is down, send a "fake" USD response so the site doesn't crash
        res.status(200).json({ success: false, country_code: 'US', currency: 'USD' });
    }
}
