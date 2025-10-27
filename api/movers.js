// api/movers.js
// Vercel serverless function: fetches Pokémon cards, filters to priced variants,
// sorts by biggest 30d % movers (abs), and returns the top N.

export default async function handler(req, res) {
  try {
    const base = "https://api.justtcg.com/v1/cards";

    // Allow simple query overrides like ?limit=30&orderBy=30d
    const limit = String(req.query.limit || "40");     // fetch a bit more so filtering has room
    const orderBy = String(req.query.orderBy || "30d");

    const qs = new URLSearchParams({
      game: "pokemon",
      orderBy,                             // 7d | 30d | 90d — JustTCG sorts by % change period
      limit,                               // upstream page size
      include_price_history: "true",       // so we can draw sparklines
      include_statistics: "7d,30d"         // include computed deltas like priceChange30d
    });

    const url = `${base}?${qs.toString()}`;

    const r = await fetch(url, {
      headers: { "x-api-key": process.env.JUSTTCG_API_KEY }
    });

    const body = await r.text();
    if (!r.ok) {
      // Pass through upstream error text/status so you can see what's wrong in Vercel logs.
      return res.status(r.status).send(body);
    }

    const payload = JSON.parse(body);
    const cards = Array.isArray(payload?.data) ? payload.data : [];

    // Keep only cards that have at least one variant with a numeric price
    const priced = cards.filter(card =>
      Array.isArray(card.variants) &&
      card.variants.some(v => typeof v?.price === "number" && !Number.isNaN(v.price))
    );

    // Rank by biggest absolute 30d movement among that card's variants
    const ranked = priced.sort((a, b) => {
      const aMove = (a.variants || []).reduce((m, v) =>
        Math.max(m, Math.abs(Number(v.priceChange30d || 0))), 0);
      const bMove = (b.variants || []).reduce((m, v) =>
        Math.max(m, Math.abs(Number(v.priceChange30d || 0))), 0);
      return bMove - aMove;
    });

    // Final limit for the frontend (defaults to 20 if none provided)
    const outLimit = Number(req.query.top || 20);
    const data = ranked.slice(0, outLimit);

    // Cache lightly at the edge; feel snappy without hammering the API
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");

    return res.json({ data });
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy failed", details: String(err) });
  }
}
