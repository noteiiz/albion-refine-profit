/* Albion Refine Profit — vanilla JS, no build step */
'use strict';

const S = { cfg: null, rec: null, prices: {}, staticUpdated: null, liveUpdated: null, hist: {}, charts: {} };
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const KEY = { settings: 'aot.settings', daily: 'aot.daily', fees: 'aot.fees' };
const CAT_LABEL = { wood: 'ไม้ → Planks', ore: 'แร่ → Metal Bar', fiber: 'ใย → Cloth', hide: 'หนัง → Leather', rock: 'หิน → Stone Block' };
const CAT_BONUS = { wood: 'Wood', ore: 'Ore', fiber: 'Fiber', hide: 'Hide', rock: 'Rock' };
const CITY_COLORS = { 'Bridgewatch': '#e3a33a', 'Fort Sterling': '#c9d3dc', 'Lymhurst': '#6fbf5f', 'Martlock': '#5f9fe0', 'Thetford': '#a77fd6', 'Caerleon': '#e0604f', 'Brecilien': '#4fc2b4' };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n == null || !isFinite(n)) ? '–' : Math.abs(n) < 100 ? n.toLocaleString('en-US', { maximumFractionDigits: 1 }) : Math.round(n).toLocaleString('en-US');
const pct = n => (n == null || !isFinite(n)) ? '–' : (n * 100).toFixed(1) + '%';
const ageH = iso => (!iso || iso.startsWith('0001')) ? Infinity : (Date.now() - Date.parse(iso.endsWith('Z') ? iso : iso + 'Z')) / 36e5;
const ageTxt = h => !isFinite(h) ? 'ไม่มีข้อมูล' : h < 1 ? Math.max(1, Math.round(h * 60)) + ' นาที' : h < 48 ? h.toFixed(h < 10 ? 1 : 0) + ' ชม.' : Math.round(h / 24) + ' วัน';
const icon = id => `https://render.albiononline.com/v1/item/${encodeURIComponent(id)}.png?size=64`;

/* ---------- item helpers ---------- */
function itemLabel(id) {
  const r = S.rec.refined[id] || S.rec.raw[id];
  const tier = r ? r.tier : (id.match(/^T(\d)/) || [])[1];
  const ench = r && r.ench != null ? r.ench : +((id.match(/@(\d)/) || [])[1] || 0);
  return `T${tier}${ench ? '.' + ench : ''} ${r && r.name ? r.name : id}`;
}
function itemCell(id) { return `<span class="item"><img src="${icon(id)}" alt="" loading="lazy">${esc(itemLabel(id))}</span>`; }
function allIds() { return [...Object.keys(S.rec.refined), ...Object.keys(S.rec.raw)]; }

/* ---------- settings / daily / fees ---------- */
function settings() {
  const d = { premium: false, spec: {}, ui: { buyMode: 'instant', sellMode: 'order', useFocus: false, sameCityOnly: false } };
  const s = LS.get(KEY.settings, d);
  s.ui = Object.assign({}, d.ui, s.ui || {}); s.spec = s.spec || {};
  return s;
}
function saveSettings(s) { LS.set(KEY.settings, s); }

function gameDayKey(t = Date.now()) {
  const d = new Date(t - S.cfg.resetHourUTC * 36e5 + 24 * 36e5 * (S.cfg.resetHourUTC >= 12 ? 1 : 0));
  return d.toISOString().slice(0, 10);
}
function pruneDaily() {
  const all = LS.get(KEY.daily, {}); const today = Date.parse(gameDayKey());
  for (const k of Object.keys(all)) if ((today - Date.parse(k)) / 864e5 >= 7) delete all[k];
  LS.set(KEY.daily, all); return all;
}
function todayBonus() { return LS.get(KEY.daily, {})[gameDayKey()] || null; }
function bonusPctFor(cat) {
  const t = todayBonus(); if (!t || t.none) return 0;
  return t.bonuses.filter(b => b.cat === CAT_BONUS[cat]).reduce((a, b) => a + b.pct, 0);
}
function fees() { return LS.get(KEY.fees, {}); }

