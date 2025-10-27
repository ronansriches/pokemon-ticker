export default async function handler(req, res) {
  try {
    const url = "https://api.justtcg.com/v1/cards"
      + "?game=pokemon"
      + "&orderBy=30d"                 // sort by 30-day % change
      + "&limit=20"
      + "&include_price_history=true"
      + "&include_statistics=7d,30d";

    const r = await fetch(url, { headers: { "x-api-key": process.env.JUSTTCG_API_KEY } });
    const text = await r.text();
    res.status(r.status).send(text);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Proxy failed" });
  }
}
