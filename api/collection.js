import crypto from 'crypto';

export default async function handler(req, res) {
  // --- 1. ENABLE CORS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;
  const baseUrl = "https://api.bokun.io";

  // --- HELPER: Auth Headers ---
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

  // --- HELPER: Formatter for HTML Fields ---
  // If Bókun sends a list (Array), we turn it into an HTML <ul> list.
  const formatToHtml = (data) => {
    if (!data) return "";
    if (Array.isArray(data)) {
        // Convert list ["Passport", "Water"] -> "<ul><li>Passport</li><li>Water</li></ul>"
        return "<ul>" + data.map(item => `<li>${item.title || item}</li>`).join('') + "</ul>";
    }
    return data; // It's already a string (HTML)
  };

  try {
    // --- STEP 1: Search to get IDs ---
    const searchPath = '/activity.json/search';
    const searchBody = JSON.stringify({
      "page": 1,
      "pageSize": 200, 
      "inLang": "en",
      "currency": "AED"
    });

    const searchRes = await fetch(baseUrl + searchPath, {
      method: 'POST',
      headers: getHeaders('POST', searchPath),
      body: searchBody
    });

    if (!searchRes.ok) throw new Error("Search Failed");
    const searchData = await searchRes.json();
    const productSummaries = searchData.items || [];

    // --- STEP 2: The "Throttled" Fetch (Batching) ---
    // We fetch 5 tours at a time to prevent Bókun from blocking us.
    const detailedProducts = [];
    const BATCH_SIZE = 5;
    
    for (let i = 0; i < productSummaries.length; i += BATCH_SIZE) {
        const batch = productSummaries.slice(i, i + BATCH_SIZE);
        
        const batchPromises = batch.map(async (summary) => {
            const detailPath = `/activity.json/${summary.id}?currency=AED&lang=EN`;
            try {
                const res = await fetch(baseUrl + detailPath, {
                    method: 'GET',
                    headers: getHeaders('GET', detailPath)
                });
                if (!res.ok) return null;
                return res.json();
            } catch (e) {
                return null;
            }
        });

        const batchResults = await Promise.all(batchPromises);
        detailedProducts.push(...batchResults.filter(p => p !== null));
    }

    // --- STEP 3: Map to Duda ---
    const dudaCollection = detailedProducts.map(tour => {
        
        const safeTitle = tour.title || "untitled";
        const slug = safeTitle.toString().toLowerCase().trim()
            .replace(/\s+/g, '-')      
            .replace(/[^\w\-]+/g, '')  
            .replace(/\-\-+/g, '-');   

        const price = tour.nextDefaultPriceMoney 
            ? `${tour.nextDefaultPriceMoney.currency} ${tour.nextDefaultPriceMoney.amount.toFixed(2)}` 
            : "";

        // Duration
        let durationText = "";
        let totalDays = (tour.durationWeeks || 0) * 7 + (tour.durationDays || 0);
        if (totalDays > 0) durationText = `${totalDays} days`;
        else if (tour.durationHours) durationText = `${tour.durationHours} hours`;

        // Video Logic (Priority: KeyVideo -> List)
        let finalVideoUrl = "";
        if (tour.keyVideo && tour.keyVideo.url) {
            finalVideoUrl = tour.keyVideo.url; 
        } else if (tour.videos && Array.isArray(tour.videos) && tour.videos.length > 0) {
            finalVideoUrl = tour.videos[0].url; 
        }

        // Categories
        const isPrivate = safeTitle.toLowerCase().includes('private') || (tour.attributes && tour.attributes.includes('Private'));
        const subListName = isPrivate ? "Private Tours" : "Group Tours";

        // Location
        const startPoint = (tour.startPoints && tour.startPoints.length > 0) ? tour.startPoints[0] : {};

        return {
            "page_item_url": slug,
            "data": {
                "id": tour.id.toString(),
                "productCode": tour.externalId || tour.id.toString(),
                "title": safeTitle,
                // Now these will be FULL HTML because we fetched the detail endpoint
                "description": formatToHtml(tour.description),
                "excerpt": tour.excerpt || "",
                "supplier": tour.vendor ? tour.vendor.title : "Arabian Wanderers",
                "activityType": tour.activityType || "Multi day tour",
                "meetingType": tour.meetingType || "Meet on location",
                "defaultPrice": price,
                
                // Rich Text Fields (Using the Helper to ensure HTML)
                "included": formatToHtml(tour.included),
                "excluded": formatToHtml(tour.excluded),
                "requirements": formatToHtml(tour.requirements),
                "knowBeforeYouGo": formatToHtml(tour.knowBeforeYouGo),
                "inclusions": [],
                "exclusions": [],
                "knowBeforeYouGoItems": [], 

                // Metadata
                "durationText": durationText,
                "minAge": tour.minAge ? `Minimum age: ${tour.minAge}` : "",
                "difficultyLevel": tour.difficultyLevel || "",
                "bookingCutoffText": tour.bookingCutoffWeeks ? 
                    `Can be booked no later than ${tour.bookingCutoffWeeks} week(s) before` : 
                    (tour.bookingCutoffDays ? `Can be booked no later than ${tour.bookingCutoffDays} day(s) before` : ""),
                "pickupBeforeMinutesText": `<strong>Note:</strong> Pick-up starts ${tour.pickupMinutesBefore || 0} minute(s) before departure.`,

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
                
                // Video
                "keyVideo": finalVideoUrl,

                "otherPhotos": tour.photos ? tour.photos.map(p => ({
                    "originalUrl": p.originalUrl,
                    "alternateText": p.alternateText || null,
                    "description": p.description || null
                })) : [],

                // Lists
                "subLists": `|${subListName}|`,
                "productLists": [
                    { "id": 93520, "title": "Active Tours", "parent_id": null, "level": 0 },
                    { "id": isPrivate ? 99991 : 93642, "title": subListName, "parent_id": 93520, "level": 1 }
                ],
                "tripadvisorRating": "",
                "tripadvisorNumReviews": "",

                // Location
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
