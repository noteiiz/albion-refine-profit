// Fetch current Asia (East) market prices for all refining items and save them into data/.
// Run with: node scripts/update-prices.mjs   (Node 18+, no dependencies)
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const cfg = JSON.parse(await readFile(new URL('data/config.json', root), 'utf8'));
const rec = JSON.parse(await readFile(new URL('data/recipes.json', root), 'utf8'));
const ids = [...Object.keys(rec.refined), ...Object.keys(rec.raw)];
const locs = encodeURIComponent(cfg.cities.join(','));
const HISTORY_DAYS = 180;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'Accept-Encoding': 'gzip', 'User-Agent': 'albion-refine-profit (github actions)' } });
      if (r.ok) return await r.json();
      if (r.status === 429) await sleep(10000 * i);
      else throw new Error('HTTP ' + r.status);
    } catch (e) { if (i === tries) throw e; await sleep(3000 * i); }
  }
}

const prices = {};
for (let i = 0; i < ids.length; i += 60) {
  const chunk = ids.slice(i, i + 60).map(encodeURIComponent).join(',');
  const rows = await getJson(`${cfg.apiBase}/api/v2/stats/prices/${chunk}.json?locations=${locs}&qualities=1`);
  for (const r of rows) {
    if (r.quality !== 1) continue;
    const ok = d => d && !d.startsWith('0001');
    if (!(r.sell_price_min > 0 || r.buy_price_max > 0)) continue;
    (prices[r.item_id] ||= {})[r.city] = {
      s: r.sell_price_min || 0, sd: ok(r.sell_price_min_date) ? r.sell_price_min_date : null,
      b: r.buy_price_max || 0, bd: ok(r.buy_price_max_date) ? r.buy_price_max_date : null,
    };
  }
  await sleep(700); // be polite to the free API
}

const updatedAt = new Date().toISOString();
await writeFile(new URL('data/prices.json', root), JSON.stringify({ updatedAt, server: cfg.server, prices }));

// Own long-term history: one point per item/city per UTC day (lowest sell order seen), kept HISTORY_DAYS days.
let hist = { items: {} };
try { hist = JSON.parse(await readFile(new URL('data/history.json', root), 'utf8')); } catch { /* first run */ }
const today = updatedAt.slice(0, 10);
const cutoff = new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString().slice(0, 10);
for (const [id, cities] of Object.entries(prices)) for (const [city, c] of Object.entries(cities)) {
  if (!(c.s > 0)) continue;
  const arr = ((hist.items[id] ||= {})[city] ||= []);
  const last = arr[arr.length - 1];
  if (last && last[0] === today) last[1] = Math.min(last[1], c.s); else arr.push([today, c.s]);
}
for (const cities of Object.values(hist.items)) for (const [city, arr] of Object.entries(cities)) cities[city] = arr.filter(p => p[0] >= cutoff);
hist.updatedAt = updatedAt;
await writeFile(new URL('data/history.json', root), JSON.stringify(hist));

console.log(`saved ${Object.keys(prices).length} items with prices at ${updatedAt}`);
