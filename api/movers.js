// api/movers.js — TCGdex version (no API key required)
// Fetch a page of cards, then fetch each card's details (with pricing),
// compute % change using TCGplayer market vs 7d/30d averages, and return top movers.

const LIST_URL = "https://api.tcgdex.net/v2/en/cards"; // brief list (ids)
const CARD_URL = (id) => `https://api.tcgdex.net/v2/en/cards/${id}`; // full card + pricing

// choose how many cards to scan per run (keep reasonable for speed)
const SCAN_COUNT = 60;  // pull 60 brief cards, then hydrate
const OUT_COUNT  = 20;  // return top 20 to the frontend

export default async function handler(req, res) {
  try {
    // 1) Get a page of card briefs (ids). Supports pagination via ?page=
    const page = Number(req.query.page || 1);
    const listResp = await fetch(`${LIST_URL}?page=${page}`);
    if (!listResp.ok) return res.status(listResp.status).send(await listResp.text());
    const briefs = await listResp.json();

    // Trim to SCAN_COUNT
    const slice = Array.isArray(briefs) ? briefs.slice(0, SCAN_COUNT) : [];

    // 2) Hydrate each card with full details (including pricing)
    const chunks = await Promise.allSettled(
      slice.map(b => fetch(CARD_URL(b.id)).then(r => r.json()))
    );

    const cards = chunks
      .filter(c => c.status === "fulfilled" && c.value && c.value.pricing)
      .map(c => normalizeCard(c.value));

    // 3) Keep only cards with a usable price
    const priced = cards.filter(c => {
      const v = c.variants?.[0];
      return v && typeof v.price === "number" && !Number.isNaN(v.price);
    });

    // 4) Sort by biggest absolute 30d change (fallback to 7d, else 0)
    priced.sort((a, b) => {
      const aCh = Math.abs(a.variants?.[0]?.priceChange30d ?? a.variants?.[0]?.priceChange7d ?? 0);
      const bCh = Math.abs(b.variants?.[0]?.priceChange30d ?? b.variants?.[0]?.priceChange7d ?? 0);
      return bCh - aCh;
    });

    const data = priced.slice(0, OUT_COUNT);

    // cache at the edge for 5 minutes
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
    return res.json({ data });
  } catch (e) {
    console.error("TCGdex proxy error:", e);
    return res.status(500).json({ error: "Proxy failed", details: String(e) });
  }
}

/**
 * Normalize TCGdex card to the frontend's expected shape.
 * We use TCGplayer USD pricing when present; fallback to Cardmarket EUR.
 * Percent change is computed against 7d/30d averages where available.
 */
function normalizeCard(card) {
  // Prefer TCGplayer "marketPrice" (USD). Paths per docs: pricing.tcgplayer.normal.marketPrice, etc.
  const tp = card?.pricing?.tcgplayer || {};
  const cm = card?.pricing?.cardmarket || {};

  // pick a variant & current price
  const currentUSD =
    tp.normal?.marketPrice ?? tp.holo?.marketPrice ?? tp.reverse?.marketPrice;
  const currentEUR =
    cm.trend ?? cm["avg30"] ?? cm.avg ?? null;

  let price = Number(currentUSD ?? currentEUR ?? 0);

  // compute deltas using TCGplayer averages if available (fallback to Cardmarket 7/30)
  const avg7 =
    tp.normal?.midPrice ?? tp.holo?.midPrice ?? tp.reverse?.midPrice ??
    cm["avg7"] ?? null;
  const avg30 =
    tp.normal?.midPrice ?? tp.holo?.midPrice ?? tp.reverse?.midPrice ??
    cm["avg30"] ?? null;

  // 7d & 30d percent change (market vs avg7/avg30). Fall back gracefully.
  const pct7  = (avg7  && price) ? ((price - avg7)  / avg7)  * 100 : 0;
  const pct30 = (avg30 && price) ? ((price - avg30) / avg30) * 100 : 0;

  // pick a primary change for ranking (prefer 30d)
  const change30 = Number.isFinite(pct30) ? pct30 : 0;
  const change7  = Number.isFinite(pct7)  ? pct7  : 0;

  // basic "history" proxy for sparklines (use avg7/avg30 if that's all we have)
  const history30 = Number.isFinite(avg30) ? [avg30, price] :
                    Number.isFinite(avg7)  ? [avg7, price]  : [price];

  return {
    name: card.name,
    set: { name: card?.set?.name || card?.set?.id || "Set" },
    image_url: card?.image ?? null,
    variants: [{
      price,
      priceChange30d: change30,
      priceChange7d:  change7,
      priceHistory30d: history30
    }]
  };
}

