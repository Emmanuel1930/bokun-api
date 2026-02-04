import crypto from 'crypto';

export default async function handler(req, res) {
  // --- CORS & CACHING HEADERS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  // Cache for 1 hour (Reviews don't change every minute)
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;

  // --- HELPER: SIGNATURE GENERATOR ---
  const getHeaders = (method, path) => {
    const now = new Date();
    const cleanDateStr = now.toISOString().replace(/\.\d{3}Z$/, '').replace(/T/, ' ') + 'Z';
    const stringToSign = cleanDateStr + accessKey + method + path;
    const signature = crypto.createHmac('sha1', secretKey).update(stringToSign).digest('base64');
    return {
      'X-Bokun-AccessKey': accessKey, 'X-Bokun-Date': cleanDateStr, 'X-Bokun-Signature': signature, 'Accept': 'application/json', 'Content-Type': 'application/json'
    };
  };

  // --- HELPER: SLUGIFY (Creates "amazing-experience" from "Amazing Experience") ---
  const slugify = (text) => text ? text.toString().toLowerCase().trim()
    .replace(/['’]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-') : "review-" + Math.floor(Math.random() * 1000);

  try {
    // 1. FETCH REVIEWS FROM BÓKUN
    // We search for ALL reviews (pageSize: 300 to be safe, you can increase if needed)
    const reviewPath = '/activity-review.json/search';
    
    // Note: Bókun Search often requires a POST, but a GET with query params works for general lists too.
    // If this fails, we might need to switch to POST, but let's try the standard GET first.
    const url = `https://api.bokun.io${reviewPath}?page=1&pageSize=300`;
    
    const response = await fetch(url, { method: 'GET', headers: getHeaders('GET', reviewPath) });
    
    if (!response.ok) {
       // Debugging: If Bókun rejects it, show us why
       const txt = await response.text();
       throw new Error(`Bokun API Error: ${response.status} - ${txt}`);
    }

    const rawData = await response.json();
    const items = rawData.items || [];

    // 2. TRANSFORM DATA (The Magic Step 🎩)
    const processedReviews = items.map(item => {
        const title = item.title || "Review";
        const slug = slugify(title);

        return {
            // 🔥 The "Key" for Duda dynamic pages
            page_item_url: slug, 
            
            // 📦 The Data Package (Matches your screenshot fields perfectly)
            data: {
                reviewId: item.id,
                language: item.language || "en",
                publishedDate: item.date, // Keep raw ISO date
                rating: item.rating,
                type: "review",
                
                // Fields that might be missing in some Bókun reviews, so we provide fallbacks
                helpfulVotes: item.helpfulVotes || 0,
                url: item.reviewUrl || "", // Link to original review if available
                travelDate: item.date ? item.date.substring(0, 7) : "", // "2025-08"
                
                title: item.title,
                text: item.body || item.text, // Bókun sometimes calls it 'body'
                
                // User Info
                userId: item.user?.id || "guest",
                userType: "user",
                userDisplayName: item.user?.nickname || item.author || "Guest",
                userFullName: item.user?.fullName || "",
                userFirstName: item.user?.firstName || "",
                userLastName: item.user?.lastName || "",
                userName: item.user?.username || "",
                userLink: item.user?.profileUrl || "",
                userPoints: "0", // Bókun doesn't usually send this
                userLocationName: item.user?.country || "",
                
                // Avatars (TripAdvisor/Bókun usually provide a 'derived' list)
                userAvatarSmall: item.user?.avatarUrl || "https://via.placeholder.com/150",
                userAvatarLarge: item.user?.avatarUrl || "https://via.placeholder.com/150"
            }
        };
    });

    // 3. RETURN CLEAN JSON
    return res.status(200).json(processedReviews);

  } catch (error) {
    console.error("🔥 REVIEW API ERROR:", error);
    res.status(500).json({ error: error.message });
  }
}
