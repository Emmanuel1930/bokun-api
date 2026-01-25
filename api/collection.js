import crypto from 'crypto';

export default async function handler(req, res) {
  // --- 1. ENABLE CORS PERMISSIONS (Exact Copy from tour.js) ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle "Preflight"
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;
  const baseUrl = "https://api.bokun.io";

  // --- 2. AUTH HEADER GENERATOR ---
  const getHeaders = (method, path) => {
    const now = new Date();
    // Helper to pad numbers with 0
    const pad = (n) => String(n).padStart(2, '0');
    
    // Construct Date String: YYYY-MM-DD HH:mm:ss
    const dateStr = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;

    const contentToSign = dateStr + accessKey + method + path;
    const signature = crypto.createHmac('sha1', secretKey).update(contentToSign).digest('base64');

    return {
      'X-Bokun-AccessKey': accessKey,
      'X-Bokun-Date': dateStr,
      'X-Bokun-Signature': signature,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  };

  try {
    // --- 3. FETCH DATA (Single Efficient Call) ---
    // We use the search endpoint with "includes" to get everything in one go
    const searchPath = '/activity.json/search';
    const searchBody = JSON.stringify({
      "page": 1,
      "pageSize": 200, 
      "includes": ["extras", "photos", "videos", "itinerary", "capabilities", "attributes"]
    });

    const response = await fetch(baseUrl + searchPath, {
      method: 'POST',
      headers: getHeaders('POST', searchPath),
      body: searchBody
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API Error: ${response.status} - ${text}`);
    }
    
    const bokunData = await response.json();

    // --- 4. MAP TO DUDA SCHEMA ---
    const dudaCollection = bokunData.results.map(tour => {
        
        // A. Slugify (Your exact logic)
        const safeTitle = tour.title || "untitled";
        const slug = safeTitle.toString().toLowerCase().trim()
            .replace(/\s+/g, '-')      // Spaces to -
            .replace(/[^\w\-]+/g, '')  // Remove non-word chars
            .replace(/\-\-+/g, '-');   // Merge multiple -

        // B. Price Formatting
        const price = tour.nextDefaultPriceMoney 
            ? `${tour.nextDefaultPriceMoney.currency} ${tour.nextDefaultPriceMoney.amount.toFixed(2)}` 
            : "";

        // C. Duration Logic
        let durationText = "";
        let totalDays = (tour.durationWeeks || 0) * 7 + (tour.durationDays || 0);
        if (totalDays > 0) durationText = `${totalDays} days`;
        else if (tour.durationHours) durationText = `${tour.durationHours} hours`;

        // D. Booking Text Logic
        let bookingCutoffText = "";
        if (tour.bookingCutoffWeeks) bookingCutoffText = `Can be booked no later than ${tour.bookingCutoffWeeks} week(s) before start time`;
        else if (tour.bookingCutoffDays) bookingCutoffText = `Can be booked no later than ${tour.bookingCutoffDays} day(s) before start time`;
        else if (tour.bookingCutoffHours) bookingCutoffText = `Can be booked no later than ${tour.bookingCutoffHours} hour(s) before start time`;

        // E. Pickup Text
        const pickupMinutes = tour.pickupMinutesBefore || 0;
        const pickupText = `<strong>Note:</strong> Pick-up starts ${pickupMinutes} minute(s) before departure.`;

        // F. Group vs Private
        const isPrivate = safeTitle.toLowerCase().includes('private') || (tour.attributes && tour.attributes.includes('Private'));
        const subListName = isPrivate ? "Private Tours" : "Group Tours";

        // G. Location Handling
        const loc = tour.locationCode || {};

        // RETURN THE EXACT JSON STRUCTURE DUDA WANTS
        return {
            "page_item_url": slug,
            "data": {
                "id": tour.id.toString(),
                "productCode": tour.productCode || "",
                "title": safeTitle,
                "description": tour.description || "",
                "excerpt": tour.excerpt || "",
                "supplier": tour.vendor ? tour.vendor.title : "Arabian Wanderers",
                "activityType": tour.activityType || "Multi day tour",
                "meetingType": tour.meetingType || "Meet on location",
                "defaultPrice": price,
                
                // HTML Fields
                "included": tour.included || "",
                "excluded": tour.excluded || "",
                "requirements": tour.requirements || "",
                "knowBeforeYouGo": tour.knowBeforeYouGo || "",
                "inclusions": [],
                "exclusions": [],
                "knowBeforeYouGoItems": [], 

                // Metadata
                "durationText": durationText,
                "minAge": tour.minAge ? `Minimum age: ${tour.minAge}` : "",
                "difficultyLevel": tour.difficultyLevel || "",
                "bookingCutoffText": bookingCutoffText,
                "pickupBeforeMinutesText": pickupText,

                // Arrays / Collections
                "activityCategories": tour.activityCategories ? tour.activityCategories.map(c => ({ "value": c })) : [],
                "activityAttributes": tour.attributes ? tour.attributes.map(a => ({ "value": a })) : [],
                "guidedLanguage": tour.guidedLanguages ? tour.guidedLanguages.map(l => ({ "value": l })) : [{"value": "English"}],
                "guidedLanguageHeadphones": [],
                "guidedLanguageReadingMaterial": [],

                // Images & Video
                "keyPhoto": tour.keyPhoto ? tour.keyPhoto.originalUrl : "",
                "keyPhotoMedium": tour.keyPhoto ? tour.keyPhoto.originalUrl.replace('original', 'medium') : "",
                "keyPhotoSmall": tour.keyPhoto ? tour.keyPhoto.originalUrl.replace('original', 'small') : "",
                "keyPhotoAltText": "",
                "keyVideo": tour.keyVideo ? tour.keyVideo.url : "",
                
                // Gallery Inner Collection
                "otherPhotos": tour.photos ? tour.photos.map(p => ({
                    "originalUrl": p.originalUrl,
                    "alternateText": p.alternateText || null,
                    "description": p.description || null
                })) : [],

                // Legacy List Logic
                "subLists": `|${subListName}|`,
                "productLists": [
                    { "id": 93520, "title": "Active Tours", "parent_id": null, "level": 0 },
                    { "id": isPrivate ? 99991 : 93642, "title": subListName, "parent_id": 93520, "level": 1 }
                ],
                "tripadvisorRating": "",
                "tripadvisorNumReviews": "",

                // Location Object
                "location": loc.location ? {
                    "geo": {
                        "longitude": loc.longitude ? loc.longitude.toString() : "",
                        "latitude": loc.latitude ? loc.latitude.toString() : ""
                    },
                    "address": { "streetAddress": loc.location || "" },
                    "address_geolocation": loc.location || ""
                } : null
            }
        };
    });

    res.status(200).json(dudaCollection);

  } catch (error) {
    console.error("Collection Error:", error);
    res.status(500).json({ error: error.message });
  }
}
