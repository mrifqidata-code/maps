/* Sebaran Member — modul kompetitor (cabang Studiorenang).
 * Dipindahkan dari aplikasi "Persebaran Kompetitor Sparks Swim":
 *  - lokasi cabang, jarak tempuh motor & rute: data/kompetitor.json (data publik)
 *  - harga (Log Harga, Harga Sparks, kompetitor utama, status): sheet "Feed Kompetitor",
 *    diambil lewat Apps Script yang sama dengan data member. Harga tidak pernah ada di repo.
 * File ini dimuat sebelum app.js dan hanya berisi fungsi; variabel app.js dipakai saat fungsi dipanggil. */
'use strict';

const KOMP_URL = 'data/kompetitor.json';
const KOMP_DURS = ['3 bulan', '6 bulan', '12 bulan'];
const KOMP_MODES = { motor: 'Tempuh motor', lurus: 'Garis lurus' };
const KOMP_RADII = [3, 5, 10];
const KOMP_RENAME = { 'Aerowold Citra 8': 'Aeroworld Citra 8', BSD: 'BSD (Nusaloka)', 'Sttudio Renang - Karawang': 'Karawang' };
const KOMP_COLOR = '#d9442b';
const BULAN_PJG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const komp = {
  ready: false, outlets: [], routes: new Map(), regions: [], total: 0, meta: {},
  feed: { log: [], sp: [], main: {}, status: {} },
  src: { state: 'none', at: null, msg: '' }, // none | live | err
};
const kstate = { month: '', dur: '6 bulan', mode: 'motor', radius: 5, shade: false, show: false, highlight: false };
const nearMemo = new Map(); // key alamat member -> {lat, lon, id, d}

