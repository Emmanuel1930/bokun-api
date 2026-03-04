// api/giftcard.js
export default async function handler(req, res) {
    // 🎯 Use the same successful cache headers from your tours
    res.setHeader('Cache-Control', 'public, s-maxage=1209600, stale-while-revalidate=3600');

    try {
        // Try the standard endpoint first
        let response = await fetch('https://api.bokun.io/gift-card/configuration.json', {
            method: 'GET',
            headers: {
                'X-Bokun-App-Secret': process.env.BOKUN_SECRET,
                'X-Bokun-App-Key': process.env.BOKUN_KEY,
                'Accept': 'application/json'
            }
        });

        // If the first one 404s, try the v1 path (common for some accounts)
        if (response.status === 404) {
            response = await fetch('https://api.bokun.io/v1/gift-card/configuration.json', {
                headers: {
                    'X-Bokun-App-Secret': process.env.BOKUN_SECRET,
                    'X-Bokun-App-Key': process.env.BOKUN_KEY
                }
            });
        }

        if (!response.ok) {
            const errorText = await response.text();
            // IMPORTANT: Using 'res' here correctly so it doesn't crash
            return res.status(response.status).json({ 
                error: "Bókun API Error", 
                status: response.status,
                details: errorText 
            });
        }

        const cards = await response.json();
        
        // Map the cards for Duda
        const formatted = (Array.isArray(cards) ? cards : []).map(card => ({
            id: card.id.toString(),
            title: card.title,
            value: card.cardValue,
            currency: card.currency,
            image: card.keyPhoto ? card.keyPhoto.originalUrl : ""
        }));

        return res.status(200).json(formatted);

    } catch (error) {
        // Safe error handling using the defined 'res'
        console.error(error);
        return res.status(500).json({ error: "Server Crash", message: error.message });
    }
}
