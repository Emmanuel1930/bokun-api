import crypto from 'crypto';

export default async function handler(req, res) {
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;
  
  // Helper: Bókun Signature Generator
  const getHeaders = (method, path) => {
    const now = new Date();
    // Bókun needs YYYY-MM-DD HH:mm:ss
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    const stringToSign = dateStr + accessKey + method + path;
    const signature = crypto.createHmac('sha1', secretKey).update(stringToSign).digest('base64');

    return {
      'X-Bokun-AccessKey': accessKey,
      'X-Bokun-Date': dateStr,
      'X-Bokun-Signature': signature,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  };

  try {
    // STEP 1: Search for ALL Products
    const searchPath = '/activity.json/search';
    const searchBody = JSON.stringify({
      "page": 1,
      "pageSize": 100, 
      "inLang": "en",
      "currency": "ISK"
    });

    const searchResponse = await fetch(`https://api.bokun.io${searchPath}`, {
      method: 'POST',
      headers: getHeaders('POST', searchPath),
      body: searchBody
    });

    if (!searchResponse.ok) throw new Error("Failed to search products");
    const searchData = await searchResponse.json();
    
    // STEP 2: Loop through every tour to get full details
    const fullToursPromises = searchData.items.map(async (summary) => {
      const detailPath = `/activity.json/${summary.id}?currency=ISK&lang=EN`;
      
      const detailResponse = await fetch(`https://api.bokun.io${detailPath}`, {
        method: 'GET',
        headers: getHeaders('GET', detailPath)
      });
      
      if (!detailResponse.ok) return null; 
      return detailResponse.json();
    });

    const allToursDetails = (await Promise.all(fullToursPromises)).filter(t => t !== null);

    // STEP 3: Map Data (ONLY modifying Itinerary)
    const dudaCollection = allToursDetails.map(item => {
      
      // -- A. CREATE CUSTOM ITINERARY HTML --
      let itineraryHtml = "<p>No itinerary available.</p>";
      if (item.agendaItems && item.agendaItems.length > 0) {
        itineraryHtml = item.agendaItems.map(day => `
          <div class="itinerary-day" style="margin-bottom: 20px;">
            <h4 style="color: #333; margin-bottom: 5px;">Day ${day.day}: ${day.title}</h4>
            <div class="day-body">${day.body}</div>
          </div>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        `).join('');
      }

      // -- B. RETURN OBJECT --
      return {
        // IDs
        "id": item.id.toString(),
        "productCode": item.externalId || item.id.toString(),
        
        // Basic Info
        "title": item.title,
        "description": item.description,
        "excerpt": item.excerpt,
        "price": item.nextDefaultPriceMoney ? (item.nextDefaultPriceMoney.amount + " " + item.nextDefaultPriceMoney.currency) : "Check Price",
        "keyPhoto": item.keyPhoto ? item.keyPhoto.originalUrl : "",

        // THE SPECIAL FIELD (Rich Text)
        "itinerary_html": itineraryHtml,

        // EVERYTHING ELSE IS RAW (Preserving Inner Collections)
        "included": item.included,           // Kept as Array
        "excluded": item.excluded,           // Kept as Array
        "requirements": item.requirements,   // Kept as Array
        "meetingPlaces": item.meetingPlaces, // Kept as Array
        "photos": item.photos                // Kept as Array
      };
    });

    res.status(200).json(dudaCollection);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}