const knorm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
const fmtRp = (v) => `Rp${Math.round(v).toLocaleString('id-ID')}`;
const fmtJt = (v) => `${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 2 })} jt`;
const fmtGap = (v) => `${v > 0 ? '+' : ''}${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const fmtDateK = (t) => { const d = new Date(t); return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const kmTxt = (v) => (Number.isFinite(v) ? `${fmtKm(v)} km` : '–');
const curMonthKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthEndT = (m) => { const [y, mo] = m.split('-').map(Number); return Date.UTC(y, mo, 0); };
const prevMonthKey = (m) => { let [y, mo] = m.split('-').map(Number); mo -= 1; if (mo < 1) { mo = 12; y -= 1; } return `${y}-${String(mo).padStart(2, '0')}`; };
const monthNameK = (m) => { const [y, mo] = m.split('-').map(Number); return `${BULAN_PJG[mo - 1]} ${y}`; };
const monthShortK = (m) => { const [y, mo] = m.split('-').map(Number); return `${BULAN[mo - 1]} ${y}`; };

// ---------------------------------------------------------------- data statis

async function loadKompetitor() {
  try {
    const res = await fetch(KOMP_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    komp.meta = d;
    komp.total = d.outletTotal || d.outlets.length;
    komp.outlets = d.outlets.map((o, i) => {
      const key = String(o.name).replace(/\s+/g, ' ').trim();
      const label = KOMP_RENAME[key] || key;
      return { ...o, id: i, key, label, ckey: knorm(`Studiorenang ${label}`), trackedBy: [], region: '-' };
    });
    komp.routes = new Map(d.routes.map((r) => [`${r.c}|${r.o}`, r.path.split(' ').map((p) => p.split(',').map(Number)).map(([x, y]) => [y, x])]));
    komp.regions = d.regions.map((r) => ({ name: r.name, rings: (r.rings || []).map((s) => s.split(' ').map((p) => p.split(',').map(Number))) }));
    for (const o of komp.outlets) {
      const r = komp.regions.find((g) => g.rings.some((ring) => pipLL(o.lng, o.lat, ring)));
      o.region = r ? r.name : '-';
    }
    for (const r of komp.regions) r.count = komp.outlets.filter((o) => o.region === r.name).length;
    komp.ready = true;
    applyMain();
    kstate.month = kstate.month || curMonthKey();
    scheduleRender(true);
  } catch {
    // Tanpa data kompetitor: tab Kompetitor menampilkan pesan.
  }
}

function pipLL(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- feed harga

const KMON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, mei: 4, jun: 5, jul: 6, aug: 7, agu: 7, agt: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, des: 11 };
function kParseDate(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return null;
  let m;
  if (/^\d{5}(\.\d+)?$/.test(s)) { const n = +s; if (n > 20000 && n < 80000) return Date.UTC(1899, 11, 30) + Math.round(n) * 864e5; }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) { const a = +m[1]; const b = +m[2]; return a > 12 ? Date.UTC(+m[3], b - 1, a) : Date.UTC(+m[3], a - 1, b); }
  if ((m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{4})/))) { const mo = KMON[m[2].toLowerCase()]; if (mo != null) return Date.UTC(+m[3], mo, +m[1]); }
  if ((m = s.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/))) { const mo = KMON[m[1].toLowerCase()]; if (mo != null) return Date.UTC(+m[3], mo, +m[2]); }
  return null;
}
function kParseNum(s) {
  s = String(s == null ? '' : s).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const c = s.includes(','); const d = s.includes('.');
  if (c && d) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  else if (d && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = +s;
  return Number.isFinite(n) ? n : null;
}

function buildFeed(rows) {
  const H = (rows[0] || []).map((h) => String(h).trim());
  const ix = (n) => H.indexOf(n);
  const body = rows.slice(1);
  const L = { t: ix('log_tanggal'), comp: ix('log_kompetitor'), dur: ix('log_durasi'), sesi: ix('log_sesi'), harga: ix('log_harga') };
  const S = { t: ix('sp_berlaku'), c: ix('sp_center'), p: ix('sp_paket'), dur: ix('sp_durasi'), sesi: ix('sp_sesi'), pitch: ix('sp_pitch'), bottom: ix('sp_bottom'), cross: ix('sp_crosspol') };
  const R = { c: ix('rg_center'), k: ix('rg_kompetitor') };
  const P = { k: ix('pt_kompetitor'), s: ix('pt_status') };
  if (L.t < 0 || L.comp < 0 || S.t < 0) throw new Error('Kolom Feed Kompetitor tidak dikenali.');
  const first = body[0] || [];
  if ([L.t, S.t, R.c, P.k].some((i) => i >= 0 && /^#(REF|N\/A|ERROR|VALUE)/i.test(String(first[i] || '').trim()))) {
    throw new Error('Feed Kompetitor belum diizinkan menarik data. Buka sheet Feed Kompetitor, klik sel A2, lalu pilih "Izinkan akses".');
  }
  if ([L.t, S.t].some((i) => /^loading/i.test(String(first[i] || '').trim()))) throw new Error('Feed Kompetitor masih memuat data. Coba lagi sebentar.');
  const log = []; const sp = []; const main = {}; const status = {};
  for (const r of body) {
    const comp = String(r[L.comp] || '').trim(); const t = kParseDate(r[L.t]); const harga = kParseNum(r[L.harga]);
    if (comp && t != null && harga) log.push({ t, comp: knorm(comp), compLabel: comp, dur: knorm(r[L.dur]), sesi: kParseNum(r[L.sesi]), harga });
    const st = kParseDate(r[S.t]); const sc = String(r[S.c] || '').trim().toUpperCase();
    if (st != null && sc) {
      sp.push({ t: st, center: sc, paket: String(r[S.p] || '').trim(), dur: knorm(r[S.dur]), sesi: kParseNum(r[S.sesi]),
        pitch: kParseNum(r[S.pitch]), bottom: kParseNum(r[S.bottom]), crosspol: kParseNum(r[S.cross]) });
    }
    const rc = String(r[R.c] || '').trim().toUpperCase(); const rk = String(r[R.k] || '').trim();
    if (rc && rk) main[rc] = rk;
    const pk = String(r[P.k] || '').trim();
    if (pk && P.s >= 0) status[knorm(pk)] = String(r[P.s] || '').trim();
  }
  return { log, sp, main, status };
}

// Dipanggil app.js setelah respons Apps Script (action=all atau action=kompetitor).
function applyKompetitorFeed(data) {
  if (data.kompetitor && Array.isArray(data.kompetitor.rows)) {
    try {
      komp.feed = buildFeed(data.kompetitor.rows);
      komp.src = { state: 'live', at: Date.parse(data.kompetitor.at) || Date.now(), msg: '' };
    } catch (e) {
      komp.src = { state: 'err', at: komp.src.at, msg: e.message };
    }
  } else if (data.kompetitorError) {
    komp.src = { state: 'err', at: komp.src.at, msg: data.kompetitorError };
  } else if (komp.src.state === 'none') {
    komp.src = { state: 'err', at: null, msg: 'Apps Script belum mengirim Feed Kompetitor. Perbarui script (Code.gs terbaru) lalu deploy versi baru.' };
  }
  applyMain();
}

async function refreshKompetitor() {
  if (!cloud.url) return;
  komp.src = { ...komp.src, busy: true };
  renderKompetitor(selection());
  try {
    const data = await cloudFetch(`${cloud.url}${cloud.url.includes('?') ? '&' : '?'}action=kompetitor`);
    applyKompetitorFeed(data);
    toast('Harga kompetitor diperbarui');
  } catch (e) {
    komp.src = { state: 'err', at: komp.src.at, msg: e.message };
  }
  scheduleRender(true);
}

function applyMain() {
  for (const o of komp.outlets) o.trackedBy = Object.keys(CENTERS).filter((c) => knorm(komp.feed.main[c]) === o.ckey);
}

// ---------------------------------------------------------------- jarak & harga

const straightKm = (o, code) => { const c = CENTERS[code]; return c ? haversine(c.lat, c.lon, o.lat, o.lng) : Infinity; };
const motorAvail = (code) => komp.outlets.some((o) => o.m && o.m[code]);
const motorKm = (o, code) => (o.m && o.m[code] ? o.m[code][0] : null);
const motorMin = (o, code) => (o.m && o.m[code] ? o.m[code][1] : null);
const useMotor = (code) => kstate.mode === 'motor' && motorAvail(code);
const kmOf = (o, code) => (useMotor(code) ? (motorKm(o, code) ?? Infinity) : straightKm(o, code));
function nearestCenterOf(o) {
  let best = null;
  for (const code of Object.keys(CENTERS)) { const v = kmOf(o, code); if (!best || v < best.v) best = { c: code, v }; }
  return best || { c: null, v: Infinity };
}
const distSel = (o) => (state.center === 'ALL' ? nearestCenterOf(o).v : kmOf(o, state.center));
const inRadius = (o) => distSel(o) <= kstate.radius;
const unitTxt = (code) => (useMotor(code) ? 'km tempuh motor' : 'km garis lurus');
const minTxt = (o, code) => (useMotor(code) && motorMin(o, code) != null ? ` · ±${motorMin(o, code)} mnt` : '');

function priceAt(o, dur, end) {
  let best = null; let prev = null;
  const d = knorm(dur);
  for (const r of komp.feed.log) if (r.comp === o.ckey && r.dur === d && r.t <= end && (!best || r.t >= best.t)) best = r;
  if (best) for (const r of komp.feed.log) if (r.comp === o.ckey && r.dur === d && r.t < best.t && (!prev || r.t > prev.t)) prev = r;
  return best ? { ...best, prev } : null;
}
function sparksAt(center, dur, end) {
  let best = null;
  const d = knorm(dur);
  for (const r of komp.feed.sp) if (r.center === center && r.dur === d && !/^star/i.test(r.paket) && r.t <= end && (!best || r.t >= best.t)) best = r;
  return best;
}
// Gap per sesi: positif = harga bottom Sparks lebih mahal per sesi.
function gapOf(sp, p) { if (!sp || !p || !sp.bottom || !sp.sesi || !p.sesi) return null; return (sp.bottom / sp.sesi) / (p.harga / p.sesi) - 1; }
const curPrice = (o) => priceAt(o, kstate.dur, monthEndT(kstate.month || curMonthKey()));
const trackedOf = (code) => komp.outlets.find((o) => o.trackedBy.includes(code)) || null;
const nearestOutlets = (code, n) => komp.outlets.slice().sort((a, b) => kmOf(a, code) - kmOf(b, code)).slice(0, n);
const countWithin = (code, R) => komp.outlets.filter((o) => kmOf(o, code) <= R).length;
const isNearest = (tr, n, code) => tr.id === n.id || kmOf(tr, code) - kmOf(n, code) < 0.3;

function changeTag(o) {
  const p = curPrice(o);
  if (!p) return '';
  const q = priceAt(o, kstate.dur, monthEndT(prevMonthKey(kstate.month)));
  if (!q || q.harga === p.harga) return '';
  const d = p.harga - q.harga;
  return `<span class="ktag ${d < 0 ? 'down' : 'up'}">${d < 0 ? '▼ turun' : '▲ naik'} ${fmtJt(Math.abs(d))} dari ${monthShortK(prevMonthKey(kstate.month))}</span>`;
}
function priceLine(o, center) {
  const p = curPrice(o);
  if (!p) return `<span class="muted">${komp.src.state === 'live' ? `Belum ada harga paket ${kstate.dur} s.d. ${monthShortK(kstate.month)}` : 'Harga belum tersedia'}</span>`;
  const g = gapOf(sparksAt(center, kstate.dur, monthEndT(kstate.month)), p);
  return `<span class="ktag price">${fmtRp(p.harga)}</span>${p.sesi ? `${p.sesi} sesi · ` : ''}survei ${fmtDateK(p.t)}${g != null ? ` · Sparks ${g >= 0 ? 'lebih mahal' : 'lebih murah'} ${fmtGap(Math.abs(g)).replace('+', '')}/sesi` : ''}`;
}

// ---------------------------------------------------------------- member vs kompetitor

// Cabang Studiorenang terdekat (garis lurus) dari titik alamat member.
function nearestOutletOf(key, g) {
  const memo = nearMemo.get(key);
  if (memo && memo.lat === g.lat && memo.lon === g.lon) return memo;
  let best = null;
  for (const o of komp.outlets) {
    const d = haversine(g.lat, g.lon, o.lat, o.lng);
    if (!best || d < best.d) best = { id: o.id, d };
  }
  const res = { lat: g.lat, lon: g.lon, id: best ? best.id : null, d: best ? best.d : Infinity };
  nearMemo.set(key, res);
  return res;
}
// true bila member tinggal lebih dekat ke cabang Studiorenang daripada ke center Sparks-nya.
function closerToKomp(x) {
  if (!komp.ready || x.dist == null) return false;
  return nearestOutletOf(x.m.key, x.g).d < x.dist;
}

function crossStats(sel) {
  const rows = sel.mapped.filter((x) => x.dist != null);
  const perCenter = new Map();
  const perOutlet = new Map();
  let closer = 0;
  for (const x of rows) {
    const n = nearestOutletOf(x.m.key, x.g);
    const isCloser = n.d < x.dist;
    if (isCloser) closer++;
    let pc = perCenter.get(x.m.center);
    if (!pc) { pc = { n: 0, closer: 0, pull: new Map() }; perCenter.set(x.m.center, pc); }
    pc.n++;
    if (isCloser) { pc.closer++; pc.pull.set(n.id, (pc.pull.get(n.id) || 0) + 1); }
    if (n.id != null) {
      let po = perOutlet.get(n.id);
      if (!po) { po = { near: 0, closer: 0, centers: new Map() }; perOutlet.set(n.id, po); }
      if (n.d <= kstate.radius) po.near++;
      if (isCloser) { po.closer++; po.centers.set(x.m.center, (po.centers.get(x.m.center) || 0) + 1); }
    }
  }
  return { total: rows.length, closer, perCenter, perOutlet };
}

// ---------------------------------------------------------------- peta

let kompLayer = null;
function ensureKompLayer() {
  if (!kompLayer) kompLayer = L.layerGroup();
  return kompLayer;
}

function outletIcon(o, hit, price) {
  const cls = `omark${hit ? ' hit' : ''}${o.trackedBy.length ? ' trk' : ''}`;
  return L.divIcon({
    html: `<div class="${cls}"><i></i>${price ? `<span class="opill">${fmtJt(price.harga)}</span>` : ''}</div>`,
    className: '', iconSize: [16, 16], iconAnchor: [8, 8],
  });
}

function outletPopup(o) {
  const c = state.center === 'ALL' ? nearestCenterOf(o).c : state.center;
  const p = curPrice(o);
  const sp = c ? sparksAt(c, kstate.dur, monthEndT(kstate.month)) : null;
  const g = gapOf(sp, p);
  const mk = c ? motorKm(o, c) : null;
  let pr = `<p class="muted" style="margin:8px 0 2px">Paket ${kstate.dur}, s.d. ${monthNameK(kstate.month)}</p>`;
  if (p) {
    pr += `<dl><dt>Studiorenang</dt><dd><b>${fmtRp(p.harga)}</b>${p.sesi ? ` · ${p.sesi} sesi (${fmtRp(p.harga / p.sesi)}/sesi)` : ''}<br><span class="muted">survei ${fmtDateK(p.t)}${p.prev ? ` · sebelumnya ${fmtRp(p.prev.harga)}` : ''}</span></dd>
      ${sp ? `<dt>Sparks ${esc(c)}</dt><dd>bottom ${fmtRp(sp.bottom)}${sp.sesi ? ` (${fmtRp(sp.bottom / sp.sesi)}/sesi)` : ''}</dd>` : ''}
      ${g != null ? `<dt>Gap/sesi</dt><dd><b>${fmtGap(g)}</b> ${g >= 0 ? '(Sparks lebih mahal)' : '(Sparks lebih murah)'}</dd>` : ''}</dl>${changeTag(o) ? `<p style="margin:6px 0 0">${changeTag(o)}</p>` : ''}`;
  } else {
    pr += `<p style="margin:0" class="muted">${komp.src.state === 'live' ? 'Belum ada harga untuk paket ini.' : 'Harga tampil setelah Apps Script tersambung (tab Data).'}</p>`;
  }
  const st = komp.feed.status[o.ckey] ? `<p class="muted" style="margin:6px 0 0">Status di sheet: ${esc(komp.feed.status[o.ckey])}</p>` : '';
  const tr = o.trackedBy.length ? `<p style="margin:6px 0 0"><span class="ktag trk">Kompetitor utama ${esc(o.trackedBy.join(', '))}</span></p>` : '';
  const po = komp.lastCross && komp.lastCross.perOutlet.get(o.id);
  const mem = po ? `<p style="margin:6px 0 0"><b>${fmtInt(po.closer)}</b> member lebih dekat ke cabang ini daripada ke center Sparks-nya</p>` : '';
  return `<div class="pop"><h3>Studiorenang ${esc(o.label)}</h3><p style="margin:0 0 6px" class="muted">${esc(o.addr)}</p>
    <dl>${c ? `<dt>${state.center === 'ALL' ? 'Center terdekat' : 'Ke center'}</dt><dd><b>${esc(c)}</b></dd>
      <dt>Tempuh motor</dt><dd>${mk != null ? `${kmTxt(mk)}${motorMin(o, c) != null ? ` · ±${motorMin(o, c)} mnt` : ''}` : '<span class="muted">belum dihitung</span>'}</dd>
      <dt>Garis lurus</dt><dd>${kmTxt(straightKm(o, c))}</dd>` : ''}</dl>
    ${pr}${st}${tr}${mem}${o.maps ? `<p style="margin:8px 0 0"><a href="${esc(o.maps)}" target="_blank" rel="noopener">Buka di Google Maps</a></p>` : ''}</div>`;
}

const outletMarkers = new Map();
function renderKompLayer() {
  const layer = ensureKompLayer();
  layer.clearLayers();
  outletMarkers.clear();
  const visible = komp.ready && kstate.show;
  if (visible && !map.hasLayer(layer)) layer.addTo(map);
  if (!visible) { if (map.hasLayer(layer)) map.removeLayer(layer); return; }
  const all = state.center === 'ALL';
  // Wilayah kota/kab diwarnai menurut jumlah cabang.
  if (kstate.shade) {
    const max = Math.max(1, ...komp.regions.map((r) => r.count));
    for (const r of komp.regions) {
      if (!r.count) continue;
      L.polygon(r.rings.map((ring) => ring.map(([x, y]) => [y, x])), {
        stroke: false, fillColor: KOMP_COLOR, fillOpacity: 0.05 + 0.22 * (r.count / max), interactive: false,
      }).addTo(layer);
    }
  }
  // Rute motor (≤ radius) atau lingkaran radius garis lurus.
  const codes = all ? Object.keys(CENTERS) : [state.center];
  for (const code of codes) {
    const c = CENTERS[code];
    if (!c) continue;
    if (useMotor(code)) {
      for (const o of komp.outlets) {
        if (!(kmOf(o, code) <= kstate.radius)) continue;
        const pts = komp.routes.get(`${code}|${o.id}`);
        if (pts) L.polyline(pts, { color: '#1c5cab', weight: 2.5, opacity: all ? 0.45 : 0.75, interactive: false }).addTo(layer);
      }
    } else {
      L.circle([c.lat, c.lon], { radius: kstate.radius * 1000, color: '#1c5cab', weight: 1.5, opacity: 0.8, fillColor: '#1c5cab', fillOpacity: 0.05, interactive: false }).addTo(layer);
    }
  }
  for (const o of komp.outlets) {
    const hit = inRadius(o);
    const p = curPrice(o);
    const showPrice = p && (hit || all);
    const mk = L.marker([o.lat, o.lng], { icon: outletIcon(o, hit, showPrice ? p : null), zIndexOffset: hit ? 600 : 500, title: `Studiorenang ${o.label}`, keyboard: true })
      .bindPopup(() => outletPopup(o), { maxWidth: 290 })
      .addTo(layer);
    outletMarkers.set(o.id, mk);
  }
}

function showOutletOnMap(id) {
  const o = komp.outlets[id];
  if (!o) return;
  kstate.show = true;
  saveKstate();
  syncKompToggle();
  setView('map');
  renderKompLayer();
  map.setView([o.lat, o.lng], 14);
  setTimeout(() => { const mk = outletMarkers.get(id); if (mk) mk.openPopup(); }, 150);
}

function syncKompToggle() {
  const b = $('#btnKomp');
  if (b) b.setAttribute('aria-pressed', String(kstate.show));
  const h = $('#btnKompHi');
  if (h) { h.hidden = !kstate.show; h.setAttribute('aria-pressed', String(kstate.highlight)); }
}

// ---------------------------------------------------------------- tab Kompetitor

function kMonthOptions() {
  let first = '2025-10';
  for (const r of komp.feed.log.concat(komp.feed.sp)) {
    const d = new Date(r.t);
    const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (m < first) first = m;
  }
  const out = [];
  let m = curMonthKey(); let guard = 0;
  while (m >= first && guard++ < 60) { out.push(m); m = prevMonthKey(m); }
  return out;
}

function renderKompControls() {
  const opts = kMonthOptions();
  if (!opts.includes(kstate.month)) kstate.month = opts[0];
  $('#kMonth').innerHTML = opts.map((m) => `<option value="${m}" ${m === kstate.month ? 'selected' : ''}>${monthNameK(m)}</option>`).join('');
  $('#kDur').innerHTML = KOMP_DURS.map((d) => `<button type="button" data-d="${d}" aria-pressed="${kstate.dur === d}">${d}</button>`).join('');
  $('#kMode').innerHTML = Object.keys(KOMP_MODES).map((m) => `<button type="button" data-m="${m}" aria-pressed="${kstate.mode === m}">${KOMP_MODES[m]}</button>`).join('');
  $('#kRadius').innerHTML = KOMP_RADII.map((r) => `<button type="button" data-r="${r}" aria-pressed="${kstate.radius === r}">${r} km</button>`).join('');
  $('#kShade').checked = kstate.shade;
}

function renderKompSrc() {
  const box = $('#kSrc');
  const t = (ms) => new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  let cls = 'ksrc';
  let msg = '';
  let acts = '';
  if (!cloud.url) {
    cls += ' warn';
    msg = 'Lokasi & jarak cabang tampil dari data aplikasi. Harga kompetitor & Sparks muncul setelah Apps Script tersambung di tab Data.';
    acts = '<button type="button" class="btn sm" data-goto="data">Buka tab Data</button>';
  } else if (komp.src.busy) {
    msg = 'Mengambil harga terbaru dari Google Sheet…';
  } else if (komp.src.state === 'live') {
    cls += ' ok';
    msg = `Harga live dari Google Sheet · diambil ${t(komp.src.at)}`;
    acts = '<button type="button" class="btn sm" id="kRefresh">Muat ulang harga</button>';
  } else {
    cls += ' err';
    msg = komp.src.msg || 'Harga kompetitor belum bisa diambil.';
    acts = '<button type="button" class="btn sm" id="kRefresh">Coba lagi</button>';
  }
  box.className = cls;
  box.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="msg">${esc(msg)}</span><span class="acts">${acts}</span>`;
}

