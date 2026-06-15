export const config = { maxDuration: 30 };

const ENTSOE_KEY = 'd781fff9-0095-4c3a-846f-ade4a8625c90';
const ENTSOE_BASE = 'https://web-api.tp.entsoe.eu/api';
const DOMAIN = '10YCZ-CEPS-----N';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = req.query.type || 'prices';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
  const tomorrow = (() => { const d = new Date(now); d.setDate(d.getDate()+1); return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`; })();

  try {
    const url = type === 'generation'
      ? `${ENTSOE_BASE}?documentType=A75&processType=A16&in_Domain=${DOMAIN}&periodStart=${today}0000&periodEnd=${tomorrow}0000&securityToken=${ENTSOE_KEY}`
      : `${ENTSOE_BASE}?documentType=A44&in_Domain=${DOMAIN}&out_Domain=${DOMAIN}&periodStart=${today}0000&periodEnd=${tomorrow}0000&securityToken=${ENTSOE_KEY}`;

    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).json({ error: response.status });

    const xml = await response.text();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json(parseXml(xml, type));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function parseXml(xml, type) {
  if (type === 'generation') {
    const blocks = xml.match(/<TimeSeries>[\s\S]*?<\/TimeSeries>/g) || [];
    let total = 0;
    const bySource = {};
    const names = { B01:'Biomasa', B02:'Hnědé uhlí', B04:'Plyn', B05:'Uhlí', B06:'Ropa', B11:'Vodní průtočná', B12:'Vodní nádrž', B14:'Jaderná', B16:'Solární', B18:'Větrná', B20:'Ostatní' };
    blocks.forEach(b => {
      const psr = b.match(/<psrType>(.*?)<\/psrType>/)?.[1] || 'B20';
      const pts = b.match(/<Point>[\s\S]*?<\/Point>/g) || [];
      if (pts.length) {
        const qty = parseFloat(pts[pts.length-1].match(/<quantity>(.*?)<\/quantity>/)?.[1] || '0');
        if (qty > 0) { bySource[psr] = (bySource[psr]||0) + qty; total += qty; }
      }
    });
    return { total: Math.round(total), sources: Object.entries(bySource).map(([c,mw]) => ({ name: names[c]||c, mw: Math.round(mw) })).sort((a,b) => b.mw-a.mw) };
  } else {
    const matches = [...xml.matchAll(/<Point>[\s\S]*?<position>(\d+)<\/position>[\s\S]*?<price\.amount>([\d.]+)<\/price\.amount>[\s\S]*?<\/Point>/g)];
    return { prices: matches.map(m => ({ hour: parseInt(m[1])-1, price: parseFloat(m[2]) })).filter(p => p.price > 0) };
  }
}
