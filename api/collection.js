import crypto from 'crypto';

export default async function handler(req, res) {
  // ---  1. ENABLE CORS (Standard Setup)  ---
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

// --- HELPER: Format Itinerary into HTML ---
const formatItinerary = (items) => {
    if (!items || !Array.isArray(items) || items.length === 0) return "<p>No itinerary available.</p>";
    
    return items.map(item => {
        const title = item.title || `Day ${item.day || ''}`;
        const body = item.body || item.text || item.description || ""; 
        
        // This style mimics the 'card' look you liked before
return `
<div class="timeline-item">
    <div class="timeline-marker"></div>
    <div class="timeline-content">
        <span class="timeline-day">Day ${item.day || '?'}</span>
        <h2 class="timeline-title">${title}</h2>
        <div class="timeline-body">${body}</div>
    </div>
</div>`;
    }).join('');
  };

  // --- CUSTOM FIELD REGISTRY ---
  // Bokun returns title:null, so the label lives here, keyed by code.
  // Unregistered fields still pass through in the generic `customFields` array.
  const CUSTOM_FIELD_REGISTRY = {
    Field101: { label: 'FAQ', render: 'faq' }
  };

  // --- HELPER: HTML ENTITY DECODE / ESCAPE ---
  // Bokun's rich text is entity-encoded; JSON-LD needs plain chars, HTML needs them back.
  const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  const decodeEntities = (text) => String(text)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, n) => NAMED_ENTITIES[n.toLowerCase()]);

  const escapeHtml = (text) => String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const stripTags = (html) => decodeEntities(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();

  // --- HELPER: PARSE Q&A PAIRS OUT OF THE FAQ HTML ---
  // Bokun sends one flat HTML blob. A fully-bold block (or heading) opens a question;
  // following blocks are its answer until the next question. Empty <p></p> are spacers.
  const BLOCK_RE = /<(p|h[1-6]|ul|ol|div|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const FULLY_BOLD_RE = /^\s*(?:<(?:strong|b)\b[^>]*>[\s\S]*?<\/(?:strong|b)>\s*)+$/i;

  const parseQaPairs = (html) => {
    if (!html || typeof html !== 'string') return [];

    const pairs = [];
    let current = null;
    let match;

    BLOCK_RE.lastIndex = 0;
    while ((match = BLOCK_RE.exec(html)) !== null) {
      const tag = match[1].toLowerCase();
      const inner = match[2];
      const text = stripTags(inner);

      if (!text) continue; // empty <p></p> spacer

      if (/^h[1-6]$/.test(tag) || FULLY_BOLD_RE.test(inner)) {
        if (current) pairs.push(current);
        current = { question: text, answerHtml: '', answerText: '' };
      } else if (current) {
        // Re-wrapped bare, which drops Bokun's inline styles so site CSS wins.
        current.answerHtml += `<${tag}>${inner}</${tag}>`;
        current.answerText += (current.answerText ? ' ' : '') + text;
      }
    }
    if (current) pairs.push(current);

    return pairs.filter(p => p.question);
  };

  // --- HELPER: FORMAT FAQ INTO HTML ---
  // Like formatItinerary: structure + class hooks only, styling lives in Duda's CSS.
  // <details>/<summary> gives a native accordion - no JS, which matters because Duda
  // Rich Text elements render markup but do not run scripts.
  // Returns "" when there are no pairs so the Duda block can be hidden, never "null".
  const formatFaq = (pairs) => {
    if (!pairs.length) return "";

    // name= makes it an exclusive accordion (one open at a time) natively; older
    // browsers ignore it and simply allow multiple open.
    const items = pairs.map(pair => `
    <details class="faq-item" name="faq-accordion">
        <summary class="faq-question">${escapeHtml(pair.question)}</summary>
        <div class="faq-answer">${pair.answerHtml}</div>
    </details>`).join('');

    return `<div class="faq-list">${items}
</div>`;
  };

  // --- HELPER: BUILD schema.org FAQPage JSON-LD ---
  // Bare JSON string for <script type="application/ld+json">{{faqSchema}}</script>.
  // `<` escaped so answer markup can never terminate that script tag early.
  const buildFaqSchema = (pairs) => {
    if (!pairs.length) return "";

    return JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": pairs.map(pair => ({
        "@type": "Question",
        "name": pair.question,
        "acceptedAnswer": { "@type": "Answer", "text": pair.answerText }
      }))
    }).replace(/</g, '\\u003c');
  };

  try {
    // --- STEP 1: Search for IDs (Using 'items') ---
    const searchPath = '/activity.json/search';
    const searchBody = JSON.stringify({
      "page": 1,
      "pageSize": 100, 
      "inLang": "en",
      "currency": "AED"
    });

    const searchResponse = await fetch(baseUrl + searchPath, {
      method: 'POST',
      headers: getHeaders('POST', searchPath),
      body: searchBody
    });

    if (!searchResponse.ok) throw new Error("Search Failed");
    const searchData = await searchResponse.json();

    // CRITICAL FIX: Use 'items', not 'results'
    const productSummaries = searchData.items || []; 

    // --- STEP 2: Fetch FULL Details for each product ---
    // (This ensures we get the Description, Photos, and Attributes)
    const detailPromises = productSummaries.map(async (summary) => {
        const detailPath = `/activity.json/${summary.id}?currency=AED&lang=EN`;
        const detailRes = await fetch(baseUrl + detailPath, {
            method: 'GET',
            headers: getHeaders('GET', detailPath)
        });
        if (!detailRes.ok) return null;
        return detailRes.json();
    });

    const detailedProducts = (await Promise.all(detailPromises)).filter(p => p !== null);

    // --- STEP 3: Map to Duda Collection Format ---
    const dudaCollection = detailedProducts.map(tour => {
        
        // Slugify
        const safeTitle = tour.title || "untitled";
        const slug = safeTitle.toString().toLowerCase().trim()
            .replace(/['’]/g, '-')     // 1. Turn apostrophes into dashes
            .replace(/\s+/g, '-')      // 2. Turn spaces into dashes
            .replace(/[^\w\-]+/g, '')  // 3. Remove other weird characters
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

        // Location
        const startPoint = (tour.startPoints && tour.startPoints.length > 0) ? tour.startPoints[0] : {};

        // Custom Fields - all pass through generically; registered ones also get a renderer.
        const describedCustomFields = (Array.isArray(tour.customFields) ? tour.customFields : [])
            .map(field => {
                const known = CUSTOM_FIELD_REGISTRY[field.code] || {};
                return {
                    "code": field.code || "",
                    "label": known.label || field.title || field.code || "",
                    "type": field.type || "",
                    "value": typeof field.value === 'string' ? field.value : ""
                };
            });

        const faqField = describedCustomFields.find(
            field => (CUSTOM_FIELD_REGISTRY[field.code] || {}).render === 'faq'
        );
        const faqPairs = faqField ? parseQaPairs(faqField.value) : [];

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
                "knowBeforeYouGo": tour.attention || tour.knowBeforeYouGo || "",
                "itinerary": formatItinerary(tour.itinerary || tour.agendaItems),

                // FAQ (Bokun custom field Field101)
                "faq": formatFaq(faqPairs),                  // rendered HTML for the page
                "faqLabel": faqField ? faqField.label : "",  // section heading, e.g. "FAQ"
                "faqCount": faqPairs.length,                 // 0 = hide the section in Duda
                "faqSchema": buildFaqSchema(faqPairs),       // schema.org FAQPage JSON-LD

                // Every custom field, generic passthrough (code + label + raw value)
                "customFields": describedCustomFields,

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
                "keyPhoto": tour.keyPhoto ? tour.keyPhoto.originalUrl + "?w=1000&h=560&fit=crop&q=60" : "",
                "keyPhotoMedium": tour.keyPhoto ? tour.keyPhoto.originalUrl + "?w=800&q=60" : "",
              
                "og:image": tour.keyPhoto ? tour.keyPhoto.originalUrl + "?w=600&h=315&fit=crop&q=50" : "", // 🎯 FIX: Reduce for Social Media/Crawlers
                "twitter:image": tour.keyPhoto ? tour.keyPhoto.originalUrl + "?w=600&h=315&fit=crop&q=50" : "",
               
                "keyPhotoSmall": tour.keyPhoto ? tour.keyPhoto.originalUrl + "?w=400&q=60" : "",
                "keyPhotoAltText": `${safeTitle} tour image`, // 🎯 FIX: Automatically adds Alt Text
                "keyVideo": (tour.videos && tour.videos.length > 0) ? tour.videos[0].sourceUrl : (tour.keyVideo ? tour.keyVideo.url : ""),
                "otherPhotos": tour.photos ? tour.photos.map(p => ({
                // "otherPhotos": tour.photos ? tour.photos.slice(0, 20).map(p => ({
                    "originalUrl": p.originalUrl + "?w=700&q=60",
                    "alternateText": p.alternateText || `${safeTitle} gallery image`, 
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

    // s-maxage=3600 caches the response
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=1209600');
    res.status(200).json(dudaCollection);

  } catch (error) {
    console.error("Collection Error:", error);
    res.status(500).json({ error: error.message });
  }
}