function outletItem(o, code) {
  const c = code || nearestCenterOf(o).c;
  const v = kmOf(o, c);
  const trk = o.trackedBy.length ? '<span class="ktag trk">Kompetitor utama</span> ' : '';
  const dist = `${code ? '' : `Terdekat ke ${esc(c)} · `}${useMotor(c) && motorMin(o, c) != null ? `±${motorMin(o, c)} mnt` : 'garis lurus'}`;
  return `<li><button type="button" data-oid="${o.id}"><span class="odot${o.trackedBy.length ? ' trk' : ''}"></span><span class="nm">${esc(o.label)}</span><span class="km">${kmTxt(v)}</span>
    <span class="meta">${trk}${priceLine(o, c)} ${changeTag(o)}<br>${dist} · ${esc(o.region)}</span></button></li>`;
}

function spBox(code) {
  const sp = sparksAt(code, kstate.dur, monthEndT(kstate.month));
  if (!sp) return `<div class="spbox">Harga Sparks ${esc(code)} paket ${kstate.dur} belum tercatat sampai ${monthShortK(kstate.month)}.</div>`;
  return `<div class="spbox"><span>Sparks ${esc(code)} · ${esc(sp.paket)} · berlaku sejak ${fmtDateK(sp.t)}</span>
    <span>Pitch <b>${fmtRp(sp.pitch)}</b> · Bottom <b>${fmtRp(sp.bottom)}</b>${sp.sesi ? ` (${fmtRp(sp.bottom / sp.sesi)}/sesi)` : ''}</span></div>`;
}