/* ---------- prices ---------- */
function mergeRows(rows) {
  for (const r of rows) {
    if (r.quality !== 1) continue;
    const p = (S.prices[r.item_id] ||= {}); const c = (p[r.city] ||= { s: 0, sd: null, b: 0, bd: null });
    if (r.sell_price_min > 0 && ageH(r.sell_price_min_date) < ageH(c.sd)) { c.s = r.sell_price_min; c.sd = r.sell_price_min_date; }
    if (r.buy_price_max > 0 && ageH(r.buy_price_max_date) < ageH(c.bd)) { c.b = r.buy_price_max; c.bd = r.buy_price_max_date; }
  }
}
async function loadStatic() {
  try {
    const j = await (await fetch('data/prices.json', { cache: 'no-cache' })).json();
    S.staticUpdated = j.updatedAt;
    for (const [id, cities] of Object.entries(j.prices || {})) for (const [city, c] of Object.entries(cities))
      mergeRows([{ item_id: id, city, quality: 1, sell_price_min: c.s, sell_price_min_date: c.sd, buy_price_max: c.b, buy_price_max_date: c.bd }]);
  } catch { /* first deploy: no file yet */ }
}
let liveBusy = false, throttledUntil = 0;
async function loadLive() {
  if (liveBusy) return;
  if (Date.now() < throttledUntil) { setStatus(); return; }
  liveBusy = true;
  const ids = allIds(), locs = encodeURIComponent(S.cfg.cities.join(','));
  setStatus('กำลังดึงราคาล่าสุด…');
  let ok = 0, fail = 0, throttled = false;
  // Few large requests: the free API throttles per IP, so keep the request count low.
  for (let i = 0; i < ids.length; i += 125) {
    const chunk = ids.slice(i, i + 125).map(encodeURIComponent).join(',');
    try {
      const r = await fetch(`${S.cfg.apiBase}/api/v2/stats/prices/${chunk}.json?locations=${locs}&qualities=1`, { cache: 'no-store' });
      if (r.status === 429) { throttled = true; break; }
      if (!r.ok) throw new Error(r.status);
      mergeRows(await r.json()); ok++;
    } catch { fail++; }
  }
  liveBusy = false;
  if (throttled) throttledUntil = Date.now() + 2 * 60e3;
  if (ok && !fail && !throttled) S.liveUpdated = new Date().toISOString();
  S.liveResult = throttled ? 'throttled' : fail ? 'partial' : 'ok';
  S.liveCheckedAt = new Date().toISOString();
  setStatus();
  renderAll();
}
function setStatus(msg) {
  const el = $('#priceStatus');
  if (msg) { el.textContent = msg; return; }
  const t = S.liveUpdated || S.staticUpdated;
  const tf = d => new Date(d).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  let txt = t ? `ดึงราคาสำเร็จล่าสุด ${tf(t)}` : 'ยังไม่มีข้อมูลราคา';
  if (S.liveResult === 'throttled' || Date.now() < throttledUntil)
    txt += ' · ⚠ API จำกัดจำนวนครั้ง (ส่งคำขอถี่เกิน) รอ ~2 นาทีแล้วระบบจะลองใหม่เอง';
  else if (S.liveResult === 'partial') txt += ' · ⚠ ดึงได้ไม่ครบ ลองกดใหม่อีกครั้ง';
  el.textContent = txt;
  el.classList.toggle('warn', S.liveResult === 'throttled' || S.liveResult === 'partial');
}

