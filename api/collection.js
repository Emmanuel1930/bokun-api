// api/collection.js
const crypto = require('crypto');

module.exports = async (req, res) => {
    // 1. Setup Credentials
    const accessKey = process.env.BOKUN_ACCESS_KEY;
    const secretKey = process.env.BOKUN_SECRET_KEY;
    const baseUrl = "https://api.bokun.io";

    // SAFETY CHECK: Stop immediately if keys are missing
    if (!accessKey || !secretKey) {
        return res.status(500).json({ 
            error: "Configuration Error", 
            message: "Missing BOKUN_ACCESS_KEY or BOKUN_SECRET_KEY in Vercel Environment Variables." 
        });
    }

    // 2. Helper: Bókun Signature
    const getHeaders = (method, path) => {
        const date = new Date().toUTCString();
        const contentToSign = date + accessKey + method + path;
        const signature = crypto.createHmac('sha1', secretKey).update(contentToSign).digest('base64');
        return {
            'X-Bokun-AccessKey': accessKey,
            'X-Bokun-Date': date,
            'X-Bokun-Signature': signature,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
    };

    try {
        // 3. Fetch Active Products
        const searchPath = '/activity.json/search';
        const searchBody = {
            "page": 1,
            "pageSize": 200, 
            "includes": ["extras", "photos", "videos", "itinerary", "capabilities", "attributes"]
        };

        const response = await fetch(baseUrl + searchPath, {
            method: 'POST',
            headers: getHeaders('POST', searchPath),
            body: JSON.stringify(searchBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Bokun API Error (${response.status}): ${errorText}`);
        }

        const bokunData = await response.json();

        // 4. Transform to Exact Duda JSON
        const dudaCollection = bokunData.results.map(tour => {
            
            // Slug Generation
            const safeTitle = tour.title || "untitled-tour";
            const slug = safeTitle.toLowerCase().trim()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-');

            // Price Formatting
            const price = tour.nextDefaultPriceMoney 
                ? `${tour.nextDefaultPriceMoney.currency} ${tour.nextDefaultPriceMoney.amount.toFixed(2)}` 
                : "";

            // Duration Logic
            let durationText = "";
            let totalDays = (tour.durationWeeks || 0) * 7 + (tour.durationDays || 0);
            if (totalDays > 0) durationText = `${totalDays} days`;
            else if (tour.durationHours) durationText = `${tour.durationHours} hours`;

            // Booking Cutoff Text
            let bookingCutoffText = "";
            if (tour.bookingCutoffWeeks) bookingCutoffText = `Can be booked no later than ${tour.bookingCutoffWeeks} week(s) before start time`;
            else if (tour.bookingCutoffDays) bookingCutoffText = `Can be booked no later than ${tour.bookingCutoffDays} day(s) before start time`;
            else if (tour.bookingCutoffHours) bookingCutoffText = `Can be booked no later than ${tour.bookingCutoffHours} hour(s) before start time`;

            // Pickup Text
            const pickupMinutes = tour.pickupMinutesBefore || 0;
            const pickupText = `<strong>Note:</strong> Pick-up starts ${pickupMinutes} minute(s) before departure.`;

            // Group vs Private Logic
            const isPrivate = safeTitle.toLowerCase().includes('private') || (tour.attributes && tour.attributes.includes('Private'));
            const subListName = isPrivate ? "Private Tours" : "Group Tours";

            // Safe Location Handling
            const loc = tour.locationCode || {};

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
                    
                    "inclusions": [],
                    "included": tour.included || "",
                    "exclusions": [],
                    "excluded": tour.excluded || "",
                    "requirements": tour.requirements || "",
                    "knowBeforeYouGo": tour.knowBeforeYouGo || "",
                    "knowBeforeYouGoItems": [], 

                    "durationText": durationText,
                    "minAge": tour.minAge ? `Minimum age: ${tour.minAge}` : "",
                    "difficultyLevel": tour.difficultyLevel || "",
                    "bookingCutoffText": bookingCutoffText,
                    "pickupBeforeMinutesText": pickupText,

                    "activityCategories": tour.activityCategories ? tour.activityCategories.map(c => ({ "value": c })) : [],
                    "activityAttributes": tour.attributes ? tour.attributes.map(a => ({ "value": a })) : [],
                    "guidedLanguage": tour.guidedLanguages ? tour.guidedLanguages.map(l => ({ "value": l })) : [{"value": "English"}],
                    "guidedLanguageHeadphones": [],
                    "guidedLanguageReadingMaterial": [],

                    "keyPhoto": tour.keyPhoto ? tour.keyPhoto.originalUrl : "",
                    "keyPhotoMedium": tour.keyPhoto ? tour.keyPhoto.originalUrl.replace('original', 'medium') : "",
                    "keyPhotoSmall": tour.keyPhoto ? tour.keyPhoto.originalUrl.replace('original', 'small') : "",
                    "keyPhotoAltText": "",
                    "keyVideo": tour.keyVideo ? tour.keyVideo.url : "",
                    "otherPhotos": tour.photos ? tour.photos.map(p => ({
                        "originalUrl": p.originalUrl,
                        "alternateText": p.alternateText || null,
                        "description": p.description || null
                    })) : [],

                    "subLists": `|${subListName}|`,
                    "productLists": [
                        { "id": 93520, "title": "Active Tours", "parent_id": null, "level": 0 },
                        { "id": isPrivate ? 99991 : 93642, "title": subListName, "parent_id": 93520, "level": 1 }
                    ],
                    "tripadvisorRating": "",
                    "tripadvisorNumReviews": "",

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

    } catch (err) {
        console.error("Collection API Error:", err);
        res.status(500).json({ 
            error: "Failed to fetch collection",
            details: err.message 
        });
    }
};