function renderKompPanel() {
  const panel = $('#kPanel');
  const end = monthEndT(kstate.month);
  const R = kstate.radius;
  if (state.center === 'ALL') {
    const cards = Object.values(CENTERS).map((c) => {
      const n = nearestOutlets(c.code, 1)[0];
      const tr = trackedOf(c.code);
      const p = tr ? priceAt(tr, kstate.dur, end) : null;
      const g = p ? gapOf(sparksAt(c.code, kstate.dur, end), p) : null;
      const trTxt = tr ? `utama ${esc(tr.label)}: ${p ? fmtRp(p.harga) + (g != null ? ` (gap ${fmtGap(g)})` : '') : 'belum ada harga'}`
        : (komp.src.state === 'live' ? 'kompetitor utama belum diisi' : '');
      return `<button type="button" class="kcard" data-center="${esc(c.code)}"><span class="code" style="--c:${c.color}">${esc(c.code)}</span><span class="nm">${esc(c.name)}</span>
        <span class="km">${countWithin(c.code, R)} cabang</span><span class="meta">dalam ${R} ${unitTxt(c.code)}${n ? ` · terdekat ${esc(n.label)} ${kmTxt(kmOf(n, c.code))}` : ''}${trTxt ? `<br>${trTxt}` : ''}</span></button>`;
    }).join('');
    const priced = komp.outlets.filter((o) => priceAt(o, kstate.dur, end)).length;
    panel.innerHTML = `<div class="khead"><h2>Semua center</h2><p class="muted">${komp.outlets.length} cabang Studiorenang di Jabodetabek &amp; Karawang (dari ${komp.total} di seluruh Indonesia)</p></div>
      ${komp.src.state === 'live' ? `<div class="kstats"><div><b>${priced}</b><small>cabang punya harga paket ${kstate.dur} s.d. ${monthShortK(kstate.month)}</small></div><div><b>${komp.outlets.length - priced}</b><small>cabang belum disurvei untuk paket ini</small></div></div>` : ''}
      <div class="kcards">${cards}</div>`;
    return;
  }
  const c = CENTERS[state.center];
  const near = nearestOutlets(c.code, 1)[0];
  const within = komp.outlets.filter((o) => kmOf(o, c.code) <= R).sort((a, b) => kmOf(a, c.code) - kmOf(b, c.code));
  const tracked = trackedOf(c.code);
  let note = '';
  if (tracked && isNearest(tracked, near, c.code)) note = `<div class="knote ok">Kompetitor utama di sheet (${esc(tracked.label)}) memang cabang terdekat.</div>`;
  else if (tracked) note = `<div class="knote">Di sheet kompetitor utama <b>${esc(tracked.label)}</b> (${kmTxt(kmOf(tracked, c.code))}), padahal cabang terdekat <b>${esc(near.label)}</b> (${kmTxt(kmOf(near, c.code))}).</div>`;
  if (kstate.mode === 'motor' && !motorAvail(c.code)) note += `<div class="knote">Rute motor untuk ${esc(c.code)} belum dihitung, jadi jarak memakai garis lurus.</div>`;
  const list = within.length ? `<ul class="olist">${within.map((o) => outletItem(o, c.code)).join('')}</ul>`
    : `<p class="muted" style="margin:0">Tidak ada cabang dalam ${R} ${unitTxt(c.code)}. Tiga terdekat:</p><ul class="olist">${nearestOutlets(c.code, 3).map((o) => outletItem(o, c.code)).join('')}</ul>`;
  panel.innerHTML = `<div class="khead"><h2>${esc(c.code)} · ${esc(c.name)}</h2><p class="muted">${esc(c.addr)}</p></div>
    <div class="kstats"><div><b>${within.length}</b><small>cabang Studiorenang ≤ ${R} ${unitTxt(c.code)}</small></div>
      <div><b>${kmTxt(kmOf(near, c.code))}</b><small>ke cabang terdekat (${esc(near.label)})${minTxt(near, c.code)}</small></div></div>
    ${komp.src.state === 'live' ? spBox(c.code) : ''}${note}${list}`;
}

