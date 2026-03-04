// api/giftcard.js
export default async function handler(req, res) {
    // 🎯 Use the same fast cache we built for tours
    res.setHeader('Cache-Control', 'public, s-maxage=1209600, stale-while-revalidate=3600');

    try {
        // Replace your existing fetch URL with this one:
const response = await fetch('https://api.bokun.io/gift-card/configuration.json', {
    method: 'GET',
    headers: {
        'X-Bokun-App-Secret': process.env.BOKUN_SECRET,
        'X-Bokun-App-Key': process.env.BOKUN_KEY,
        'Accept': 'application/json'
    }
});
        if (!response.ok) {
            throw new Error(`Bókun Error: ${response.status}`);
        }

        const cards = await response.json();

        // 🗂️ Map every card into a clean list for Duda
        const output = cards
            .filter(card => card.active === true) // Only grab live cards
            .map(card => ({
                "id": card.id.toString(),
                "title": card.title,
                "description": card.description || "The perfect gift for Arabian adventures!",
                "cardValue": card.cardValue,
                "currency": card.currency,
                "price": `${card.cardValue} ${card.currency}`,
                "keyPhoto": card.keyPhoto ? card.keyPhoto.originalUrl + "?w=800&q=60" : "https://your-default-image.jpg",
                "configId": card.id.toString() // This is what the widget needs
            }));

        res.status(200).json(output);

    } catch (error) {
        res.status(500).json({ error: "Fetch failed", details: error.message });
    }
}
