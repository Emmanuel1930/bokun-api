import crypto from 'crypto';

export default async function handler(req, res) {
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;
  
  // --- 1. SETTINGS: SWITCH TO AED ---
  const CURRENCY = "AED"; 
  const LANG = "EN";

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

  // --- HELPER: Slugify for Dynamic URLs ---
  const slugify = (text) => {
    if (!text) return "";
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')        // Replace spaces with -
      .replace(/[^\w\-]+/g, '')    // Remove all non-word chars
      .replace(/\-\-+/g, '-');     // Replace multiple - with single -
  };

  // --- HELPER: Smart Field Formatter (Prevents Crashes) ---
  const formatHtmlField = (data) => {
    if (!data) return "";
    if (typeof data === 'string') return data; // Already HTML
    if (Array.isArray(data)) {
       return "<ul>" + data.map(i => `<li>${i.title || i}</li>`).join('') + "</ul>";
    }
    return "";
  };

  try {
    // STEP 1: Search ALL Products
    const searchPath = '/activity.json/search';
    const searchBody = JSON.stringify({
      "page": 1,
      "pageSize": 100, 
      "inLang": "en",
      "currency": CURRENCY
    });

    const searchResponse = await fetch(`https://api.bokun.io${searchPath}`, {
      method: 'POST',
      headers: getHeaders('POST', searchPath),
      body: searchBody
    });

    if (!searchResponse.ok) throw new Error("Failed to search products");
    const searchData = await searchResponse.json();
    
    // STEP 2: Fetch Full Details for each
    const fullToursPromises = searchData.items.map(async (summary) => {
      const detailPath = `/activity.json/${summary.id}?currency=${CURRENCY}&lang=${LANG}`;
      const detailResponse = await fetch(`https://api.bokun.io${detailPath}`, {
        method: 'GET',
        headers: getHeaders('GET', detailPath)
      });
      if (!detailResponse.ok) return null; 
      return detailResponse.json();
    });

    const allToursDetails = (await Promise.all(fullToursPromises)).filter(t => t !== null);

    // STEP 3: Map to Duda Structure
    const dudaCollection = allToursDetails.map(item => {
      
      // -- Duration Logic --
      let durationStr = "";
      if (item.durationWeeks) durationStr += `${item.durationWeeks} weeks `;
      if (item.durationDays) durationStr += `${item.durationDays} days `;
      if (item.durationHours) durationStr += `${item.durationHours} hours `;

      // -- Itinerary Logic --
      let itineraryHtml = "<p>No itinerary available.</p>";
      if (item.agendaItems && Array.isArray(item.agendaItems) && item.agendaItems.length > 0) {
        itineraryHtml = item.agendaItems.map(day => `
          <div class="itinerary-day" style="margin-bottom: 20px;">
            <h4 style="color: #333; margin-bottom: 5px;">Day ${day.day}: ${day.title}</h4>
            <div class="day-body">${day.body}</div>
          </div>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        `).join('');
      }

      // -- Location Logic (Matching Duda's Structure) --
      const startPoint = (item.startPoints && item.startPoints.length > 0) ? item.startPoints[0] : {};
      const locationObj = {
        geo: {
          latitude: startPoint.latitude || 0,
          longitude: startPoint.longitude || 0
        },
        address: {
          streetAddress: startPoint.address || "",
          city: startPoint.city || "",
          countryCode: startPoint.countryCode || ""
        },
        address_geolocation: startPoint.address || ""
      };

      return {
        // --- The Missing Piece: Dynamic URL Slug ---
        "page_item_url": slugify(item.title), 

        // --- Identification ---
        "id": item.id.toString(),
        "productCode": item.externalId || item.id.toString(),
        "supplier": item.vendor ? item.vendor.title : "Arabian Wanderers",
        
        // --- Content ---
        "title": item.title,
        "description": item.description,
        "excerpt": item.excerpt,
        "activityType": item.activityType || "Tour",
        
        // --- Price & Details (Now in AED) ---
        "defaultPrice": item.nextDefaultPriceMoney ? (item.nextDefaultPriceMoney.amount + " " + item.nextDefaultPriceMoney.currency) : "Check Price",
        "price": item.nextDefaultPriceMoney ? (item.nextDefaultPriceMoney.amount + " " + item.nextDefaultPriceMoney.currency) : "Check Price",
        "durationText": durationStr.trim(),
        "minAge": item.minAge ? `Minimum age: ${item.minAge}` : "",
        "difficultyLevel": item.difficultyLevel || "",
        
        // --- Media ---
        "keyPhoto": item.keyPhoto ? item.keyPhoto.originalUrl : "",
        "keyVideo": item.videos && Array.isArray(item.videos) && item.videos.length > 0 ? item.videos[0].url : "",
        "otherPhotos": (item.photos && Array.isArray(item.photos)) ? item.photos.map(p => ({ originalUrl: p.originalUrl })) : [],

        // --- Location ---
        "location": locationObj,

        // --- HTML Fields (Safe & Smart) ---
        "itinerary_html": itineraryHtml,
        "included": formatHtmlField(item.included),   
        "excluded": formatHtmlField(item.excluded),   
        "requirements": formatHtmlField(item.requirements),
        "knowBeforeYouGo": formatHtmlField(item.knowBeforeYouGo)
      };
    });

    res.status(200).json(dudaCollection);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}