function renderKompTable() {
  const end = monthEndT(kstate.month);
  const live = komp.src.state === 'live';
  const rows = Object.values(CENTERS).map((c) => {
    const n = nearestOutlets(c.code, 1)[0];
    const tr = trackedOf(c.code);
    const ok = tr && isNearest(tr, n, c.code);
    const pill = !live ? '' : !tr ? '<span class="pill warn">Belum diisi</span>' : ok ? '<span class="pill ok">Terdekat</span>' : '<span class="pill warn">Bukan yang terdekat</span>';
    const dd = (o) => `<span class="muted">${kmTxt(kmOf(o, c.code))}${minTxt(o, c.code)}</span>`;
    const sp = sparksAt(c.code, kstate.dur, end);
    const p = tr ? priceAt(tr, kstate.dur, end) : null;
    const g = gapOf(sp, p);
    const gp = g == null ? '–' : `<span class="pill ${g > 0.1 ? 'bad' : g >= 0.05 ? 'warn' : 'ok'}">${fmtGap(g)}</span>`;
    return `<tr data-center="${esc(c.code)}"><td><span class="cdot" style="--c:${c.color}"></span><b>${esc(c.code)}</b><br><span class="muted">${esc(c.name)}</span></td>
      <td class="num">${countWithin(c.code, 3)}</td><td class="num">${countWithin(c.code, 5)}</td><td class="num">${countWithin(c.code, 10)}</td>
      <td>${n ? `${esc(n.label)}<br>${dd(n)}` : '–'}</td>
      <td>${tr ? `${esc(tr.label)}<br>${dd(tr)}<br>${pill}` : pill || '–'}</td>
      <td class="num">${sp ? fmtRp(sp.bottom) : '–'}</td>
      <td class="num">${p ? `${fmtRp(p.harga)}<br><span class="muted">${fmtDateK(p.t)}</span>` : '<span class="muted">–</span>'}</td>
      <td class="num">${gp}</td></tr>`;
  }).join('');
  $('#kTblCap').textContent = `Paket ${kstate.dur}, harga s.d. akhir ${monthNameK(kstate.month)}. Jarak: ${kstate.mode === 'motor' ? 'tempuh motor (jalan non-tol)' : 'garis lurus'}. Gap per sesi = harga bottom Sparks dibanding harga kompetitor utama; positif = Sparks lebih mahal.`;
  $('#kTbl').innerHTML = `<thead><tr><th>Center</th><th class="num">≤ 3 km</th><th class="num">≤ 5 km</th><th class="num">≤ 10 km</th><th>Cabang terdekat</th><th>Kompetitor utama</th><th class="num">Bottom Sparks</th><th class="num">Harga kompetitor utama</th><th class="num">Gap / sesi</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderCross(sel) {
  const box = $('#kCross');
  if (!komp.ready) { box.innerHTML = ''; return; }
  const cs = crossStats(sel);
  komp.lastCross = cs;
  if (!cs.total) { box.innerHTML = '<p class="muted">Belum ada member yang terpetakan.</p>'; return; }
  const pct = (a, b) => (b ? fmtPct(a / b) : '–');
  const centerRows = [...cs.perCenter.entries()].filter(([code]) => CENTERS[code]).map(([code, pc]) => {
    const top = [...pc.pull.entries()].sort((a, b) => b[1] - a[1])[0];
    const o = top ? komp.outlets[top[0]] : null;
    return `<tr data-center="${esc(code)}"><td><span class="cdot" style="--c:${CENTERS[code].color}"></span><b>${esc(code)}</b></td>
      <td class="num">${fmtInt(pc.n)}</td><td class="num"><b>${fmtInt(pc.closer)}</b><br><span class="muted">${pct(pc.closer, pc.n)}</span></td>
      <td>${o ? `${esc(o.label)} <span class="muted">(${fmtInt(top[1])})</span>` : '–'}</td></tr>`;
  }).join('');
  const outletRows = [...cs.perOutlet.entries()].filter(([, po]) => po.closer || po.near)
    .sort((a, b) => b[1].closer - a[1].closer || b[1].near - a[1].near).slice(0, 12).map(([id, po]) => {
      const o = komp.outlets[id];
      const cens = [...po.centers.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${esc(c)} ${fmtInt(n)}`).join(', ');
      return `<tr data-oid="${id}"><td><b>${esc(o.label)}</b><br><span class="muted">${esc(o.region)}${o.trackedBy.length ? ' · kompetitor utama' : ''}</span></td>
        <td class="num"><b>${fmtInt(po.closer)}</b>${cens ? `<br><span class="muted">${cens}</span>` : ''}</td><td class="num">${fmtInt(po.near)}</td></tr>`;
    }).join('');
  box.innerHTML = `<div class="kpi kpi-wide"><div class="k-label">Member yang tinggal lebih dekat ke cabang Studiorenang daripada ke center Sparks-nya</div>
      <p class="hero">${fmtInt(cs.closer)} <small>dari ${fmtInt(cs.total)} member (${pct(cs.closer, cs.total)})</small></p>
      <p class="sub">Jarak garis lurus dari titik alamat. Mengikuti filter center${state.hiddenMonths.size ? ' &amp; bulan' : ''} di atas.</p></div>
    <div class="sec-head"><h2>Per center</h2><span class="hint">Ketuk baris untuk memilih center</span></div>
    <div class="table-wrap"><table class="tbl" id="kCrossCenters"><thead><tr><th>Center</th><th class="num">Member</th><th class="num">Lebih dekat ke kompetitor</th><th>Cabang yang paling banyak "menarik"</th></tr></thead><tbody>${centerRows}</tbody></table></div>
    <div class="sec-head"><h2>Cabang paling bersinggungan</h2><span class="hint">Ketuk baris untuk melihat di peta</span></div>
    <div class="table-wrap"><table class="tbl" id="kCrossOutlets"><thead><tr><th>Cabang Studiorenang</th><th class="num">Member lebih dekat ke cabang ini</th><th class="num">Member ≤ ${kstate.radius} km</th></tr></thead><tbody>${outletRows || '<tr><td class="empty" colspan="3">Tidak ada.</td></tr>'}</tbody></table></div>`;
}

