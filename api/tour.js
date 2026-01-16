import crypto from 'crypto';

export default async function handler(req, res) {
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;
  
  const getHeaders = (method, path) => {
    const now = new Date();
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
    // 1. Search ALL Products
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
    
    // 2. Fetch Full Details
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

    // 3. MAP TO MATCH DUDA STRUCTURE
    const dudaCollection = allToursDetails.map(item => {
      
      // -- Helper: Convert HTML Lists --
      const listToHtml = (arr) => {
        if (!arr || arr.length === 0) return "";
        return "<ul>" + arr.map(i => `<li>${i.title}</li>`).join('') + "</ul>";
      };

      // -- Helper: Build Location Object --
      let locData = {};
      if (item.startPoints && item.startPoints.length > 0) {
        locData = {
           latitude: item.startPoints[0].latitude,
           longitude: item.startPoints[0].longitude,
           address: item.startPoints[0].address
        };
      }

      // -- Helper: Build Duration Text --
      let durationStr = "";
      if (item.durationWeeks) durationStr += `${item.durationWeeks} weeks `;
      if (item.durationDays) durationStr += `${item.durationDays} days `;
      if (item.durationHours) durationStr += `${item.durationHours} hours `;

      // -- Helper: Itinerary HTML --
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

      return {
        // --- Core ID ---
        "id": item.id.toString(),
        "productCode": item.externalId || item.id.toString(),
        "supplier": item.vendor ? item.vendor.title : "Arabian Wanderers", // Default or fetch
        
        // --- Content ---
        "title": item.title,
        "description": item.description,
        "excerpt": item.excerpt,
        "activityType": item.activityType || "Tour",
        
        // --- Pricing & Details ---
        "defaultPrice": item.nextDefaultPriceMoney ? (item.nextDefaultPriceMoney.amount + " " + item.nextDefaultPriceMoney.currency) : "Check Price",
        "price": item.nextDefaultPriceMoney ? (item.nextDefaultPriceMoney.amount + " " + item.nextDefaultPriceMoney.currency) : "Check Price",
        "durationText": durationStr.trim(),
        "minAge": item.minAge ? `Minimum age: ${item.minAge}` : "",
        "difficultyLevel": item.difficultyLevel || "",
        
        // --- Images & Media ---
        "keyPhoto": item.keyPhoto ? item.keyPhoto.originalUrl : "",
        "keyVideo": item.videos && item.videos.length > 0 ? item.videos[0].url : "",
        "otherPhotos": item.photos ? item.photos.map(p => ({ originalUrl: p.originalUrl })) : [],

        // --- Location ---
        "location_lat": locData.latitude,
        "location_lng": locData.longitude,
        "location_address": locData.address,

        // --- HTML Fields (Matching Duda's Rich Text) ---
        "itinerary_html": itineraryHtml,
        "included": listToHtml(item.included),   // Matches Duda's 'included' HTML field
        "excluded": listToHtml(item.excluded),   // Matches Duda's 'excluded' HTML field
        "requirements": listToHtml(item.requirements),

        // --- Raw Arrays (Just in case you need them later) ---
        "inclusions_raw": item.included,
        "photos_raw": item.photos
      };
    });

    res.status(200).json(dudaCollection);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}