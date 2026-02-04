import crypto from 'crypto';

export default async function handler(req, res) {
  // --- CORS & CACHING ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  // Cache for 1 hour
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

  // --- HELPER: SLUGIFY ---
  const slugify = (text) => text ? text.toString().toLowerCase().trim()
    .replace(/['’]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-') : "review-" + Math.floor(Math.random() * 10000);

  try {
    // 1. FETCH ALL PRODUCTS (Lightweight List)
    const listPath = '/activity.json/search';
    const listUrl = `https://api.bokun.io${listPath}`;
    
    const listBody = JSON.stringify({
        "page": 1, 
        "pageSize": 50, // Adjust if you have more than 50 tours
        "lang": "en"
    });

    const listRes = await fetch(listUrl, { 
        method: 'POST', 
        headers: getHeaders('POST', listPath),
        body: listBody
    });

    if (!listRes.ok) throw new Error("Failed to fetch product list");
    const listData = await listRes.json();
    const products = listData.items || [];

    // 2. FETCH REVIEWS FOR EACH PRODUCT (The Loop)
    // We run these in parallel for speed
    const reviewPromises = products.map(async (product) => {
        const reviewPath = `/activity.json/${product.id}/reviews`;
        const res = await fetch(`https://api.bokun.io${reviewPath}`, { 
            method: 'GET', 
            headers: getHeaders('GET', reviewPath) 
        });
        
        if (!res.ok) return []; // Skip products with errors
        const data = await res.json();
        const reviews = data.items || [];

        // Attach the Product Title to the review for context (optional but helpful)
        return reviews.map(r => ({ ...r, productTitle: product.title }));
    });

    const results = await Promise.all(reviewPromises);
    const allReviews = results.flat(); // Flatten the array of arrays

    // 3. TRANSFORM TO DUDA JSON FORMAT
    const formattedReviews = allReviews.map(item => {
        const title = item.title || "Review";
        const slug = slugify(title);

        return {
            page_item_url: slug,
            data: {
                reviewId: item.id,
                language: item.language || "en",
                publishedDate: item.date,
                rating: item.rating,
                type: "review",
                helpfulVotes: item.helpfulVotes || 0,
                url: item.reviewUrl || "",
                travelDate: item.date ? item.date.substring(0, 7) : "",
                
                title: item.title,
                text: item.body || item.text,
                
                // User Info
                userId: item.user?.id || "guest",
                userType: "user",
                userDisplayName: item.user?.nickname || item.author || "Guest",
                userFullName: item.user?.fullName || "",
                userFirstName: item.user?.firstName || "",
                userLastName: item.user?.lastName || "",
                userName: item.user?.username || "",
                userLink: item.user?.profileUrl || "",
                userPoints: "0",
                userLocationName: item.user?.country || "",
                
                userAvatarSmall: item.user?.avatarUrl || "https://via.placeholder.com/150",
                userAvatarLarge: item.user?.avatarUrl || "https://via.placeholder.com/150"
            }
        };
    });

    return res.status(200).json(formattedReviews);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
