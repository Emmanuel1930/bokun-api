import crypto from 'crypto';

export default async function handler(req, res) {
  // --- 1. ENABLE CORS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;
  const baseUrl = "https://api.bokun.io";

  const getHeaders = (method, path) => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
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
    // --- STEP 1: SMART SEARCH (Get EVERYTHING in 1 Call) ---
    const searchPath = '/activity.json/search';
    const searchBody = JSON.stringify({
      "page": 1,
      "pageSize": 200, 
      "inLang": "en",
      "currency": "AED",
      // We explicitly include "videos" here to match the component you found
      "includes": ["videos", "photos", "itinerary", "extras", "attributes", "startPoints", "prices"] 
    });

    const response = await fetch(baseUrl + searchPath, {
      method: 'POST',
      headers: getHeaders('POST', searchPath),
      body: searchBody
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Bokun Search Error: ${response.status} - ${text}`);
    }

    const searchData = await response.json();
    const allTours = searchData.items || [];

    // --- STEP 2: Map Directly to Duda ---
    const dudaCollection = allTours.map(tour => {
        
        // Slugify
        const safeTitle = tour.title || "untitled";
        const slug = safeTitle.toString().toLowerCase().trim()
            .replace(/\s+/g, '-')      
            .replace(/[^\w\-]+/g, '')  
            .replace(/\-\-+/g, '-');   

        // Price
        const price = tour.nextDefaultPriceMoney 
            ? `${tour.nextDefaultPriceMoney.currency} ${tour.nextDefaultPriceMoney.amount.toFixed(2)}` 
            : "";

        // Duration
        let durationText = "";
        let totalDays = (tour.durationWeeks || 0) * 7 + (tour.durationDays || 0);
        if (totalDays > 0) durationText = `${totalDays} days`;
        else if (tour.durationHours) durationText = `${tour.durationHours} hours`;

        // Booking Text
        let bookingCutoffText = "";
        if (tour.bookingCutoffWeeks) bookingCutoffText = `Can be booked no later than ${tour.bookingCutoffWeeks} week(s) before start time`;
        else if (tour.bookingCutoffDays) bookingCutoffText = `Can be booked no later than ${tour.bookingCutoffDays} day(s) before start time`;
        else if (tour.bookingCutoffHours) bookingCutoffText = `Can be booked no later than ${tour.bookingCutoffHours} hour(s) before start time`;

        // Pickup Text
        const pickupMinutes = tour.pickupMinutesBefore || 0;
        const pickupText = `<strong>Note:</strong> Pick-up starts ${pickupMinutes} minute(s) before departure.`;

        // Categories
        const isPrivate = safeTitle.toLowerCase().includes('private') || (tour.attributes && tour.attributes.includes('Private'));
        const subListName = isPrivate ? "Private Tours" : "Group Tours";

        // --- VIDEO LOGIC (UPDATED) ---
        // Priority 1: Check 'keyVideo' (Bokun Component)
        // Priority 2: Fallback to the 'videos' list
        let finalVideoUrl = "";
        if (tour.keyVideo && tour.keyVideo.url) {
            finalVideoUrl = tour.keyVideo.url; 
        } else if (tour.videos && Array.isArray(tour.videos) && tour.videos.length > 0) {
            finalVideoUrl = tour.videos[0].url; 
        }

        // Location
        const startPoint = (tour.startPoints && tour.startPoints.length > 0) ? tour.startPoints[0] : {};

        return {
            "page_item_url": slug,
            "data": {
                "id": tour.id.toString(),
                "productCode": tour.externalId || tour.id.toString(),
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

                // Arrays
                "activityCategories": tour.activityCategories ? tour.activityCategories.map(c => ({ "value": c })) : [],
                "activityAttributes": tour.attributes ? tour.attributes.map(a => ({ "value": a })) : [],
                "guidedLanguage": tour.guidedLanguages ? tour.guidedLanguages.map(l => ({ "value": l })) : [{"value": "English"}],
                "guidedLanguageHeadphones": [],
                "guidedLanguageReadingMaterial": [],

                // Images
                "keyPhoto": tour.keyPhoto ? tour.keyPhoto.originalUrl : "",
                "keyPhotoMedium": tour.keyPhoto ? tour.keyPhoto.originalUrl.replace('original', 'medium') : "",
                "keyPhotoSmall": tour.keyPhoto ? tour.keyPhoto.originalUrl.replace('original', 'small') : "",
                "keyPhotoAltText": "",
                
                // Mapped Video
                "keyVideo": finalVideoUrl,

                "otherPhotos": tour.photos ? tour.photos.map(p => ({
                    "originalUrl": p.originalUrl,
                    "alternateText": p.alternateText || null,
                    "description": p.description || null
                })) : [],

                // Legacy Lists
                "subLists": `|${subListName}|`,
                "productLists": [
                    { "id": 93520, "title": "Active Tours", "parent_id": null, "level": 0 },
                    { "id": isPrivate ? 99991 : 93642, "title": subListName, "parent_id": 93520, "level": 1 }
                ],
                "tripadvisorRating": "",
                "tripadvisorNumReviews": "",

                // Location Object
                "location": {
                    "geo": {
                        "longitude": startPoint.longitude ? startPoint.longitude.toString() : "",
                        "latitude": startPoint.latitude ? startPoint.latitude.toString() : ""
                    },
                    "address": { "streetAddress": startPoint.address || "" },
                    "address_geolocation": startPoint.address || ""
                }
            }
        };
    });

    res.status(200).json(dudaCollection);

  } catch (error) {
    console.error("Collection Error:", error);
    res.status(500).json({ error: error.message });
  }
}
