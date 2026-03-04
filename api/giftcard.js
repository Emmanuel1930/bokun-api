// api/giftcard.js
export default async function handler(req, res) {
    // 🎯 Use the same successful cache settings from your tours
    res.setHeader('Cache-Control', 'public, s-maxage=1209600, stale-while-revalidate=3600');

    // Identify user country for location-based pricing
    const country = req.headers['x-vercel-ip-country'] || 'AE'; 

    try {
        // 1. Fetch ALL Gift Card Configurations
        const response = await fetch('https://api.bokun.io/gift-card/configuration.json', {
            headers: {
                'X-Bokun-App-Secret': process.env.BOKUN_SECRET,
                'X-Bokun-App-Key': process.env.BOKUN_KEY
            }
        });

        if (!response.ok) throw new Error('Bókun API connection failed');

        const allGiftCards = await response.json();

        // 2. Map the data to match your Duda Collection format
        const formattedGiftCards = allGiftCards
            .filter(card => card.active === true) // Only show active cards
            .map(card => ({
                "id": card.id.toString(),
                "title": card.title,
                "description": card.description || "Perfect gift for Omani adventures!",
                "price": country === 'AE' ? `${card.cardValue} AED` : `${card.cardValue} USD`, // Logic for local pricing
                "cardValue": card.cardValue,
                "currency": card.currency,
                "productCode": card.id.toString(),
                "keyPhoto": card.keyPhoto ? card.keyPhoto.originalUrl + "?w=800&q=60" : "https://your-default-giftcard-image.jpg",
                "booking_url": `https://www.arabianwanderers.com/gift-card?configId=${card.id}` // Link for your Duda widget
            }));

        res.status(200).json(formattedGiftCards);

    } catch (error) {
        console.error("Fetch Error:", error);
        res.status(500).json({ error: "Failed to fetch gift cards", details: error.message });
    }
}
