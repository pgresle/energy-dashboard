// Vercel Serverless Function - proxy pro ENTSO-E API
const ENTSOE_KEY = 'd781fff9-0095-4c3a-846f-ade4a8625c90';
const ENTSOE_BASE = 'https://web-api.tp.entsoe.eu/api';
const DOMAIN = '10YCZ-CEPS-----N';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const type = req.query.type || 'prices';
res.setHeader('Cache-Control', 's-maxage=300');
  try {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const tomorrow = (() => {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    })();

    let url;
    if (type === 'generation') {
      url = `${ENTSOE_BASE}?documentType=A75&processType=A16&in_Domain=${DOMAIN}&periodStart=${today}0000&periodEnd=${tomorrow}0000&securityToken=${ENTSOE_KEY}`;
    } else {
      url = `${ENTSOE_BASE}?documentType=A44&in_Domain=${DOMAIN}&out_Domain=${DOMAIN}&periodStart=${today}0000&periodEnd=${tomorrow}0000&securityToken=${ENTSOE_KEY}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: `ENTSO-E: ${response.status}` });
    }

    const xml = await response.text();
    const result = parseXml(xml, type);
    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function parseXml(xml, type) {
  if (type === 'generation') {
    const seriesBlocks = xml.match(/<TimeSeries>[\s\S]*?<\/TimeSeries>/g) || [];
    let total = 0;
    const bySource = {};
    const psr2name = {
      B01:'Biomasa', B02:'Hnědé uhlí', B04:'Plyn', B05:'Uhlí',
      B06:'Ropa', B11:'Vodní průtočná', B12:'Vodní nádrž',
      B14:'Jaderná', B16:'Solární', B18:'Větrná', B20:'Ostatní',
    };
    seriesBlocks.forEach(block => {
      const psr = block.match(/<psrType>(.*?)<\/psrType>/)?.[1] || 'B20';
      const points = block.match(/<Point>[\s\S]*?<\/Point>/g) || [];
      if (points.length > 0) {
        const last = points[points.length - 1];
        const qty = parseFloat(last.match(/<quantity>(.*?)<\/quantity>/)?.[1] || '0');
        if (qty > 0) {
          bySource[psr] = (bySource[psr] || 0) + qty;
          total += qty;
        }
      }
    });
    const sources = Object.entries(bySource)
      .map(([code, mw]) => ({ name: psr2name[code] || code, mw: Math.round(mw) }))
      .sort((a, b) => b.mw - a.mw);
    return { total: Math.round(total), sources };
  } else {
    const priceMatches = [...xml.matchAll(/<Point>[\s\S]*?<position>(\d+)<\/position>[\s\S]*?<price\.amount>([\d.]+)<\/price\.amount>[\s\S]*?<\/Point>/g)];
    const prices = priceMatches.map(m => ({
      hour: parseInt(m[1]) - 1,
      price: parseFloat(m[2])
    })).filter(p => p.price > 0);
    return { prices };
  }
}
