export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { query, placeid } = req.query;
  const key = process.env.GOOGLE_PLACES_KEY;

  try {
    let url;
    if (placeid) {
      // Place Details request — gets phone number, full address, rating
      url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeid}&fields=name,formatted_phone_number,formatted_address,rating&key=${key}`;
    } else if (query) {
      // Text Search request
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`;
    } else {
      return res.status(400).json({ error: "Missing query or placeid" });
    }

    const r = await fetch(url);
    const data = await r.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
