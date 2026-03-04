// api/giftcard.js
export default async function handler(req, res) {
    // 1. Set the same "Winner" cache headers (2 weeks)
    res.setHeader('Cache-Control', 'public, s-maxage=1209600, stale-while-revalidate=3600');

    // 2. Identify the user's country for Location-Based Pricing
    const country = req.headers['x-vercel-ip-country'] || 'AE'; // Default to UAE

    try {
        // 3. Fetch the Gift Card Collection from Bókun
        // Replace with your actual Bókun API endpoint for gift cards
        const response = await fetch('https://api.bokun.io/gift-card/collection/[YOUR_COLLECTION_ID]', {
            headers: {
                'X-Bokun-App-Secret': process.env.BOKUN_SECRET,
                'X-Bokun-App-Key': process.env.BOKUN_KEY
            }
        });

        const data = await response.json();

        // 4. Map the data for Duda
        const giftCards = data.map(card => ({
            id: card.id,
            title: card.name,
            value: card.value,
            // Logic to pick the right price based on 'country'
            price: country === 'AE' ? card.localPrice : card.internationalPrice,
            image: card.keyPhoto ? card.keyPhoto.originalUrl + "?w=600&q=60" : ""
        }));

        res.status(200).json(giftCards);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch gift cards" });
    }
}
