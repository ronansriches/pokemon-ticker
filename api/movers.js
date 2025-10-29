// api/movers.js — resilient PPT proxy: multi-window fallback + computed % + demo fallback
export default async function handler(req, res) {
  try {
    const KEY = process.env.PPT_API_KEY;

    // No key? Keep your site/stream alive with demo data.
    if (!KEY) return res.json({ data: demoData() });

    const requestedWindow = String(req.query.window || "24h"); // 24h | 7d | 30d
    const limit = Number(req.query.limit || 200);

    const windows = [requestedWindow, "7d", "30d"];
    let data = [];

    for (const win of windows) {
      const candidates = [
        `https://www.pokemonpricetracker.com/api/v2/movers?window=${win}&limit=${limit}`,
        `https://www.pokemonpricetracker.com/api/movers?window=${win}&limit=${limit}`
      ];

      let got = [];
      for (const url of candidates) {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
        const txt = await r.text();

        if (!r.ok) {
          console.error("PPT upstream error:", r.status, txt.slice(0,240));
          continue;
        }

        let payload;
        try { payload = JSON.parse(txt); } catch { payload = txt; }
        const list = Array.isArray(payload?.data) ? payload.data :
                     Array.isArray(payload) ? payload : [];

        got = list
          .filter(x => Number(x.price || x.marketPrice || x.currentPrice) > 0)
          .map(x => {
            const current = Number(x.price || x.marketPrice || x.currentPrice || 0);
            const prev    = Number(x.previousPrice || 0);
            const apiPct  = Number(x.percentChange || x.change24h || x.priceChange || 0);

            const computedPct = (!apiPct || apiPct === 0) && prev
              ? ((current - prev) / prev) * 100
              : apiPct || 0;

            const pctChange = Number.isFinite(computedPct) ? computedPct : 0;

            const image =
              x.imageUrl || x.image ||
              (x.setCode && x.number
                ? `https://images.pokemontcg.io/${x.setCode}/${x.number}.png`
                : "https://via.placeholder.com/60x84?text=%3F");

            return {
              id: x.id || `${x.setCode || "set"}-${x.number || "0"}`,
              name: x.name || x.cardName || "Unknown",
              set:  x.set || x.setName || (x.setCode || "Unknown Set"),
              image,
              price: current,
              pctChange,
              history: Array.isArray(x.history) ? x.history
                       : (prev ? [prev, current] : [current]),
            };
          })
          .sort((a,b) => Math.abs(b.pctChange) - Math.abs(a.pctChange))
          .slice(0, limit);

        if (got.length > 0) break;
      }
      if (got.length > 0) { data = got; break; }
    }

    if (data.length === 0) data = demoData();

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
    return res.json({ data });
  } catch (e) {
    console.error("Proxy failed:", e);
    return res.json({ data: demoData() }); // never blank
  }
}

// Demo payload (guarantees visible UI even if API is down/misconfigured)
function demoData(){
  const seed = [
    { name:"Charizard ex", set:"Obsidian Flames", price:118.5, pctChange:32.2, image:"https://images.pokemontcg.io/sv3/125.png" },
    { name:"Gardevoir ex", set:"Scarlet & Violet", price:42.1, pctChange:-18.4, image:"https://images.pokemontcg.io/sv1/86.png" },
    { name:"Mew VMAX", set:"Fusion Strike", price:25.3, pctChange:12.7, image:"https://images.pokemontcg.io/swsh8/114.png" },
    { name:"Pikachu", set:"Celebrations", price:3.2, pctChange:-9.1, image:"https://images.pokemontcg.io/cel25/5.png" },
  ];
  const out = [];
  for (let i=0;i<25;i++) {
    out.push(...seed.map((c,k)=>({
      ...c,
      id:`demo-${i}-${k}`,
      history:[c.price/(1+c.pctChange/100), c.price]
    })));
  }
  return out;
}