function pickPrice(id, city, side, mode, tax) {
  const c = S.prices[id] && S.prices[id][city]; if (!c) return null;
  const m = S.cfg.market, max = S.cfg.maxPriceAgeHours;
  if (side === 'buy') {
    if (mode === 'instant') return c.s > 0 && ageH(c.sd) <= max ? { unit: c.s, raw: c.s, age: ageH(c.sd) } : null;
    return c.b > 0 && ageH(c.bd) <= max ? { unit: c.b * (1 + m.setupFee), raw: c.b, age: ageH(c.bd) } : null;
  }
  if (mode === 'instant') return c.b > 0 && ageH(c.bd) <= max ? { unit: c.b * (1 - tax), raw: c.b, age: ageH(c.bd) } : null;
  return c.s > 0 && ageH(c.sd) <= max ? { unit: c.s * (1 - tax - m.setupFee), raw: c.s, age: ageH(c.sd) } : null;
}
function median(a) { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function best(id, cities, side, mode, tax) {
  // Outlier guard: compare against the median of this item's prices across all cities.
  const ref = S.cfg.cities.map(c => pickPrice(id, c, side, mode, tax)).filter(Boolean).map(p => p.raw);
  const med = ref.length >= 3 ? median(ref) : null, k = S.cfg.outlierFactor || 2.5;
  let b = null;
  for (const city of cities) {
    const p = pickPrice(id, city, side, mode, tax); if (!p) continue;
    if (med && (side === 'sell' ? p.raw > med * k : p.raw < med / k)) continue;
    if (!b || (side === 'buy' ? p.unit < b.unit : p.unit > b.unit)) b = { ...p, city };
  }
  return b;
}

/* ---------- core calculation ---------- */
function focusEstimate(r) {
  const fe = S.cfg.focusEstimate, sp = (settings().spec[r.cat]) || {};
  const fce = (+sp.mastery || 0) * fe.perMasteryLevel + (r.tier >= 4 ? (+sp['t' + r.tier] || 0) * fe.perTierSpecLevel : 0);
  return r.focus * Math.pow(0.5, fce / fe.halvingFCE);
}
function rrrFor(r, city, useFocus) {
  const pb = S.cfg.productionBonus;
  const total = pb.base + (S.cfg.refineSpecialty[city] === r.cat ? pb.citySpecialty : 0) + (useFocus ? pb.focus : 0) + bonusPctFor(r.cat) / 100;
  return { total, rrr: 1 - 1 / (1 + total) };
}
function calc(id, refineCity, o) {
  const r = S.rec.refined[id];
  const fee = fees()[refineCity];
  if (fee == null || fee === '' || !isFinite(+fee)) return { err: 'fee', city: refineCity };
  const tax = o.premium ? S.cfg.market.taxPremium : S.cfg.market.taxNonPremium;
  const cities = o.sameCityOnly ? [refineCity] : S.cfg.cities;
  const { total, rrr } = rrrFor(r, refineCity, o.useFocus);
  const ing = []; const missing = [];
  for (const x of r.ingredients) {
    const b = best(x.id, cities, 'buy', o.buyMode, tax);
    if (!b) missing.push(x.id); else ing.push({ ...x, ...b });
  }
  const sell = best(id, cities, 'sell', o.sellMode, tax);
  if (!sell) missing.push(id);
  if (missing.length) return { err: 'price', missing };
  const ingCost = ing.reduce((a, x) => a + x.unit * x.count, 0);
  const matCost = ingCost * (1 - rrr);
  const station = r.itemValue * S.cfg.stationNutritionFactor * (+fee) / 100;
  const cost = matCost + station;
  const profit = sell.unit - cost;
  const focusPer = o.focusOverride > 0 ? o.focusOverride : focusEstimate(r);
  const oldest = Math.max(sell.age, ...ing.map(x => x.age));
  return { r, refineCity, rrr, pb: total, ing, ingCost, matCost, station, cost, sell, profit, margin: profit / cost, focusPer, oldest, tax };
}
function bestCalc(id, o) {
  let bestR = null, errs = [];
  for (const city of S.cfg.cities) {
    const c = calc(id, city, o);
    if (c.err) { errs.push(c); continue; }
    if (!bestR || c.profit > bestR.profit) bestR = c;
  }
  return bestR || { err: errs.some(e => e.err === 'price') ? 'price' : 'fee', errs };
}
function uiOpts() {
  const s = settings();
  return { ...s.ui, premium: s.premium };
}

/* ---------- gates ---------- */
function gateHtml(where) {
  const parts = [];
  if (!todayBonus()) parts.push(`<div class="gate"><b>ยังไม่ได้ใส่ Daily bonus ของวันนี้</b> — ต้องระบุก่อนจึงจะคำนวณได้<br><button class="btn small" data-goto="settings">ไปใส่ Daily bonus</button></div>`);
  const f = fees(); const miss = S.cfg.cities.filter(c => f[c] == null || f[c] === '');
  if (miss.length === S.cfg.cities.length) parts.push(`<div class="gate"><b>ยังไม่ได้ใส่ค่าใช้สถานี</b> — ต้องใส่อย่างน้อย 1 เมืองก่อนคำนวณ<br><button class="btn small" data-goto="settings">ไปใส่ค่าสถานี</button></div>`);
  else if (where === 'scan') {
    const spec = Object.entries(S.cfg.refineSpecialty).filter(([c]) => miss.includes(c)).map(([c, cat]) => `${c} (โบนัส ${CAT_BONUS[cat]})`);
    if (spec.length) parts.push(`<div class="gate warn-gate"><b>เมืองที่มีโบนัส Refine แต่ยังไม่ได้ใส่ค่าสถานี:</b> ${esc(spec.join(', '))} — เมืองเหล่านี้จะไม่ถูกนำมาเทียบ</div>`);
  }
  return parts.join('');
}
function blocked() { const f = fees(); return !todayBonus() || !S.cfg.cities.some(c => f[c] != null && f[c] !== ''); }

/* ---------- render: scan ---------- */
function renderScan() {
  $('#scanGate').innerHTML = gateHtml('scan');
  const tb = $('#scanTable tbody');
  if (blocked()) { tb.innerHTML = `<tr><td colspan="9" class="mut">ใส่ข้อมูลที่จำเป็นด้านบนก่อน</td></tr>`; return; }
  const ty = $('#scanType').value, ti = $('#scanTier').value, en = $('#scanEnch').value, o = uiOpts();
  const rows = [];
  for (const [id, r] of Object.entries(S.rec.refined)) {
    if (ty && r.cat !== ty) continue; if (ti && r.tier !== +ti) continue; if (en !== '' && r.ench !== +en) continue;
    rows.push({ id, c: bestCalc(id, o) });
  }
  rows.sort((a, b) => (b.c.err ? -Infinity : b.c.profit) - (a.c.err ? -Infinity : a.c.profit));
  tb.innerHTML = rows.map(({ id, c }) => {
    if (c.err) return `<tr class="click" data-id="${esc(id)}"><td>${itemCell(id)}</td><td colspan="8" class="mut">${c.err === 'price' ? 'ราคาไม่ครบหรือเก่าเกินไป' : 'ยังไม่ได้ใส่ค่าสถานี'}</td></tr>`;
    const cls = c.profit >= 0 ? 'pos' : 'neg', stale = c.oldest > S.cfg.staleWarnHours ? 'warn' : 'mut';
    return `<tr class="click" data-id="${esc(id)}"><td>${itemCell(id)}</td><td>${esc(c.refineCity)}</td><td class="n">${pct(c.rrr)}</td><td class="n">${fmt(c.cost)}</td><td>${esc(c.sell.city)}</td><td class="n">${fmt(c.sell.unit)}</td><td class="n ${cls}">${fmt(c.profit)}</td><td class="n ${cls}">${pct(c.margin)}</td><td class="${stale}">${ageTxt(c.oldest)}</td></tr>`;
  }).join('') || `<tr><td colspan="9" class="mut">ไม่พบไอเทม</td></tr>`;
}

/* ---------- render: detail ---------- */
function renderDetail() {
  const id = $('#detItem').value; if (!id) return;
  $('#detGate').innerHTML = gateHtml('detail');
  const out = $('#detOut');
  const cityPick = $('#detCity').value;
  if (blocked()) { out.innerHTML = ''; drawHistory(id, 'detChart', 30); $('#detChartTitle').textContent = itemLabel(id); return; }
  const o = { ...uiOpts(), focusOverride: +$('#detFocus').value || 0 };
  const c = cityPick === 'best' ? bestCalc(id, o) : calc(id, cityPick, o);
  const qty = Math.max(1, +$('#detQty').value || 1);
  if (c.err === 'fee') {
    out.innerHTML = `<div class="gate"><b>ต้องใส่ค่าใช้สถานีของ ${esc(c.city || 'เมืองที่เลือก')} ก่อนคำนวณ</b><br><button class="btn small" data-goto="settings">ไปใส่ค่าสถานี</button></div>`;
  } else if (c.err === 'price') {
    const miss = c.missing || [...new Set((c.errs || []).flatMap(e => e.missing || []))];
    out.innerHTML = `<div class="gate"><b>ราคาไม่ครบหรือเก่ากว่า ${S.cfg.maxPriceAgeHours} ชม.</b> — เปิดตลาดในเกมพร้อมรัน Albion Data Client แล้วกด "ดึงราคาล่าสุด"<ul>${miss.map(m => `<li>${esc(itemLabel(m))}</li>`).join('')}</ul></div>`;
  } else {
    const r = c.r, cls = c.profit >= 0 ? 'pos' : 'neg';
    const needBuy = c.ing.map(x => ({ ...x, need: x.count * qty * (1 - c.rrr) }));
    const transport = [...new Set([...c.ing.map(x => x.city), c.sell.city])].some(x => x !== c.refineCity);
    const focusLine = o.useFocus ? `<div class="kpi"><div class="l">Focus ที่ใช้ (${qty} ชิ้น)</div><div class="v">${fmt(c.focusPer * qty)}</div></div>` : '';
    let pfocus = '';
    if (o.useFocus) {
      const nf = calc(id, c.refineCity, { ...o, useFocus: false });
      if (!nf.err) pfocus = `<div class="kpi"><div class="l">กำไรเพิ่มต่อ 1 Focus</div><div class="v">${fmt((c.profit - nf.profit) / c.focusPer)}</div></div>`;
    }
    out.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="l">กำไรรวม (${qty} ชิ้น)</div><div class="v ${cls}">${fmt(c.profit * qty)}</div></div>
        <div class="kpi"><div class="l">กำไร/ชิ้น · Margin</div><div class="v ${cls}">${fmt(c.profit)} · ${pct(c.margin)}</div></div>
        <div class="kpi"><div class="l">ต้นทุนรวม</div><div class="v">${fmt(c.cost * qty)}</div></div>
        <div class="kpi"><div class="l">RRR ที่ ${esc(c.refineCity)}</div><div class="v">${pct(c.rrr)}</div></div>
        ${focusLine}${pfocus}
      </div>
      <div class="card">
        <h3>1) ซื้อวัตถุดิบ</h3>
        <div class="table-wrap"><table class="data"><thead><tr><th>วัตถุดิบ</th><th>ซื้อที่</th><th class="n">ราคา/หน่วย (รวม fee)</th><th class="n">ใช้ต่อชิ้น</th><th class="n">ต้องซื้อจริง*</th><th class="n">เป็นเงิน</th><th>อัปเดต</th></tr></thead><tbody>
          ${needBuy.map(x => `<tr><td>${itemCell(x.id)}</td><td>${esc(x.city)}</td><td class="n">${fmt(x.unit)}</td><td class="n">${x.count}</td><td class="n">${fmt(Math.ceil(x.need))}</td><td class="n">${fmt(x.need * x.unit)}</td><td class="${x.age > S.cfg.staleWarnHours ? 'warn' : 'mut'}">${ageTxt(x.age)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="hint">*ค่าเฉลี่ยที่คาดไว้ เพราะวัตถุดิบคืนกลับมา ${pct(c.rrr)} แล้วนำไป Refine ต่อได้ ผลจริงอาจขาดหรือเกินเล็กน้อย</p>
      </div>
      <div class="card">
        <h3>2) Refine ที่ ${esc(c.refineCity)}</h3>
        <table class="data"><tbody>
          <tr><td>Production bonus รวม</td><td class="n">${pct(c.pb)}</td></tr>
          <tr><td>Daily bonus ${esc(CAT_BONUS[r.cat])} วันนี้</td><td class="n">${bonusPctFor(r.cat)}%</td></tr>
          <tr><td>ค่าวัตถุดิบ/ชิ้น หลังหัก RRR</td><td class="n">${fmt(c.matCost)}</td></tr>
          <tr><td>ค่าสถานี/ชิ้น (Item value ${r.itemValue} × ${S.cfg.stationNutritionFactor} × ${fees()[c.refineCity]}/100)</td><td class="n">${fmt(c.station)}</td></tr>
          <tr><td><b>ต้นทุน/ชิ้น</b></td><td class="n"><b>${fmt(c.cost)}</b></td></tr>
        </tbody></table>
      </div>
      <div class="card">
        <h3>3) ขายที่ ${esc(c.sell.city)}</h3>
        <p>ราคา ${fmt(c.sell.raw)} → ได้สุทธิ <b>${fmt(c.sell.unit)}</b>/ชิ้น (หักภาษี ${pct(c.tax)}${o.sellMode === 'order' ? ' + setup fee ' + pct(S.cfg.market.setupFee) : ''}) · ราคาอัปเดต ${ageTxt(c.sell.age)}ก่อน</p>
        <div id="detVolume" class="hint"></div>
        ${transport ? '<p class="warn">⚠ ต้องขนของข้ามเมือง — คิดค่าเดินทางและความเสี่ยงด้วย (โดยเฉพาะเส้นทางผ่าน Caerleon / โซนแดง)</p>' : ''}
      </div>
      <div class="card">
        <h3>เทียบทุกเมือง (Refine ที่เมืองนั้น)</h3>
        <div class="table-wrap"><table class="data"><thead><tr><th>เมือง</th><th class="n">RRR</th><th class="n">ต้นทุน/ชิ้น</th><th class="n">กำไร/ชิ้น</th></tr></thead><tbody>
          ${S.cfg.cities.map(city => { const x = calc(id, city, o); return x.err ? `<tr><td>${esc(city)}</td><td colspan="3" class="mut">${x.err === 'fee' ? 'ยังไม่ใส่ค่าสถานี' : 'ราคาไม่ครบ'}</td></tr>` : `<tr><td>${esc(city)}</td><td class="n">${pct(x.rrr)}</td><td class="n">${fmt(x.cost)}</td><td class="n ${x.profit >= 0 ? 'pos' : 'neg'}">${fmt(x.profit)}</td></tr>`; }).join('')}
        </tbody></table></div>
      </div>`;
    loadHistory(id).then(h => {
      const v = volume7(h, c.sell.city); const el = $('#detVolume');
      if (el) el.textContent = v != null ? `ขายได้เฉลี่ย ~${fmt(v)} ชิ้น/วันที่ ${c.sell.city} (7 วันล่าสุด)${v < qty ? ' — น้อยกว่าจำนวนที่จะทำ อาจขายไม่หมดเร็ว' : ''}` : 'ไม่มีข้อมูลปริมาณการขาย';
    });
  }
  $('#detChartTitle').textContent = itemLabel(id);
  drawHistory(id, 'detChart', 30);
}

/* ---------- history & charts ---------- */
async function loadHistory(id) {
  if (S.hist[id]) return S.hist[id];
  const locs = encodeURIComponent(S.cfg.cities.join(','));
  try {
    const r = await fetch(`${S.cfg.apiBase}/api/v2/stats/history/${encodeURIComponent(id)}.json?locations=${locs}&qualities=1&time-scale=24`);
    if (!r.ok) throw 0;
    const j = await r.json(); const out = {};
    for (const loc of j) out[loc.location] = loc.data.map(d => ({ t: d.timestamp.slice(0, 10), p: d.avg_price, n: d.item_count }));
    return (S.hist[id] = out);
  } catch {
    try {
      const j = await (await fetch('data/history.json', { cache: 'no-cache' })).json();
      const out = {}; for (const [city, arr] of Object.entries(j.items[id] || {})) out[city] = arr.map(([t, s]) => ({ t, p: s, n: null }));
      return (S.hist[id] = out);
    } catch { return (S.hist[id] = {}); }
  }
}
function volume7(h, city) {
  const a = (h[city] || []).slice(-7).filter(d => d.n != null); if (!a.length) return null;
  return a.reduce((s, d) => s + d.n, 0) / a.length;
}
async function drawHistory(id, canvasId, days) {
  const h = await loadHistory(id);
  if (!window.Chart) return;
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const labels = [...new Set(Object.values(h).flat().map(d => d.t).filter(t => t >= cutoff))].sort();
  const datasets = Object.entries(h).filter(([, a]) => a.some(d => d.t >= cutoff)).map(([city, a]) => {
    const m = Object.fromEntries(a.map(d => [d.t, d.p]));
    const col = CITY_COLORS[city] || '#999';
    return { label: city, data: labels.map(t => m[t] ?? null), borderColor: col, backgroundColor: col, spanGaps: true, tension: .25, pointRadius: 2, borderWidth: 2 };
  });
  if (S.charts[canvasId]) S.charts[canvasId].destroy();
  const ctx = document.getElementById(canvasId); if (!ctx) return;
  S.charts[canvasId] = new Chart(ctx, {
    type: 'line', data: { labels: labels.map(t => t.slice(5)), datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#ece3d6', boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
      scales: { x: { ticks: { color: '#a89a87' }, grid: { color: '#2b241d' } }, y: { ticks: { color: '#a89a87', callback: v => fmt(v) }, grid: { color: '#2b241d' } } },
    },
  });
}

/* ---------- render: prices tab ---------- */
function findItem(q) {
  q = q.trim(); if (!q) return null;
  const ids = allIds(); if (ids.includes(q)) return q;
  const byLabel = ids.find(id => itemLabel(id).toLowerCase() === q.toLowerCase()); if (byLabel) return byLabel;
  const words = q.toLowerCase().split(/\s+/);
  return ids.find(id => { const l = (itemLabel(id) + ' ' + id).toLowerCase(); return words.every(w => l.includes(w)); }) || null;
}
async function renderPrices() {
  const id = findItem($('#priceSearch').value) || 'T4_PLANKS';
  $('#priceTitle').innerHTML = itemCell(id);
  const h = await loadHistory(id);
  $('#priceTable tbody').innerHTML = S.cfg.cities.map(city => {
    const c = (S.prices[id] || {})[city] || {}; const a = Math.min(ageH(c.sd), ageH(c.bd)); const v = volume7(h, city);
    return `<tr><td>${esc(city)}</td><td class="n">${c.s ? fmt(c.s) : '–'}</td><td class="n">${c.b ? fmt(c.b) : '–'}</td><td class="${a > S.cfg.staleWarnHours ? 'warn' : 'mut'}">${ageTxt(a)}</td><td class="n">${v != null ? fmt(v) : '–'}</td></tr>`;
  }).join('');
  drawHistory(id, 'priceChart', +$('#priceRange').value);
}


/* ---------- render: stale / update list ---------- */
const RAW_CAT = { WOOD: 'wood', ORE: 'ore', FIBER: 'fiber', HIDE: 'hide', ROCK: 'rock' };
function itemMeta(id) {
  const r = S.rec.refined[id];
  if (r) return { kind: 'refined', cat: r.cat, tier: r.tier, ench: r.ench, name: r.name };
  const w = S.rec.raw[id]; const m = id.match(/^T\d_([A-Z]+)/);
  return { kind: 'raw', cat: RAW_CAT[m && m[1]], tier: w.tier, ench: w.ench || 0, name: w.name };
}
function priceAge(id, city) {
  const c = S.prices[id] && S.prices[id][city];
  return c ? Math.min(ageH(c.sd), ageH(c.bd)) : Infinity;
}
let staleCityPick = '';
function staleRows() {
  const th = $('#staleAge').value, kind = $('#staleKind').value, ty = $('#staleType').value, ti = $('#staleTier').value;
  const out = [];
  for (const id of allIds()) {
    const m = itemMeta(id);
    if (kind && m.kind !== kind) continue; if (ty && m.cat !== ty) continue; if (ti && m.tier !== +ti) continue;
    for (const city of S.cfg.cities) {
      const a = priceAge(id, city);
      const hit = th === 'never' ? !isFinite(a) : a * 60 > +th;
      if (hit) out.push({ id, city, a, m });
    }
  }
  return out;
}
function renderStale() {
  const rows = staleRows();
  const pill = $('#staleCount');
  pill.textContent = rows.length > 999 ? '999+' : rows.length; pill.classList.toggle('hidden', !rows.length);
  if (!$('#tab-stale').classList.contains('active')) return;
  const byCity = {}; for (const r of rows) (byCity[r.city] ||= []).push(r);
  const citySel = $('#staleCity').value || staleCityPick;
  $('#staleSummary').innerHTML = `<button class="chip ${!citySel ? 'active' : ''}" data-city="">ทุกเมือง<b>${rows.length}</b></button>` +
    S.cfg.cities.map(c => `<button class="chip ${citySel === c ? 'active' : ''}" data-city="${esc(c)}">${esc(c)}<b>${(byCity[c] || []).length}</b></button>`).join('');
  const cities = citySel ? [citySel] : S.cfg.cities;
  const html = cities.filter(c => byCity[c]).map(c => {
    const list = byCity[c].sort((x, y) => x.m.cat.localeCompare(y.m.cat) || x.m.kind.localeCompare(y.m.kind) || x.m.tier - y.m.tier || x.m.ench - y.m.ench);
    return `<div class="stale-city"><h4>${esc(c)} <span class="pill">${list.length}</span></h4>
      <div class="table-wrap"><table class="data"><thead><tr><th>ไอเทม</th><th>ชื่อสำหรับค้นในเกม (คลิกเพื่อคัดลอก)</th><th>อัปเดตล่าสุด</th><th class="n">Sell ต่ำสุด</th><th class="n">Buy สูงสุด</th></tr></thead><tbody>
      ${list.map(r => { const p = (S.prices[r.id] || {})[c] || {}; return `<tr><td>${itemCell(r.id)}</td><td><span class="copy" data-copy="${esc(r.m.name || r.id)}">${esc(r.m.name || r.id)}</span></td><td class="${isFinite(r.a) ? 'warn' : 'neg'}">${isFinite(r.a) ? ageTxt(r.a) + 'ก่อน' : 'ไม่มีข้อมูล'}</td><td class="n">${p.s ? fmt(p.s) : '–'}</td><td class="n">${p.b ? fmt(p.b) : '–'}</td></tr>`; }).join('')}
      </tbody></table></div></div>`;
  }).join('');
  $('#staleList').innerHTML = html || '<p class="pos">ไม่มีไอเทมที่ต้องอัปเดตตามเงื่อนไขนี้ 🎉</p>';
}

/* ---------- render: settings ---------- */
function renderSettings() {
  const s = settings(), m = S.cfg.market;
  $('#setPremium').checked = s.premium;
  $('#taxP').textContent = pct(m.taxPremium); $('#taxN').textContent = pct(m.taxNonPremium);
  const reset = new Date(); reset.setUTCHours(S.cfg.resetHourUTC, 0, 0, 0);
  $('#resetLocal').textContent = reset.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  $('#dayKey').textContent = gameDayKey();

  // daily form
  const t = todayBonus();
  const cats = S.cfg.dailyBonusCategories, vals = S.cfg.dailyBonusValues;
  const slot = i => {
    const b = t && !t.none && t.bonuses[i];
    return `<div class="bonus-row"><label>โบนัสที่ ${i + 1}<select class="bCat" data-i="${i}"><option value="">— เลือกหมวด —</option>${cats.map(c => `<option ${b && b.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label>%<select class="bPct" data-i="${i}">${vals.map(v => `<option value="${v}" ${b && b.pct === v ? 'selected' : ''}>+${v}%</option>`).join('')}</select></label></div>`;
  };
  $('#dailyForm').innerHTML = slot(0) + slot(1) + `<label class="check"><input type="checkbox" id="bNone" ${t && t.none ? 'checked' : ''}> วันนี้ไม่มี Daily bonus</label>`;
  $('#dailySaved').textContent = t ? `บันทึกแล้ว ${new Date(t.savedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : '';
  $('#dailyCard').classList.toggle('missing', !t);
  const all = LS.get(KEY.daily, {});
  $('#dailyHistory').innerHTML = Object.keys(all).sort().reverse().map(k => `<div>${esc(k)}: ${all[k].none ? 'ไม่มีโบนัส' : all[k].bonuses.map(b => `${esc(b.cat)} +${b.pct}%`).join(', ')}</div>`).join('') || 'ยังไม่มี';

  // fees
  const f = fees();
  $('#stationFees').innerHTML = S.cfg.cities.map(c => `<label>${esc(c)}${S.cfg.refineSpecialty[c] ? ` <span class="mut">(โบนัส ${CAT_BONUS[S.cfg.refineSpecialty[c]]})</span>` : ''}
    <input type="number" min="0" step="1" data-fee="${esc(c)}" value="${f[c] ?? ''}" placeholder="ต้องใส่" class="${f[c] == null || f[c] === '' ? 'invalid' : ''}"></label>`).join('');

  // spec
  const tiers = [4, 5, 6, 7, 8];
  $('#specForm').innerHTML = `<div class="spec-grid"><div class="h">วัตถุดิบ</div><div class="h">Mastery</div>${tiers.map(x => `<div class="h">T${x}</div>`).join('')}
    ${Object.keys(CAT_LABEL).map(cat => { const sp = s.spec[cat] || {}; return `<div>${esc(CAT_LABEL[cat])}</div><input type="number" min="0" max="100" data-spec="${cat}" data-k="mastery" value="${sp.mastery ?? 0}">${tiers.map(x => `<input type="number" min="0" max="100" data-spec="${cat}" data-k="t${x}" value="${sp['t' + x] ?? 0}">`).join('')}`; }).join('')}</div>`;
}
function refreshDailyIndicators() {
  const missing = !todayBonus();
  $('#dailyBanner').classList.toggle('hidden', !missing);
  $('#settingsDot').classList.toggle('hidden', !missing && S.cfg.cities.some(c => fees()[c] != null && fees()[c] !== ''));
}

/* ---------- wiring ---------- */
function goto(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  if (tab === 'prices') renderPrices();
  if (tab === 'detail') renderDetail();
  if (tab === 'settings') renderSettings();
  if (tab === 'scan') renderScan();
  if (tab === 'stale') renderStale();
}
function renderAll() {
  refreshDailyIndicators();
  const active = ($('.tab.active') || {}).dataset?.tab || 'scan';
  if (active === 'scan') renderScan(); else if (active === 'detail') renderDetail(); else if (active === 'prices') renderPrices();
  renderStale();
}
function fillSelects() {
  $('#scanType').innerHTML += Object.entries(CAT_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#scanTier').innerHTML += [2, 3, 4, 5, 6, 7, 8].map(t => `<option value="${t}">T${t}</option>`).join('');
  const ids = Object.keys(S.rec.refined).sort((a, b) => { const A = S.rec.refined[a], B = S.rec.refined[b]; return A.cat.localeCompare(B.cat) || A.tier - B.tier || A.ench - B.ench; });
  $('#detItem').innerHTML = ids.map(id => `<option value="${esc(id)}">${esc(itemLabel(id))}</option>`).join('');
  $('#detCity').innerHTML = `<option value="best">เมืองที่กำไรดีที่สุด</option>` + S.cfg.cities.map(c => `<option>${esc(c)}</option>`).join('');
  $('#itemList').innerHTML = allIds().map(id => `<option value="${esc(itemLabel(id))}">`).join('');
  $('#staleCity').innerHTML += S.cfg.cities.map(c => `<option>${esc(c)}</option>`).join('');
  $('#staleType').innerHTML += Object.entries(CAT_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#staleTier').innerHTML += [2, 3, 4, 5, 6, 7, 8].map(t => `<option value="${t}">T${t}</option>`).join('');
  $$('.maxAge').forEach(e => e.textContent = S.cfg.maxPriceAgeHours);
  const s = settings();
  $('#buyMode').value = s.ui.buyMode; $('#sellMode').value = s.ui.sellMode;
  $('#useFocus').checked = s.ui.useFocus; $('#sameCityOnly').checked = s.ui.sameCityOnly;
}
function bind() {
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]'); if (g) { goto(g.dataset.goto); return; }
    const t = e.target.closest('.tab'); if (t) { goto(t.dataset.tab); return; }
    const chip = e.target.closest('#staleSummary .chip'); if (chip) { staleCityPick = chip.dataset.city; $('#staleCity').value = chip.dataset.city; renderStale(); return; }
    const cp = e.target.closest('[data-copy]'); if (cp) { navigator.clipboard?.writeText(cp.dataset.copy).then(() => { cp.classList.add('copied'); setTimeout(() => cp.classList.remove('copied'), 1200); }).catch(() => { }); return; }
    const row = e.target.closest('#scanTable tr.click'); if (row) { $('#detItem').value = row.dataset.id; goto('detail'); }
  });
  ['#scanType', '#scanTier', '#scanEnch'].forEach(s => $(s).addEventListener('change', renderScan));
  ['#buyMode', '#sellMode', '#useFocus', '#sameCityOnly'].forEach(sel => $(sel).addEventListener('change', () => {
    const s = settings(); s.ui = { buyMode: $('#buyMode').value, sellMode: $('#sellMode').value, useFocus: $('#useFocus').checked, sameCityOnly: $('#sameCityOnly').checked };
    saveSettings(s); renderScan();
  }));
  ['#detItem', '#detQty', '#detCity', '#detFocus'].forEach(s => $(s).addEventListener('change', renderDetail));
  $('#priceSearch').addEventListener('change', renderPrices);
  ['#staleAge', '#staleKind', '#staleType', '#staleTier'].forEach(sel => $(sel).addEventListener('change', renderStale));
  $('#staleCity').addEventListener('change', e => { staleCityPick = e.target.value; renderStale(); });
  setInterval(() => { if ($('#staleAuto').checked && $('#tab-stale').classList.contains('active') && !document.hidden) loadLive(); }, 60e3);
  setInterval(renderStale, 30e3); // ages tick even without new data
  $('#priceRange').addEventListener('change', renderPrices);
  $('#btnRefresh').addEventListener('click', loadLive);
  $('#setPremium').addEventListener('change', e => { const s = settings(); s.premium = e.target.checked; saveSettings(s); });
  $('#stationFees').addEventListener('input', e => {
    const c = e.target.dataset.fee; if (!c) return;
    const f = fees(); const v = e.target.value.trim();
    if (v === '' || !isFinite(+v) || +v < 0) { delete f[c]; e.target.classList.add('invalid'); } else { f[c] = +v; e.target.classList.remove('invalid'); }
    LS.set(KEY.fees, f); refreshDailyIndicators();
  });
  $('#specForm').addEventListener('input', e => {
    const cat = e.target.dataset.spec; if (!cat) return;
    const s = settings(); s.spec[cat] = s.spec[cat] || {}; s.spec[cat][e.target.dataset.k] = Math.max(0, Math.min(100, +e.target.value || 0)); saveSettings(s);
  });
  $('#btnSaveDaily').addEventListener('click', () => {
    const none = $('#bNone').checked; const all = pruneDaily();
    if (none) { all[gameDayKey()] = { none: true, bonuses: [], savedAt: Date.now() }; }
    else {
      const bonuses = [0, 1].map(i => ({ cat: $(`.bCat[data-i="${i}"]`).value, pct: +$(`.bPct[data-i="${i}"]`).value }));
      if (bonuses.some(b => !b.cat)) { $('#dailySaved').innerHTML = '<span class="neg">กรุณาเลือกหมวดโบนัสให้ครบทั้ง 2 ช่อง หรือติ๊ก "วันนี้ไม่มี Daily bonus"</span>'; return; }
      if (bonuses[0].cat === bonuses[1].cat) { $('#dailySaved').innerHTML = '<span class="neg">หมวดโบนัสทั้ง 2 ช่องต้องไม่ซ้ำกัน</span>'; return; }
      all[gameDayKey()] = { none: false, bonuses, savedAt: Date.now() };
    }
    LS.set(KEY.daily, all); renderSettings(); refreshDailyIndicators();
  });
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('ล้างการตั้งค่า, ค่าสถานี และ Daily bonus ทั้งหมด?')) return;
    Object.values(KEY).forEach(k => { try { localStorage.removeItem(k); } catch { } });
    renderSettings(); renderAll();
  });
  // new game day check every minute
  let lastKey = gameDayKey();
  setInterval(() => {
    const k = gameDayKey();
    if (k !== lastKey) { lastKey = k; pruneDaily(); refreshDailyIndicators(); goto('settings'); }
  }, 60e3);
}

async function init() {
  [S.cfg, S.rec] = await Promise.all([fetch('data/config.json').then(r => r.json()), fetch('data/recipes.json').then(r => r.json())]);
  pruneDaily();
  fillSelects(); bind();
  await loadStatic(); setStatus();
  refreshDailyIndicators();
  if (!todayBonus()) goto('settings'); else renderScan();
  loadLive();
}
init().catch(err => { console.error(err); setStatus('โหลดข้อมูลไม่สำเร็จ: ' + err.message); });
