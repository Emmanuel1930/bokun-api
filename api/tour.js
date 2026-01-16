import crypto from 'crypto';

export default async function handler(req, res) {
  // 1. YOUR CREDENTIALS (Set these in Vercel Environment Variables for safety)
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;
  
  // 2. The specific product we want to test (Socotra)
  const activityId = 852994; 
  const path = `/activity.json/${activityId}`;
  
  // 3. GENERATE THE SIGNATURE (The "Math" Duda can't do)
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

    if (!response.ok) {
      throw new Error(`Bokun API Error: ${response.status}`);
    }

    const data = await response.json();

    // 5. THE MAGIC TRANSLATION (Format agendaItems for Duda)
    // We create one single HTML string from the entire list
    let itineraryHtml = "";
    
    if (data.agendaItems && data.agendaItems.length > 0) {
      itineraryHtml = data.agendaItems.map(item => {
        return `
          <div class="itinerary-day">
            <h3>Day ${item.day}: ${item.title}</h3>
            <div class="day-body">${item.body}</div>
          </div>
          <hr>`;
      }).join('');
    }

    // 6. RETURN TO DUDA (As a list, because Duda expects a Collection)
    const dudaPayload = [
      {
        "id": data.id.toString(),
        "title": data.title,
        "description": data.description,
        "price": data.nextDefaultPriceMoney.amount + " " + data.nextDefaultPriceMoney.currency,
        "image": data.keyPhoto ? data.keyPhoto.originalUrl : "",
        "itinerary_html": itineraryHtml // <--- THIS IS WHAT WE NEED
      }
    ];

    res.status(200).json(dudaPayload);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}