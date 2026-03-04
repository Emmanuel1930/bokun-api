// api/giftcard.js
try {
    // 🎯 Target the Gift Card Configuration endpoint specifically
    const response = await fetch('https://api.bokun.io/gift-card/configuration.json', {
        method: 'GET',
        headers: {
            'X-Bokun-App-Secret': process.env.BOKUN_SECRET,
            'X-Bokun-App-Key': process.env.BOKUN_KEY,
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        // This will tell us if it's a 401 (Keys), 404 (Not Found), etc.
        const errorBody = await response.text();
        throw new Error(`Bókun API error ${response.status}: ${errorBody}`);
    }

    const cards = await response.json();

    // Map the information just like the tour experiences
    const formattedCards = cards
        .filter(card => card.active) // Only pull active cards
        .map(card => ({
            "id": card.id.toString(),
            "title": card.title,
            "cardValue": card.cardValue, // The value (e.g., 500)
            "currency": card.currency,
            "price": `${card.cardValue} ${card.currency}`,
            "description": card.description || "The perfect gift for Arabian adventures",
            "keyPhoto": card.keyPhoto ? card.keyPhoto.originalUrl + "?w=800&q=60" : ""
        }));

    res.status(200).json(formattedCards);

} catch (error) {
    res.status(500).json({ error: "Failed to fetch gift cards", details: error.message });
}