function renderKompMethod() {
  const gw = komp.outlets.find((o) => o.key === 'Grand Wisata');
  $('#kMethod').innerHTML = `
    <p><b>Harga</b> dari Google Sheet <i>Sparks Swim - Competitor Analysis</i> (tab Log Harga, Harga Sparks, Ringkasan) lewat sheet <i>Feed Kompetitor</i>, diambil oleh Apps Script. Harga per cabang = survei terakhir untuk paket itu sampai akhir bulan yang dipilih; harga Sparks = harga yang berlaku sampai akhir bulan itu. Tambah harga baru di Log Harga, aplikasi ikut berubah.</p>
    <p><b>Cabang Studiorenang</b>: ${esc(komp.meta.source || 'daftar resmi studiorenang.com')}, lengkap dengan koordinat dan link Google Maps.</p>
    <p><b>Jarak tempuh motor</b>: ${esc(komp.meta.routing || 'mesin rute OpenStreetMap')}. Menit = tanpa macet.${gw && motorKm(gw, 'KLM') != null ? ` Contoh: KLM ke Grand Wisata ${kmTxt(motorKm(gw, 'KLM'))} (±${motorMin(gw, 'KLM')} mnt), garis lurus ${kmTxt(straightKm(gw, 'KLM'))}.` : ''} Rute dihitung untuk 6 center awal; center baru memakai jarak garis lurus sampai rutenya dihitung.</p>
    <p><b>Member vs kompetitor</b>: untuk tiap member, jarak garis lurus rumah → center Sparks-nya dibanding rumah → cabang Studiorenang terdekat.</p>
    <p><b>Batas wilayah</b> (warna per jumlah cabang): OpenStreetMap (ODbL).</p>`;
}

