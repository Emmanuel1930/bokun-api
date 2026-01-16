import crypto from 'crypto';

export default async function handler(req, res) {
  // 1. Get Keys
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;
  
  // 2. CONFIGURATION (Added currency and language)
  const activityId = 852994; 
  // IMPORTANT: The path MUST include the query parameters for the signature to match!
  const path = `/activity.json/${activityId}?currency=ISK&lang=EN`;
  
  // 3. GENERATE SIGNATURE
  const date = new Date().toUTCString();
  const httpMethod = 'GET';
  const stringToSign = date + accessKey + httpMethod + path;

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(stringToSign)
    .digest('base64');

  try {
    // 4. CALL BÓKUN
    const response = await fetch(`https://api.bokun.io${path}`, {
      method: 'GET',
      headers: {
        'X-Bokun-AccessKey': accessKey,
        'X-Bokun-Date': date,
        'X-Bokun-Signature': signature,
        'Accept': 'application/json'
      }
    });

    // Better Error Handling: Read the actual message from Bokun
    if (!response.ok) {
      const errorText = await response.text(); 
      throw new Error(`Bokun API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // 5. FORMAT ITINERARY (HTML)
    let itineraryHtml = "";
    
    // Check if agendaItems exists
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

    // 6. RETURN TO DUDA
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
    // This will print the REAL error message from Bokun to your screen
    res.status(500).json({ error: error.message });
  }
}