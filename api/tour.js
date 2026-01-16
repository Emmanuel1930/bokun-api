import crypto from 'crypto';

export default async function handler(req, res) {
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;
  const activityId = 852994; 
  
  // 1. Keep the params to ensure we get the right language/currency
  const path = `/activity.json/${activityId}?currency=ISK&lang=EN`;

  // 2. Date Format (Bokun requires YYYY-MM-DD HH:mm:ss)
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  
  const date = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

  const httpMethod = 'GET';
  const stringToSign = date + accessKey + httpMethod + path;

  // 3. THE FIX: Changed 'sha256' to 'sha1'
  const signature = crypto
    .createHmac('sha1', secretKey)  // <--- THIS WAS THE PROBLEM
    .update(stringToSign)
    .digest('base64');

  try {
    const response = await fetch(`https://api.bokun.io${path}`, {
      method: 'GET',
      headers: {
        'X-Bokun-AccessKey': accessKey,
        'X-Bokun-Date': date,
        'X-Bokun-Signature': signature,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text(); 
      throw new Error(`Bokun API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // 4. Format Itinerary
    let itineraryHtml = "";
    if (data.agendaItems && data.agendaItems.length > 0) {
      itineraryHtml = data.agendaItems.map(item => {
        return `
          <div class="itinerary-day" style="margin-bottom: 20px;">
            <h3 style="color: #333; margin-bottom: 10px;">Day ${item.day}: ${item.title}</h3>
            <div class="day-body">${item.body}</div>
          </div>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">`;
      }).join('');
    } else {
        itineraryHtml = "<p>No itinerary details available.</p>";
    }

    const dudaPayload = [
      {
        "id": data.id.toString(),
        "title": data.title,
        "description": data.description, 
        "price": data.nextDefaultPriceMoney ? (data.nextDefaultPriceMoney.amount + " " + data.nextDefaultPriceMoney.currency) : "Check Price",
        "image": data.keyPhoto ? data.keyPhoto.originalUrl : "",
        "itinerary_html": itineraryHtml 
      }
    ];

    res.status(200).json(dudaPayload);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}