function renderKompetitor(sel) {
  if (!$('#v-komp')) return;
  if (!komp.ready) { $('#kPanel').innerHTML = '<p class="muted">Memuat data kompetitor…</p>'; return; }
  if (!kstate.month) kstate.month = curMonthKey();
  renderKompSrc();
  renderKompControls();
  renderKompPanel();
  renderKompTable();
  renderCross(sel);
  renderKompMethod();
}

// ---------------------------------------------------------------- state & event

function loadKstate() {
  try {
    const s = JSON.parse(store.get('kompetitor.ui') || 'null');
    if (!s) return;
    if (KOMP_DURS.includes(s.dur)) kstate.dur = s.dur;
    if (KOMP_MODES[s.mode]) kstate.mode = s.mode;
    if (KOMP_RADII.includes(s.radius)) kstate.radius = s.radius;
    kstate.shade = !!s.shade;
    kstate.show = !!s.show;
    kstate.highlight = !!s.highlight;
  } catch { /* abaikan */ }
}
function saveKstate() {
  store.set('kompetitor.ui', JSON.stringify({ dur: kstate.dur, mode: kstate.mode, radius: kstate.radius, shade: kstate.shade, show: kstate.show, highlight: kstate.highlight }));
}

function bindKompEvents() {
  const rerender = () => { saveKstate(); scheduleRender(true); };
  $('#kMonth').addEventListener('change', (e) => { kstate.month = e.target.value; rerender(); });
  $('#kDur').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) { kstate.dur = b.dataset.d; rerender(); } });
  $('#kMode').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) { kstate.mode = b.dataset.m; rerender(); } });
  $('#kRadius').addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { kstate.radius = +b.dataset.r; rerender(); } });
  $('#kShade').addEventListener('change', (e) => { kstate.shade = e.target.checked; rerender(); });
  $('#v-komp').addEventListener('click', (e) => {
    if (e.target.closest('#kRefresh')) { refreshKompetitor(); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { setView(go.dataset.goto); return; }
    const oid = e.target.closest('[data-oid]');
    if (oid) { showOutletOnMap(+oid.dataset.oid); return; }
    const cen = e.target.closest('[data-center]');
    if (cen && CENTERS[cen.dataset.center]) selectCenter(cen.dataset.center);
  });
  $('#btnKomp').addEventListener('click', () => { kstate.show = !kstate.show; syncKompToggle(); rerender(); });
  $('#btnKompHi').addEventListener('click', () => { kstate.highlight = !kstate.highlight; syncKompToggle(); resetMarkers(); rerender(); });
  syncKompToggle();
}
