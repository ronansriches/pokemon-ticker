// api/movers.js
export default async function handler(req, res) {
  try {
    const API_KEY = process.env.JUSTTCG_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: "Missing JUSTTCG_API_KEY env var in Vercel" });
    }

    const base = "https://api.justtcg.com/v1/cards";
    const limitUpstream = String(req.query.limit || "40"); // fetch more, we'll trim
    const topOut = Number(req.query.top || 20);

    // First: the "rich" request we want
    const richParams = new URLSearchParams({
      game: "pokemon",
      orderBy: String(req.query.orderBy || "30d"), // target movers by 30d
      limit: limitUpstream,
      include_price_history: "true",
      include_statistics: "7d,30d",
    });

    const richURL = `${base}?${richParams.toString()}`;
    let r = await fetch(richURL, { headers: { "x-api-key": API_KEY } });
    let text = await r.text();

    // If rich request fails with a 4xx, try a simpler request
    if (!r.ok && (r.status === 400 || r.status === 404)) {
      console.warn("Rich request failed:", r.status, text);

      const simpleParams = new URLSearchParams({
        game: "pokemon",
        limit: limitUpstream,
      });
      const simpleURL = `${base}?${simpleParams.toString()}`;
      const r2 = await fetch(simpleURL, { headers: { "x-api-key": API_KEY } });
      const text2 = await r2.text();

      if (!r2.ok) {
        console.error("Simple request also failed:", r2.status, text2);
        return res.status(r2.status).send(text2);
      }

      const payload2 = JSON.parse(text2);
      const cards2 = Array.isArray(payload2?.data) ? payload2.data : [];

      // Normalize: keep priced variants; compute change if statistics exist; otherwise 0
      const normalized = cards2
        .map(card => {
          const v = (card.variants || []).find(x => typeof x?.price === "number");
          if (!v) return null;
          const change = Number(v.priceChange30d ?? 0) || 0;
          return {
            name: card.name,
            set: card.set || {},
            image_url: card.image_url,
            variants: [{
              price: Number(v.price) || 0,
              priceChange30d: change,
              priceHistory30d: v.priceHistory30d || null,
              priceHistory7d: v.priceHistory7d || null,
            }],
          };
        })
        .filter(Boolean);

      // Sort by biggest absolute 30d move we can infer
      normalized.sort((a, b) => {
        const aCh = Math.abs(Number(a.variants?.[0]?.priceChange30d || 0));
        const bCh = Math.abs(Number(b.variants?.[0]?.priceChange30d || 0));
        return bCh - aCh;
      });

      const data = normalized.slice(0, topOut);
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
      return res.json({ data });
    }

    // If rich request succeeded, normalize and respond
    if (!r.ok) {
      console.error("Rich request failed (non-400):", r.status, text);
      return res.status(r.status).send(text);
    }

    const payload = JSON.parse(text);
    const cards = Array.isArray(payload?.data) ? payload.data : [];

    const normalized = cards
      .map(card => {
        const v = (card.variants || []).find(x => typeof x?.price === "number") || card.variants?.[0];
        if (!v) return null;
        return {
          name: card.name,
          set: card.set || {},
          image_url: card.image_url,
          variants: [{
            price: Number(v.price) || 0,
            priceChange30d: Number(v.priceChange30d ?? 0) || 0,
            priceHistory30d: v.priceHistory30d || null,
            priceHistory7d: v.priceHistory7d || null,
          }],
        };
      })
      .filter(Boolean)
      // rank by abs 30d change
      .sort((a, b) => {
        const aCh = Math.abs(Number(a.variants?.[0]?.priceChange30d || 0));
        const bCh = Math.abs(Number(b.variants?.[0]?.priceChange30d || 0));
        return bCh - aCh;
      });

    const data = normalized.slice(0, topOut);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
    return res.json({ data });

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy failed", details: String(err) });
  }
}
