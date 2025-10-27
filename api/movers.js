export default async function handler(req, res) {
  try {
    const url = "https://api.justtcg.com/v1/market-movers?game=pokemon&limit=20";
    const r = await fetch(url, {
      headers: { "x-api-key": process.env.JUSTTCG_API_KEY }
    });
    const text = await r.text();
    res.status(r.status).send(text);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Proxy failed" });
  }
}
