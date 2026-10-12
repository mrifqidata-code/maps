/* Sebaran Member — peta persebaran member per center.
 * Data: CSV Google Sheet (publish to web) atau upload file CSV.
 * Geocoding: Nominatim (OpenStreetMap), maks 1 request/detik, hasil di-cache di IndexedDB. */
'use strict';

// ---------------------------------------------------------------- konfigurasi

// Daftar center bawaan. Bila Apps Script tersambung, daftar diambil dari tab "Centers" di sheet.
const DEFAULT_CENTERS = [
  { code: 'HIB', name: 'Harapan Indah Bekasi', lat: -6.179084581029557, lon: 106.97414478968899,
    addr: 'Mega Office Park, Jl. Harapan Indah Boulevard, Medan Satria, Kota Bekasi 17132' },
  { code: 'KLM', name: 'Kalimalang', lat: -6.239288418633617, lon: 106.8997994939914,
    addr: 'Jl. Pahlawan Revolusi No.11, Pd. Bambu, Duren Sawit, Jakarta Timur 13430' },
  { code: 'KWC', name: 'Karawaci', lat: -6.2185146814319925, lon: 106.61665600503935,
    addr: 'Jl. Palem Semi, Panunggangan Barat, Cibodas, Kota Tangerang 15318' },
  { code: 'PML', name: 'Pamulang', lat: -6.346124651378747, lon: 106.69648245109295,
    addr: 'Jl. Raya Puspitek, Babakan, Setu, Tangerang Selatan 15315' },
  { code: 'BTU', name: 'Bintaro U-Town', lat: -6.292965677930978, lon: 106.72602235903597,
    addr: 'Bintaro U-Town Jaya, Jl. Boulevard UPJ No.1, Sawah Baru, Ciputat, Tangerang Selatan 15413' },
  { code: 'TMP', name: 'Taman Palem', lat: -6.124072093581825, lon: 106.70609238967546,
    addr: 'Jl. Palem Raja Barat No.10, Pegadungan, Kalideres, Jakarta Barat 11830' },
];
const CENTER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const CENTERS = {}; // kode -> {code, name, lat, lon, addr, color}

// Mengganti daftar center. Mengembalikan true bila isinya berubah.
function setCenters(list) {
  const valid = (Array.isArray(list) ? list : [])
    .map((c) => ({
      code: String(c.code || '').trim().toUpperCase(), name: String(c.name || '').trim(), addr: String(c.addr || '').trim(),
      lat: Number(c.lat), lon: Number(c.lon), color: String(c.color || '').trim(), active: c.active !== false,
    }))
    .filter((c) => c.code && c.active && Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180);
  const src = valid.length ? valid : DEFAULT_CENTERS;
  const next = {};
  src.forEach((c, i) => {
    if (next[c.code]) return;
    const color = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color
      : (CENTER_COLORS[i] || `hsl(${Math.round((i * 137.508) % 360)}, 62%, 46%)`);
    next[c.code] = { code: c.code, name: c.name || c.code, lat: c.lat, lon: c.lon, addr: c.addr || '', color };
  });
  const changed = JSON.stringify(next) !== JSON.stringify(CENTERS);
  for (const k of Object.keys(CENTERS)) delete CENTERS[k];
  Object.assign(CENTERS, next);
  if (valid.length) store.set('centers', JSON.stringify(Object.values(next)));
  const sub = document.querySelector('.brand p');
  if (sub) sub.textContent = Object.keys(CENTERS).join(' · ');
  if (changed && typeof map !== 'undefined' && map) {
    if (state.center !== 'ALL' && !CENTERS[state.center]) state.center = 'ALL';
    drawCenters();
    drawRings();
  }
  return changed;
}
const OTHER_COLOR = '#898781';
const MONTH_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300',
  '#4a3aa7', '#e34948', '#0f9fb5', '#8c564b', '#b5179e', '#5b6b00'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const PHOTON = 'https://photon.komoot.io';
const REQ_INTERVAL = 1100;            // kebijakan Nominatim: maks 1 request/detik
const CENTER_BOX_DEG = 0.3;           // ±0.3° (~33 km) di sekitar center untuk pencarian pertama
const WIDE_BOX = [106.30, -5.95, 107.35, -6.75]; // Jabodetabek (lon1, lat1, lon2, lat2)
const COARSE_TYPES = new Set(['country', 'state', 'region', 'province', 'state_district',
  'county', 'city', 'municipality']);
const CACHE_VERSION = 1;
const KEL_PAGE = 25;
const FAIL_PAGE = 30;

// ---------------------------------------------------------------- state

const state = {
  members: [],          // {id, name, sid, center, addr, month, dateLabel, key}
  noAddress: 0,
  totalRows: 0,
  months: [],           // semua bulan (YYYY-MM) terurut, untuk warna stabil
  center: 'ALL',
  mode: 'cluster',
  hiddenMonths: new Set(),
  kelLimit: KEL_PAGE,
  failLimit: FAIL_PAGE,
  kelQuery: '',
  editingFail: null,
  view: 'map',
  loaded: false,
};
const cache = new Map();                // key -> hasil geocoding
const queue = { items: [], running: false, paused: false, total: 0, done: 0, ok: 0, fail: 0,
  durations: [], error: '' };

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtInt = (n) => n.toLocaleString('id-ID');
const fmtPct = (r) => `${(r * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const fmtKm = (n) => n.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* abaikan */ } },
};

// ---------------------------------------------------------------- IndexedDB cache

const idb = {
  db: null,
  open() {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open('sebaran-member', 1); } catch { resolve(null); return; }
      req.onupgradeneeded = () => req.result.createObjectStore('geo');
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => resolve(null);
    });
  },
  tx(mode) { return this.db.transaction('geo', mode).objectStore('geo'); },
  loadAll() {
    return new Promise((resolve) => {
      if (!this.db) { resolve(); return; }
      const req = this.tx('readonly').openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { resolve(); return; }
        if (cur.value && cur.value.v === CACHE_VERSION) cache.set(cur.key, cur.value);
        cur.continue();
      };
      req.onerror = () => resolve();
    });
  },
  put(key, val) {
    if (!this.db) return;
    try { this.tx('readwrite').put(val, key); } catch { /* abaikan */ }
  },
  del(key) {
    if (!this.db) return;
    try { this.tx('readwrite').delete(key); } catch { /* abaikan */ }
  },
  clear() {
    if (!this.db) return Promise.resolve();
    return new Promise((resolve) => {
      const req = this.tx('readwrite').clear();
      req.onsuccess = req.onerror = () => resolve();
    });
  },
};

// ---------------------------------------------------------------- utilitas

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function monthColor(key) {
  if (!key) return OTHER_COLOR;
  const i = state.months.indexOf(key);
  if (i < 0) return OTHER_COLOR;
  if (i < MONTH_COLORS.length) return MONTH_COLORS[i];
  return `hsl(${Math.round((i * 137.508) % 360)}, 62%, 46%)`;
}
function monthLabel(key) {
  if (!key) return 'Tanpa tanggal';
  const [y, m] = key.split('-');
  return `${BULAN[+m - 1]} ${y}`;
}
function memberColor(m) {
  if (state.center === 'ALL') return CENTERS[m.center]?.color || OTHER_COLOR;
  return monthColor(m.month);
}

// ---------------------------------------------------------------- batas kelurahan (Dukcapil)
// Kelurahan ditentukan dari poligon batas wilayah resmi tempat titik geocode jatuh
// (point-in-polygon), bukan dari label alamat geocoder. Data: data/kelurahan-jabodetabek.json,
// dibangun oleh tools/build_kelurahan.py.

const KEL_URL = 'data/kelurahan-jabodetabek.json';
const KEL_CELL = 200;            // sel grid 0,02° (koordinat disimpan ×10.000)
const KEL_NEAR = 30;             // titik di celah antar-poligon: ambil poligon terdekat dalam ±300 m
const KEL_TEXT_KM = 4;           // nama kelurahan di teks alamat dipakai bila dalam radius ini
const kelDb = { ready: false, items: [], grid: new Map() };
const adminMemo = new Map();     // key alamat -> {lat, lon, res}

function titleCase(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s.(/-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}
function normPlace(s) {
  return String(s || '').toUpperCase()
    .replace(/\bPDK?\b\.?/g, 'PONDOK ').replace(/\bKP\b\.?/g, 'KAMPUNG ').replace(/\bKEL\b\.?/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildKelDb(raw) {
  kelDb.items = [];
  kelDb.grid = new Map();
  raw.kel.forEach((k, i) => {
    const [name, kecIdx, ...encRings] = k;
    const [kecName, kabIdx] = raw.kec[kecIdx];
    let minx = Infinity; let miny = Infinity; let maxx = -Infinity; let maxy = -Infinity;
    let sx = 0; let sy = 0; let n = 0;
    const rings = encRings.map((flat) => {
      const pts = new Int32Array(flat.length);
      let x = flat[0];
      let y = flat[1];
      pts[0] = x; pts[1] = y;
      for (let j = 2; j < flat.length; j += 2) { x += flat[j]; y += flat[j + 1]; pts[j] = x; pts[j + 1] = y; }
      for (let j = 0; j < pts.length; j += 2) {
        const px = pts[j]; const py = pts[j + 1];
        if (px < minx) minx = px;
        if (px > maxx) maxx = px;
        if (py < miny) miny = py;
        if (py > maxy) maxy = py;
        sx += px; sy += py; n++;
      }
      return pts;
    });
    const it = {
      i, name, kec: kecName, kab: raw.kab[kabIdx], rings,
      bbox: [minx, miny, maxx, maxy], cx: sx / n, cy: sy / n,
      pad: ` ${normPlace(name)} `, ll: null,
    };
    kelDb.items.push(it);
    for (let gx = Math.floor(minx / KEL_CELL); gx <= Math.floor(maxx / KEL_CELL); gx++) {
      for (let gy = Math.floor(miny / KEL_CELL); gy <= Math.floor(maxy / KEL_CELL); gy++) {
        const key = `${gx}:${gy}`;
        if (!kelDb.grid.has(key)) kelDb.grid.set(key, []);
        kelDb.grid.get(key).push(it);
      }
    }
  });
}

async function loadKelurahan() {
  try {
    const res = await fetch(KEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buildKelDb(await res.json());
    kelDb.ready = true;
    adminMemo.clear();
    scheduleRender(true);
  } catch {
    // Tanpa data batas: kelurahan memakai label dari geocoder.
  }
}

function inRing(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i]; const yi = pts[i + 1]; const xj = pts[j]; const yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  const ex = ax + t * dx - px; const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

function kelLocate(lat, lon) {
  if (!kelDb.ready) return null;
  const x = lon * 1e4; const y = lat * 1e4;
  const cx = Math.floor(x / KEL_CELL); const cy = Math.floor(y / KEL_CELL);
  for (const it of kelDb.grid.get(`${cx}:${cy}`) || []) {
    const b = it.bbox;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    if (it.rings.some((r) => inRing(r, x, y))) return { it, near: false };
  }
  let best = null;
  let bestD = KEL_NEAR * KEL_NEAR;
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const it of kelDb.grid.get(`${gx}:${gy}`) || []) {
        for (const r of it.rings) {
          for (let j = 2; j < r.length; j += 2) {
            const d = segDist2(x, y, r[j - 2], r[j - 1], r[j], r[j + 1]);
            if (d < bestD) { bestD = d; best = it; }
          }
        }
      }
    }
  }
  return best ? { it: best, near: true } : null;
}

// Nama kelurahan yang tertulis di alamat, bila letaknya dekat titik geocode.
function kelFromText(addr, lat, lon) {
  const text = ` ${normPlace(addr)} `;
  const x = lon * 1e4; const y = lat * 1e4;
  const kx = Math.cos((lat * Math.PI) / 180);
  let best = null;
  for (const it of kelDb.items) {
    if (it.name === it.kec) continue; // "Duren Sawit" di alamat biasanya maksudnya kecamatan
    if (!text.includes(it.pad)) continue;
    const km = (Math.hypot((it.cx - x) * kx, it.cy - y) / 1e4) * 111.32;
    if (km > KEL_TEXT_KM) continue;
    if (!best || it.pad.length > best.it.pad.length || (it.pad.length === best.it.pad.length && km < best.km)) best = { it, km };
  }
  return best && best.it;
}

function packAdmin(it, how) {
  return { kel: titleCase(it.name), kec: titleCase(it.kec), kab: titleCase(it.kab), idx: it.i, how };
}

// how: 'poligon' | 'dekat' (di celah batas) | 'teks' (dari nama di alamat) | 'geocoder' (di luar data batas)
function adminFor(key, g, addr) {
  if (!g || g.status !== 'ok') return null;
  if (!kelDb.ready) return g.kel ? { kel: g.kel, kec: g.kec, kab: g.city, idx: null, how: 'geocoder' } : null;
  const memo = adminMemo.get(key);
  if (memo && memo.lat === g.lat && memo.lon === g.lon) return memo.res;
  const hit = kelLocate(g.lat, g.lon);
  let res = null;
  if (g.level !== 'alamat') {
    const txt = kelFromText(addr, g.lat, g.lon);
    if (txt && (!hit || txt !== hit.it)) res = packAdmin(txt, 'teks');
  }
  if (!res && hit) res = packAdmin(hit.it, hit.near ? 'dekat' : 'poligon');
  if (!res && g.kel) res = { kel: g.kel, kec: g.kec, kab: g.city, idx: null, how: 'geocoder' };
  adminMemo.set(key, { lat: g.lat, lon: g.lon, res });
  return res;
}

function kelLatLngs(it) {
  if (!it.ll) it.ll = it.rings.map((r) => { const out = []; for (let j = 0; j < r.length; j += 2) out.push([r[j + 1] / 1e4, r[j] / 1e4]); return out; });
  return it.ll;
}

// ---------------------------------------------------------------- parsing data

function toCsvUrl(input) {
  const u = input.trim();
  let m = u.match(/docs\.google\.com\/spreadsheets\/d\/e\/([\w-]+)\/pub(?:html)?/);
  if (m) {
    const gid = (u.match(/[?&#]gid=(\d+)/) || [])[1];
    return `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=csv${gid ? `&gid=${gid}&single=true` : ''}`;
  }
  m = u.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (m) {
    const gid = (u.match(/[?&#]gid=(\d+)/) || [])[1] || '0';
    return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
  }
  return u;
}

function normHeader(h) { return String(h || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function findColumns(header) {
  const h = header.map(normHeader);
  const find = (pred) => h.findIndex(pred);
  return {
    center: find((x) => x === 'center' || x.startsWith('center')),
    name: find((x) => (x.includes('child') && x.includes('name')) || x.startsWith('nama')),
    sid: find((x) => x.includes('sparks id') || x.includes('sparks_id') || x === 'id sparks'),
    addr: find((x) => x.startsWith('alamat') || x === 'address'),
    tgl: find((x) => x.startsWith('tgl regis') || x.startsWith('tanggal regis') || x.startsWith('tgl. regis')),
    year: find((x) => x.startsWith('regist year') || x.startsWith('regis year')),
    month: find((x) => x.startsWith('regist month') || x.startsWith('regis month')),
  };
}

function parseMonth(tgl, yCol, mCol) {
  const s = String(tgl || '').trim();
  let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (r) return `${r[1]}-${r[2].padStart(2, '0')}`;
  const y = parseInt(yCol, 10);
  const m = parseInt(mCol, 10);
  if (y > 1900 && m >= 1 && m <= 12) return `${y}-${String(m).padStart(2, '0')}`;
  r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); // format Indonesia D/M/Y
  if (r && +r[2] >= 1 && +r[2] <= 12) return `${r[3]}-${r[2].padStart(2, '0')}`;
  return '';
}

function dateLabel(tgl) {
  const r = String(tgl || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!r) return String(tgl || '').trim();
  return `${+r[3]} ${BULAN[+r[2] - 1]} ${r[1]}`;
}

function isUsableAddress(a) {
  const t = a.trim();
  if (t.length < 4) return false;
  if (!/[a-z]/i.test(t)) return false;
  if (/^(-+|n\/?a|null|tidak ada|belum ada|kosong)$/i.test(t)) return false;
  return true;
}

function normAddr(a) { return a.toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim(); }

function parseCsvRows(text) { return Papa.parse(text, { skipEmptyLines: 'greedy' }).data; }

function parseRows(rows) {
  const hIdx = rows.findIndex((r, i) => i < 20 && r.some((c) => normHeader(c).startsWith('alamat')));
  if (hIdx < 0) throw new Error('Kolom "Alamat" tidak ditemukan di data. Pastikan sumbernya sheet member yang benar.');
  const col = findColumns(rows[hIdx]);
  if (col.name < 0) throw new Error('Kolom "Child\'s Full Name" tidak ditemukan.');

  const members = [];
  let noAddress = 0;
  let total = 0;
  const monthSet = new Set();
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[col.name] ?? '').trim();
    const addr = String(r[col.addr] ?? '').replace(/\s+/g, ' ').trim();
    const center = col.center >= 0 ? String(r[col.center] ?? '').trim().toUpperCase() : '';
    if (!name && !addr) continue;
    total++;
    if (!isUsableAddress(addr)) { noAddress++; continue; }
    const tgl = col.tgl >= 0 ? r[col.tgl] : '';
    const month = parseMonth(tgl, col.year >= 0 ? r[col.year] : '', col.month >= 0 ? r[col.month] : '');
    if (month) monthSet.add(month);
    members.push({
      id: members.length,
      name: name || '(tanpa nama)',
      sid: col.sid >= 0 ? String(r[col.sid] ?? '').trim() : '',
      center,
      addr,
      month,
      dateLabel: dateLabel(tgl),
      key: `${CENTERS[center] ? center : '*'}|${normAddr(addr)}`,
    });
  }
  return { members, noAddress, total, months: [...monthSet].sort() };
}

// ---------------------------------------------------------------- pembersihan alamat

const ABBREV = [
  [/\bJ(?:a)?ln?\b\.?\s*/gi, 'Jalan '],
  [/\bGg\b\.?\s*/gi, 'Gang '],
  [/\bKp\b\.?\s*/gi, 'Kampung '],
  [/\bKomp(?:leks|lek)?\b\.?\s*/gi, 'Kompleks '],
  [/\bPerum\b\.?\s*/gi, 'Perumahan '],
  [/\bPdk?\b\.?\s*/gi, 'Pondok '],
  [/\bKab\b\.?\s*/gi, 'Kabupaten '],
  [/\b(?:Kel|Kelurahan|Kec|Kecamatan|Desa|Ds)\b\.?\s*/gi, ''],
  [/\bJaktim\b/gi, 'Jakarta Timur'],
  [/\bJakbar\b/gi, 'Jakarta Barat'],
  [/\bJaksel\b/gi, 'Jakarta Selatan'],
  [/\bJakut\b/gi, 'Jakarta Utara'],
  [/\bJakpus\b/gi, 'Jakarta Pusat'],
  [/\bTangsel\b/gi, 'Tangerang Selatan'],
  [/\bBks\b\.?/gi, 'Bekasi'],
  [/\bTng\b\.?/gi, 'Tangerang'],
  [/\bDKI\b/g, ''],
  [/\bIndonesia\b/gi, ''],
];

function cleanAddress(addr) {
  let t = ` ${addr} `;
  t = t.replace(/\bR\.?\s?T\.?\s*[:.]?\s*\d{1,3}\s*(?:[/\\?-]|\s)\s*(?:R\.?\s?W\.?\s*[:.]?\s*)?\d{1,3}\b/gi, ' ');
  t = t.replace(/\bR\.?\s?[TW]\b\.?\s*[:.]?\s*\d{1,3}\b/gi, ' ');
  t = t.replace(/\b(?:No|Nomor|Nmr|N0)\b\s*\.?\s*:?\s*[\w/-]*\d[\w/-]*/gi, ' ');
  t = t.replace(/\bBlo?k\b\.?\s*[\w./-]+(?:\s*(?:No\.?)?\s*\d+[a-z]?)?/gi, ' ');
  t = t.replace(/\bKav(?:ling)?\b\.?(?:\s*\d+[\w/]*)?/gi, ' ');
  t = t.replace(/\b[A-Z]{1,2}\d{1,3}(?:\s*\/\s*\d+)?\b/g, ' ');
  t = t.replace(/\b\d{5}\b/g, ' ');
  t = t.replace(/(^|[\s,])[/#]?\s*\d+[a-z]?\b/gi, '$1 ');
  t = t.replace(/\s+[-–]\s+/g, ', ').replace(/[;|]/g, ',');
  for (const [re, rep] of ABBREV) t = t.replace(re, rep);
  t = t.replace(/[/?#]+/g, ' ');
  return t.split(',').map((s) => s.replace(/\s+/g, ' ').replace(/^[\s.\-]+|[\s.\-]+$/g, '')).filter((s) => /[a-z]{3}/i.test(s)).join(', ');
}

function buildCandidates(addr) {
  const cleaned = cleanAddress(addr);
  const segs = cleaned.split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  if (segs.length) out.push({ q: segs.join(', '), level: 'alamat' });
  if (segs.length > 1) {
    out.push({ q: segs.slice(1).join(', '), level: 'area' });
    out.push({ q: segs[0], level: 'jalan' });
  } else if (segs.length === 1) {
    // Alamat tanpa koma: 2 kata terakhir biasanya nama kelurahan/kecamatan ("… Pondok Bambu").
    const words = segs[0].split(' ');
    if (words.length >= 4 && !/^[ivxl]+$/i.test(words[words.length - 1])) out.push({ q: words.slice(-2).join(' '), level: 'area' });
  }
  const seen = new Set();
  return out.filter((c) => {
    const k = c.q.toLowerCase();
    if (c.q.length < 3 || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------- geocoding (Nominatim / Photon)

class NetError extends Error {}
class PauseSignal extends Error {}
class SwitchSignal extends Error {}
let lastReq = 0;

const FETCH_TIMEOUT = 20000;
const MAX_ATTEMPTS = 4;
const PROVIDER_NAMES = { nominatim: 'Nominatim', photon: 'Photon' };

// mode: 'auto' (Nominatim, pindah ke Photon bila ditolak) | 'nominatim' | 'photon'
const geo = { mode: 'auto', current: 'nominatim', notice: '' };
function setGeoMode(mode) {
  geo.mode = ['auto', 'nominatim', 'photon'].includes(mode) ? mode : 'auto';
  geo.current = geo.mode === 'photon' ? 'photon' : 'nominatim';
  geo.notice = '';
}

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    // Nominatim hanya mengirim header CORS bila request membawa Referer.
    return await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function apiGet(provider, url) {
  const name = PROVIDER_NAMES[provider];
  for (let attempt = 1; ; attempt++) {
    const wait = lastReq + REQ_INTERVAL - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    let res;
    let problem;
    let refused = false; // server menolak kita (blokir/limit), bukan sekadar gangguan sesaat
    try {
      res = await fetchWithTimeout(url);
      if (res.status === 429 || res.status === 403) { problem = `${name} menolak/membatasi akses (HTTP ${res.status})`; refused = true; }
      else if (res.status >= 500) problem = `Server ${name} sedang bermasalah (HTTP ${res.status})`;
      else if (!res.ok && res.status !== 400) problem = `${name} menolak request (HTTP ${res.status})`;
    } catch (e) {
      if (e && e.name === 'AbortError') problem = `${name} tidak merespons dalam ${FETCH_TIMEOUT / 1000} detik`;
      else if (navigator.onLine === false) problem = 'HP sedang offline';
      else {
        // Nominatim tidak mengirim header CORS saat memblokir (403/429), jadi browser hanya melihat "gagal terhubung".
        problem = `Tidak bisa terhubung ke ${name} (kemungkinan IP/jaringan sedang diblokir, atau ada ad-blocker)`;
        refused = true;
      }
    }
    if (!problem) {
      if (res.status === 400) return null; // query tidak valid → anggap tidak ketemu
      try { return await res.json(); } catch { problem = `Respons ${name} tidak valid`; }
    }
    if (provider === 'nominatim' && geo.mode === 'auto' && (refused || attempt >= 2)) throw new SwitchSignal(problem);
    if (attempt >= MAX_ATTEMPTS) throw new NetError(`${problem}.`);
    const delay = (res && res.status === 429 ? 30000 : 5000) * attempt;
    await countdown(delay, (sec) => setLive(`${problem}. Mencoba lagi dalam ${sec} dtk (percobaan ${attempt + 1}/${MAX_ATTEMPTS})…`, true));
    if (queue.paused) throw new PauseSignal();
  }
}

async function countdown(ms, onTick) {
  const end = Date.now() + ms;
  while (Date.now() < end && !queue.paused) {
    onTick(Math.ceil((end - Date.now()) / 1000));
    await sleep(Math.min(1000, end - Date.now()));
  }
}

// --- Nominatim

function adminParts(a = {}) {
  const kel = a.village || a.suburb || a.quarter || a.neighbourhood || a.hamlet || '';
  const kec = a.city_district || (a.village && a.suburb) || a.town || '';
  const city = a.city || a.county || a.municipality || a.state_district || a.state || '';
  return { kel, kec: kec === kel ? '' : kec, city };
}

const nominatimProvider = {
  async search(q, box) {
    const hits = await apiGet('nominatim', `${NOMINATIM}/search?${new URLSearchParams({
      q, format: 'jsonv2', addressdetails: 1, limit: 1, countrycodes: 'id',
      'accept-language': 'id', viewbox: box.join(','), bounded: 1,
    })}`);
    const hit = hits && hits[0];
    if (!hit) return null;
    return { lat: +hit.lat, lon: +hit.lon, coarse: COARSE_TYPES.has(hit.addresstype), parts: adminParts(hit.address) };
  },
  async reverse(lat, lon) {
    const rev = await apiGet('nominatim', `${NOMINATIM}/reverse?${new URLSearchParams({
      lat, lon, format: 'jsonv2', zoom: 17, addressdetails: 1, 'accept-language': 'id',
    })}`);
    return rev && rev.address ? adminParts(rev.address) : null;
  },
};

// --- Photon (komoot) — data OpenStreetMap, tanpa API key, CORS terbuka

const PHOTON_COARSE = new Set(['city', 'county', 'state', 'country']);
function photonParts(p = {}, includeName) {
  // Urutan dari paling spesifik ke paling umum; yang terakhir = kota/kabupaten.
  const levels = [];
  if (includeName && (p.type === 'locality' || p.type === 'district') && p.name) levels.push(p.name);
  for (const k of ['locality', 'district', 'city', 'county']) if (p[k]) levels.push(p[k]);
  const uniq = [...new Set(levels)];
  const city = uniq.length ? uniq[uniq.length - 1] : (p.state || '');
  const lower = uniq.slice(0, -1);
  return { kel: lower[0] || '', kec: lower.length >= 2 ? lower[1] : '', city };
}

const photonProvider = {
  async search(q, box) {
    const bbox = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
    const data = await apiGet('photon', `${PHOTON}/api/?${new URLSearchParams({ q, limit: 1, bbox: bbox.join(',') })}`);
    const f = data && data.features && data.features[0];
    if (!f || !f.geometry) return null;
    const p = f.properties || {};
    if (p.countrycode && p.countrycode.toUpperCase() !== 'ID') return null;
    const [lon, lat] = f.geometry.coordinates;
    return { lat, lon, coarse: PHOTON_COARSE.has(p.type), parts: photonParts(p, true) };
  },
  async reverse(lat, lon) {
    const data = await apiGet('photon', `${PHOTON}/reverse?${new URLSearchParams({ lat, lon, limit: 1, radius: 1 })}`);
    const f = data && data.features && data.features[0];
    return f ? photonParts(f.properties, true) : null;
  },
};

const PROVIDERS = { nominatim: nominatimProvider, photon: photonProvider };

async function geocodeAddress(addr, center, manualQuery) {
  const c = CENTERS[center];
  const box = c ? [c.lon - CENTER_BOX_DEG, c.lat + CENTER_BOX_DEG, c.lon + CENTER_BOX_DEG, c.lat - CENTER_BOX_DEG] : WIDE_BOX;
  const tries = [];
  if (manualQuery) {
    tries.push({ q: manualQuery, level: 'manual', box });
    tries.push({ q: manualQuery, level: 'manual', box: WIDE_BOX });
  } else {
    const cands = buildCandidates(addr);
    for (const cd of cands) tries.push({ ...cd, box });
    if (c && cands.length) {
      tries.push({ ...cands[0], box: WIDE_BOX });
      if (cands[1] && cands[1].level === 'area') tries.push({ ...cands[1], box: WIDE_BOX });
    }
  }
  const src = geo.current;
  const provider = PROVIDERS[src];
  const seen = new Set();
  for (const t of tries) {
    const sig = `${t.q}|${t.box.join(',')}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    setLive(`Mencari: ${t.q}`);
    const hit = await provider.search(t.q, t.box);
    if (!hit || hit.coarse || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lon)) continue;
    let parts = hit.parts;
    if (!parts.kel && !kelLocate(hit.lat, hit.lon)) {
      const rev = await provider.reverse(hit.lat, hit.lon).catch((e) => {
        if (e instanceof NetError || e instanceof PauseSignal || e instanceof SwitchSignal) throw e;
        return null;
      });
      if (rev && rev.kel) parts = rev;
    }
    return { v: CACHE_VERSION, status: 'ok', lat: hit.lat, lon: hit.lon, ...parts, level: t.level, q: t.q, src, t: Date.now() };
  }
  return { v: CACHE_VERSION, status: 'fail', tried: [...new Set(tries.map((t) => t.q))], manual: manualQuery || '', src, t: Date.now() };
}

// ---------------------------------------------------------------- antrean geocoding

function buildQueue() {
  const pending = new Map();
  for (const m of state.members) {
    if (!cache.has(m.key) && !pending.has(m.key)) pending.set(m.key, { key: m.key, addr: m.addr, center: m.center });
  }
  queue.items = [...pending.values()];
  prioritizeQueue();
  queue.total = queue.items.length;
  queue.done = queue.ok = queue.fail = 0;
  queue.durations = [];
  queue.error = '';
}

function prioritizeQueue() {
  if (state.center === 'ALL') return;
  const sel = state.center;
  queue.items.sort((a, b) => (a.center === sel ? 0 : 1) - (b.center === sel ? 0 : 1));
}

async function runQueue() {
  if (queue.running) return;
  queue.running = true;
  queue.paused = false;
  queue.error = '';
  setNote('');
  wake.acquire();
  renderProgress();
  while (queue.items.length && !queue.paused) {
    const it = queue.items.shift();
    const t0 = Date.now();
    let res;
    try {
      res = await geocodeAddress(it.addr, it.center, it.manual);
    } catch (e) {
      if (e instanceof PauseSignal) {
        queue.items.unshift(it);
        break;
      }
      if (e instanceof SwitchSignal) {
        geo.current = 'photon';
        geo.notice = `${e.message}. Beralih otomatis ke Photon (server geocoding OpenStreetMap lain).`;
        setNote(geo.notice);
        queue.items.unshift(it);
        continue;
      }
      if (e instanceof NetError) {
        queue.items.unshift(it);
        queue.paused = true;
        queue.error = `${e.message} Geocoding dijeda — periksa koneksi lalu tekan Lanjutkan (lanjut otomatis saat koneksi kembali).`;
        if (geo.current === 'photon' && geo.mode === 'auto') queue.error += ' Nominatim juga sebelumnya gagal, jadi kemungkinan jaringan/browser ini memblokir kedua server — coba jaringan lain (mis. Wi-Fi) atau browser lain.';
        break;
      }
      res = { v: CACHE_VERSION, status: 'fail', tried: [], t: Date.now() };
    }
    cache.set(it.key, res);
    idb.put(it.key, res);
    markDirty(it.key);
    queue.done++;
    if (res.status === 'ok') queue.ok++; else queue.fail++;
    queue.durations.push(Date.now() - t0);
    if (queue.durations.length > 60) queue.durations.shift();
    renderProgress();
    scheduleRender();
  }
  queue.running = false;
  setLive('');
  wake.release();
  renderProgress();
  scheduleRender(true);
  schedulePush(true);
}

window.addEventListener('online', () => {
  if (!queue.running && queue.items.length && queue.error) runQueue();
});

function enqueueFront(item) {
  queue.items = queue.items.filter((x) => x.key !== item.key);
  queue.items.unshift(item);
  if (!queue.running) {
    if (queue.done >= queue.total) { queue.total = 0; queue.done = queue.ok = queue.fail = 0; }
  }
  queue.total++;
  runQueue();
}

const wake = {
  lock: null,
  async acquire() {
    try { if ('wakeLock' in navigator && !this.lock) this.lock = await navigator.wakeLock.request('screen'); } catch { /* abaikan */ }
  },
  release() { try { this.lock?.release(); } catch { /* abaikan */ } this.lock = null; },
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && queue.running) { wake.lock = null; wake.acquire(); }
});

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} dtk`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} mnt`;
  return `${Math.floor(m / 60)} j ${m % 60} mnt`;
}

function setNote(text) { $('#progNote').textContent = text; }
function setLive(text, warn = false) {
  const el = $('#progLive');
  el.textContent = text;
  el.classList.toggle('warn', warn);
}

function renderProgress() {
  const el = $('#progress');
  const active = queue.total > 0 && (queue.running || queue.items.length > 0);
  el.hidden = !active && !queue.error;
  if (el.hidden) { document.title = 'Sebaran Member'; return; }
  const ratio = queue.total ? queue.done / queue.total : 0;
  const pctNum = Math.floor(ratio * 1000) / 10;
  const pct = pctNum.toLocaleString('id-ID', { minimumFractionDigits: pctNum < 10 ? 1 : 0, maximumFractionDigits: pctNum < 10 ? 1 : 0 });
  $('#progBar').style.width = `${Math.max(ratio * 100, queue.done ? 0.8 : 0)}%`;
  el.querySelector('.bar').setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  const avg = queue.durations.length ? queue.durations.reduce((a, b) => a + b, 0) / queue.durations.length : REQ_INTERVAL * 1.5;
  const eta = queue.items.length * avg;
  $('#progTitle').textContent = queue.running
    ? `Geocoding alamat… ${pct}%`
    : `Geocoding dijeda (${pct}%)`;
  $('#progDetail').textContent =
    `${fmtInt(queue.done)} / ${fmtInt(queue.total)} alamat unik · ${fmtInt(queue.ok)} berhasil · ${fmtInt(queue.fail)} gagal` +
    (queue.items.length ? ` · sisa ± ${fmtDuration(eta)}` : '') + ` · via ${PROVIDER_NAMES[geo.current]}`;
  $('#btnPause').textContent = queue.running ? 'Jeda' : 'Lanjutkan';
  el.classList.toggle('error', !!queue.error);
  if (queue.error) setNote(queue.error);
  else if (geo.notice) setNote(geo.notice);
  else if (queue.running && !$('#progNote').textContent) setNote('Biarkan halaman ini tetap terbuka dan layar menyala. Hasil tersimpan otomatis, jadi aman jika terputus.');
  document.title = queue.running ? `(${pct}%) Sebaran Member` : 'Sebaran Member';
}

// ---------------------------------------------------------------- peta

let map;
let clusterLayer;
let pinLayer;
let heatGroup;
const HEAT_OPTS = { radius: 22, blur: 18, maxZoom: 14, minOpacity: 0.35 };
const HEAT_BLUE = { 0.2: '#b7d3f6', 0.4: '#6da7ec', 0.6: '#2a78d6', 0.8: '#1c5cab', 1: '#0d366b' };

// Gradasi heatmap satu warna: pucat (sedikit member) → warna center → lebih gelap (padat).
function heatGradient(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(color || '');
  if (!m) return { 0.4: color, 1: color };
  const n = parseInt(m[1], 16);
  const rgb = [n >> 16, (n >> 8) & 255, n & 255];
  const mix = (t, k) => `rgb(${rgb.map((v) => Math.round(v + (t - v) * k)).join(',')})`;
  return { 0.25: mix(255, 0.6), 0.55: mix(255, 0.25), 0.8: color, 1: mix(0, 0.35) };
}
let centerLayer;
let ringLayer;
let regionLayer;
let highlightLayer;
let regionBreaks = [];
const REGION_COLORS = ['#b7d3f6', '#6da7ec', '#2a78d6', '#1c5cab', '#0d366b'];
const markers = new Map(); // member id -> circleMarker (dipakai ulang antar-render)

function initMap() {
  map = L.map('map', { preferCanvas: true, zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  clusterLayer = L.markerClusterGroup({
    chunkedLoading: true,
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    spiderfyOnMaxZoom: true,
    iconCreateFunction(cluster) {
      const n = cluster.getChildCount();
      const size = n < 10 ? 32 : n < 100 ? 38 : n < 1000 ? 46 : 54;
      return L.divIcon({ html: `<div class="cluster" style="width:${size}px;height:${size}px">${fmtInt(n)}</div>`,
        className: '', iconSize: [size, size] });
    },
  });
  pinLayer = L.layerGroup();
  heatGroup = L.layerGroup();
  regionLayer = L.layerGroup();
  ringLayer = L.layerGroup().addTo(map);
  highlightLayer = L.layerGroup().addTo(map);
  centerLayer = L.layerGroup().addTo(map);

  drawCenters();
  fitToSelection();
}

function drawCenters() {
  centerLayer.clearLayers();
  for (const [code, c] of Object.entries(CENTERS)) {
    L.marker([c.lat, c.lon], {
      icon: L.divIcon({ html: `<div class="cmark" style="--c:${c.color}">${esc(code)}</div>`, className: '', iconSize: [44, 26], iconAnchor: [22, 13] }),
      zIndexOffset: 1000,
      keyboard: true,
      title: `Center ${code}`,
    }).bindPopup(`<div class="pop"><h3>${esc(code)} · ${esc(c.name)}</h3><p style="margin:0">${esc(c.addr)}</p></div>`).addTo(centerLayer);
  }
}

function fitToSelection() {
  if (state.center === 'ALL') {
    const pts = Object.values(CENTERS).map((c) => [c.lat, c.lon]);
    map.fitBounds(L.latLngBounds(pts).pad(0.25));
  } else {
    const c = CENTERS[state.center];
    if (c) map.setView([c.lat, c.lon], 12);
  }
}

function drawRings() {
  ringLayer.clearLayers();
  const c = CENTERS[state.center];
  if (!c) return;
  for (const km of [5, 10, 15]) {
    L.circle([c.lat, c.lon], { radius: km * 1000, color: '#52514e', weight: 1, opacity: 0.55, dashArray: '4 6', fill: false, interactive: false }).addTo(ringLayer);
    const lat = c.lat + km / 111.2;
    L.tooltip({ permanent: true, direction: 'center', className: 'ring-label', interactive: false })
      .setLatLng([lat, c.lon]).setContent(`${km} km`).addTo(ringLayer);
  }
}

function popupHtml(m) {
  const g = cache.get(m.key);
  const c = CENTERS[m.center];
  const dist = g && c ? haversine(c.lat, c.lon, g.lat, g.lon) : null;
  const ad = adminFor(m.key, g, m.addr);
  const HOW = { teks: 'dari nama kelurahan di alamat', dekat: 'titik di tepi batas kelurahan', geocoder: 'label geocoder (di luar data batas wilayah)' };
  const kel = ad?.kel
    ? `${esc(ad.kel)}${ad.kec || ad.kab ? `<br><span class="muted">${esc([ad.kec, ad.kab].filter(Boolean).join(', '))}</span>` : ''}${HOW[ad.how] ? `<br><span class="muted small">(${HOW[ad.how]})</span>` : ''}`
    : '<span class="muted">tidak diketahui</span>';
  const approx = g && g.level !== 'alamat'
    ? `<p class="approx">${g.level === 'manual' ? 'Lokasi dari pencarian manual' : 'Lokasi perkiraan'}: dicocokkan dengan “${esc(g.q)}”.</p>` : '';
  return `<div class="pop">
    <h3>${esc(m.sid || m.name)}</h3>
    <dl>
      ${m.sid ? `<dt>Nama</dt><dd>${esc(m.name)}</dd>` : ''}
      <dt>Center</dt><dd>${esc(m.center || '-')}</dd>
      <dt>Regis</dt><dd>${esc(m.dateLabel || '-')}</dd>
      <dt>Alamat</dt><dd>${esc(m.addr)}</dd>
      <dt>Jarak</dt><dd>${dist != null ? `<b>${fmtKm(dist)} km</b> dari ${esc(m.center)}` : '-'}</dd>
      <dt>Kelurahan</dt><dd>${kel}</dd>
    </dl>${approx}</div>`;
}

function getMarker(m, g, x) {
  let mk = markers.get(m.id);
  if (!mk) {
    mk = L.circleMarker([g.lat, g.lon], { radius: 7, weight: 2, color: '#ffffff', fillOpacity: 0.92 });
    mk.bindPopup(() => popupHtml(m), { maxWidth: 280 });
    markers.set(m.id, mk);
  }
  const color = memberColor(m);
  if (mk.options.fillColor !== color) mk.setStyle({ fillColor: color });
  // Sorot member yang lebih dekat ke cabang kompetitor daripada ke center-nya.
  const hi = !!(x && kstate.show && kstate.highlight && closerToKomp(x));
  if (mk.options.hi !== hi) mk.setStyle(hi ? { hi, color: KOMP_COLOR, weight: 3, radius: 8 } : { hi, color: '#ffffff', weight: 2, radius: 7 });
  return mk;
}

let shownIds = new Set();
let shownMode = null;
function resetMarkers() {
  clusterLayer.clearLayers();
  pinLayer.clearLayers();
  markers.clear();
  shownIds = new Set();
}

function showMemberOnMap(id) {
  const m = state.members[id];
  const g = m && cache.get(m.key);
  if (!g || g.status !== 'ok') return;
  setView('map');
  map.setView([g.lat, g.lon], 16);
  L.popup({ maxWidth: 280 }).setLatLng([g.lat, g.lon]).setContent(popupHtml(m)).openOn(map);
}

// ---------------------------------------------------------------- render

let renderTimer = null;
let lastRender = 0;
function scheduleRender(now = false) {
  if (now) { clearTimeout(renderTimer); renderTimer = null; render(); return; }
  if (renderTimer) return;
  const delay = Math.max(0, 4000 - (Date.now() - lastRender));
  renderTimer = setTimeout(() => { renderTimer = null; render(); }, delay);
}

function selection() {
  const sel = state.center;
  const inCenter = state.members.filter((m) => sel === 'ALL' || m.center === sel);
  const mapped = [];
  const failed = [];
  let pending = 0;
  for (const m of inCenter) {
    if (sel !== 'ALL' && state.hiddenMonths.has(m.month)) continue;
    const g = cache.get(m.key);
    if (!g) pending++;
    else if (g.status === 'ok') {
      const c = CENTERS[m.center];
      mapped.push({ m, g, dist: c ? haversine(c.lat, c.lon, g.lat, g.lon) : null });
    } else failed.push({ m, g });
  }
  return { inCenter, mapped, failed, pending };
}

function render() {
  lastRender = Date.now();
  const sel = selection();
  renderChips();
  renderMapLayers(sel);
  renderLegend(sel);
  renderCards(sel);
  renderMini(sel);
  renderCenterTable();
  renderKelurahan(sel);
  renderFailed(sel);
  renderKompLayer();
  if (state.view === 'komp') renderKompetitor(sel);
}

function renderChips() {
  const counts = {};
  for (const m of state.members) counts[m.center] = (counts[m.center] || 0) + 1;
  const items = [['ALL', 'Semua center', null, state.members.length]]
    .concat(Object.keys(CENTERS).map((k) => [k, k, CENTERS[k].color, counts[k] || 0]));
  $('#centerChips').innerHTML = items.map(([k, label, color, n]) =>
    `<button type="button" class="chip" role="tab" data-center="${k}" aria-selected="${state.center === k}">${color ? `<span class="dot" style="--c:${color}"></span>` : ''}${esc(label)} <span class="n">${fmtInt(n)}</span></button>`).join('');
}

function renderMapLayers(sel) {
  // Hanya tambah/hapus pin yang berubah supaya popup yang terbuka tidak tertutup saat geocoding berjalan.
  if (shownMode !== state.mode) {
    clusterLayer.clearLayers();
    pinLayer.clearLayers();
    shownIds = new Set();
    shownMode = state.mode;
  }
  if (state.mode === 'cluster' || state.mode === 'pins') {
    const want = new Set();
    const toAdd = [];
    for (const x of sel.mapped) {
      const { m, g } = x;
      want.add(m.id);
      const mk = getMarker(m, g, x);
      if (!shownIds.has(m.id)) toAdd.push(mk);
    }
    const toRemove = [...shownIds].filter((id) => !want.has(id)).map((id) => markers.get(id)).filter(Boolean);
    if (state.mode === 'cluster') {
      if (toRemove.length) clusterLayer.removeLayers(toRemove);
      if (toAdd.length) clusterLayer.addLayers(toAdd);
    } else {
      toRemove.forEach((mk) => pinLayer.removeLayer(mk));
      toAdd.forEach((mk) => pinLayer.addLayer(mk));
    }
    shownIds = want;
  }
  // Heatmap: "Semua center" → satu lapisan per center dengan warna center-nya; satu center → biru.
  heatGroup.clearLayers();
  if (state.mode === 'heat') {
    if (state.center === 'ALL') {
      const byCenter = new Map();
      for (const { m, g } of sel.mapped) {
        const k = CENTERS[m.center] ? m.center : '*';
        if (!byCenter.has(k)) byCenter.set(k, []);
        byCenter.get(k).push([g.lat, g.lon, 1]);
      }
      for (const [k, pts] of byCenter) {
        heatGroup.addLayer(L.heatLayer(pts, { ...HEAT_OPTS, gradient: heatGradient(k === '*' ? OTHER_COLOR : CENTERS[k].color) }));
      }
    } else {
      heatGroup.addLayer(L.heatLayer(sel.mapped.map(({ g }) => [g.lat, g.lon, 1]), { ...HEAT_OPTS, gradient: HEAT_BLUE }));
    }
  }
  renderRegions(sel);
  for (const [mode, layer] of [['cluster', clusterLayer], ['pins', pinLayer], ['heat', heatGroup], ['area', regionLayer]]) {
    if (state.mode === mode && !map.hasLayer(layer)) map.addLayer(layer);
    if (state.mode !== mode && map.hasLayer(layer)) map.removeLayer(layer);
  }
}

function renderRegions(sel) {
  regionLayer.clearLayers();
  if (state.mode !== 'area' || !kelDb.ready) return;
  const groups = computeKelGroups(sel).filter((g) => g.idx != null);
  const counts = groups.map((g) => g.n).sort((a, b) => a - b);
  const max = counts[counts.length - 1] || 0;
  // Batas kelas: kuantil jumlah member per kelurahan (maks 5 kelas).
  const br = [];
  if (max <= 5) for (let v = 1; v <= max; v++) br.push(v);
  else {
    for (const q of [0.2, 0.4, 0.6, 0.8]) br.push(counts[Math.min(counts.length - 1, Math.floor(q * counts.length))]);
    br.push(max);
  }
  regionBreaks = [...new Set(br)].sort((a, b) => a - b);
  const offset = REGION_COLORS.length - regionBreaks.length;
  const total = sel.mapped.length || 1;
  for (const g of groups) {
    const it = kelDb.items[g.idx];
    const cls = regionBreaks.findIndex((b) => g.n <= b);
    L.polygon(kelLatLngs(it), {
      color: '#ffffff', weight: 1, opacity: 0.9,
      fillColor: REGION_COLORS[offset + Math.max(0, cls)], fillOpacity: 0.72,
    }).bindPopup(`<div class="pop"><h3>${esc(g.kel)}</h3><p style="margin:0 0 6px" class="muted">${esc([g.kec, g.city].filter(Boolean).join(', '))}</p>
      <dl><dt>Member</dt><dd><b>${fmtInt(g.n)}</b> (${fmtPct(g.n / total)})</dd>
      ${g.dn ? `<dt>Rata-rata</dt><dd>${fmtKm(g.dsum / g.dn)} km ke center</dd>` : ''}
      ${(() => { const n = komp.ready ? nearestOutletOf(`kel:${it.i}`, { lat: it.cy / 1e4, lon: it.cx / 1e4 }) : null; return n && n.id != null ? `<dt>Kompetitor</dt><dd>${esc(outletName(komp.outlets[n.id]))} · ${fmtKm(n.d)} km</dd>` : ''; })()}
      ${g.approx ? `<dt>Perkiraan</dt><dd>${fmtInt(g.approx)} alamat</dd>` : ''}</dl></div>`, { maxWidth: 260 })
      .addTo(regionLayer);
  }
}

function highlightKel(gr) {
  highlightLayer.clearLayers();
  if (gr.idx == null || !kelDb.ready) return null;
  const poly = L.polygon(kelLatLngs(kelDb.items[gr.idx]), {
    color: '#1c5cab', weight: 3, dashArray: '6 4', fill: true, fillOpacity: 0.06, interactive: false,
  }).addTo(highlightLayer);
  return poly.getBounds();
}

function renderLegend() {
  const div = $('#legend');
  if (state.mode === 'area') {
    if (!kelDb.ready) { div.innerHTML = '<span class="hint">Memuat batas kelurahan…</span>'; return; }
    div.innerHTML = `<span class="lg-title">Member per kelurahan</span>${regionBreaks.map((b, i) => {
      const lo = i ? regionBreaks[i - 1] + 1 : 1;
      return `<span class="row static"><span class="sw sq" style="--c:${REGION_COLORS[i + REGION_COLORS.length - regionBreaks.length]}"></span>${lo === b ? fmtInt(b) : `${fmtInt(lo)}–${fmtInt(b)}`}</span>`;
    }).join('')}<p class="hint">Batas wilayah resmi Dukcapil. Ketuk kelurahan untuk detail.</p>`;
    return;
  }
  if (state.center === 'ALL') {
    const counts = {};
    let other = 0;
    for (const m of state.members) {
      const g = cache.get(m.key);
      if (!g || g.status !== 'ok') continue;
      if (CENTERS[m.center]) counts[m.center] = (counts[m.center] || 0) + 1; else other++;
    }
    div.innerHTML = `<span class="lg-title">Warna per center</span>${Object.keys(CENTERS).map((k) =>
      `<span class="row static"><span class="sw" style="--c:${CENTERS[k].color}"></span>${k} <span class="n">${fmtInt(counts[k] || 0)}</span></span>`).join('')}${other
      ? `<span class="row static"><span class="sw" style="--c:${OTHER_COLOR}"></span>Lainnya <span class="n">${fmtInt(other)}</span></span>` : ''}`;
    return;
  }
  const counts = new Map();
  for (const m of state.members) {
    if (m.center !== state.center) continue;
    const g = cache.get(m.key);
    if (!g || g.status !== 'ok') continue;
    counts.set(m.month, (counts.get(m.month) || 0) + 1);
  }
  const keys = [...counts.keys()].sort((a, b) => (a || '9999').localeCompare(b || '9999'));
  div.innerHTML = `<span class="lg-title">Bulan regis ${esc(state.center)}</span>${keys.length ? keys.map((k) =>
    `<button type="button" class="row${state.hiddenMonths.has(k) ? ' off' : ''}" data-month="${esc(k)}" aria-pressed="${!state.hiddenMonths.has(k)}"><span class="sw" style="--c:${monthColor(k)}"></span>${monthLabel(k)} <span class="n">${fmtInt(counts.get(k))}</span></button>`).join('')
    : '<span class="hint">Belum ada member yang terpetakan.</span>'}${state.hiddenMonths.size ? '<button type="button" class="reset" data-month-reset>Tampilkan semua</button>' : ''}${keys.length > 1 ? '<p class="hint">Ketuk bulan untuk menyembunyikan/menampilkan.</p>' : ''}`;
}

function onLegendClick(e) {
  const reset = e.target.closest('[data-month-reset]');
  if (reset) { state.hiddenMonths.clear(); render(); return; }
  const row = e.target.closest('[data-month]');
  if (!row) return;
  const k = row.dataset.month;
  if (state.hiddenMonths.has(k)) state.hiddenMonths.delete(k); else state.hiddenMonths.add(k);
  render();
}

function renderCards(sel) {
  const withDist = sel.mapped.filter((x) => x.dist != null);
  const longest = withDist.reduce((best, x) => (!best || x.dist > best.dist ? x : best), null);
  const filterNote = state.center !== 'ALL' && state.hiddenMonths.size ? '<p class="sub">Sesuai filter bulan di legenda.</p>' : '';

  $('#cardLongest .card-body').innerHTML = longest
    ? `<p class="hero">${fmtKm(longest.dist)} <small>km</small></p>
       <p class="who">${esc(longest.m.sid || longest.m.name)} <span class="muted">· ${esc(longest.m.center)}</span></p>
       <p class="sub">${esc(longest.m.addr)}</p>
       ${longest.g.level !== 'alamat' ? '<p class="sub">⚠ Lokasi perkiraan — cek alamatnya.</p>' : ''}
       <button type="button" class="link-btn" data-show="${longest.m.id}">Lihat di peta →</button>`
    : '<p class="muted">Belum ada member yang terpetakan.</p>';

  if (withDist.length) {
    const ds = withDist.map((x) => x.dist).sort((a, b) => a - b);
    const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
    const med = ds.length % 2 ? ds[(ds.length - 1) / 2] : (ds[ds.length / 2 - 1] + ds[ds.length / 2]) / 2;
    const within = (km) => Math.round((ds.filter((d) => d <= km).length / ds.length) * 100);
    $('#cardAvg .card-body').innerHTML = `<p class="hero">${fmtKm(avg)} <small>km</small></p>
      <p class="sub">dari ${fmtInt(ds.length)} member terpetakan</p>
      <div class="kv"><span>Median</span><span>${fmtKm(med)} km</span>
      <span>≤ 5 km</span><span>${within(5)}%</span>
      <span>≤ 10 km</span><span>${within(10)}%</span>
      <span>≤ 15 km</span><span>${within(15)}%</span></div>${filterNote}`;
  } else {
    $('#cardAvg .card-body').innerHTML = '<p class="muted">Belum ada member yang terpetakan.</p>';
  }

  const inScope = state.center === 'ALL' ? state.totalRows : null;
  $('#cardCoverage .card-body').innerHTML = `<p class="hero">${fmtInt(sel.mapped.length)} <small>di peta</small></p>
    <div class="kv">
      ${inScope != null ? `<span>Total baris data</span><span>${fmtInt(inScope)}</span>
      <span>Tanpa alamat (di-skip)</span><span>${fmtInt(state.noAddress)}</span>` : ''}
      <span>Punya alamat${state.center === 'ALL' ? '' : ` (${esc(state.center)})`}</span><span>${fmtInt(sel.inCenter.length)}</span>
      <span>Gagal geocode</span><span>${fmtInt(sel.failed.length)}</span>
      <span>Menunggu geocode</span><span>${fmtInt(sel.pending)}</span>
    </div>${filterNote}`;
}

function renderMini(sel) {
  const ds = sel.mapped.filter((x) => x.dist != null).map((x) => x.dist);
  const avg = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null;
  const max = ds.length ? Math.max(...ds) : null;
  $('#miniKpis').innerHTML = `<span class="mini"><b>${fmtInt(sel.mapped.length)}</b> di peta</span>
    <span class="mini">rata-rata <b>${avg != null ? fmtKm(avg) : '–'}</b> km</span>
    <span class="mini">terjauh <b>${max != null ? fmtKm(max) : '–'}</b> km</span>`;
}

function renderCenterTable() {
  const panel = $('#panelCenters');
  panel.hidden = state.center !== 'ALL';
  if (panel.hidden) return;
  const rows = Object.keys(CENTERS).map((k) => {
    const c = CENTERS[k];
    const ds = [];
    let total = 0;
    for (const m of state.members) {
      if (m.center !== k) continue;
      total++;
      const g = cache.get(m.key);
      if (g && g.status === 'ok') ds.push(haversine(c.lat, c.lon, g.lat, g.lon));
    }
    const avg = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null;
    const max = ds.length ? Math.max(...ds) : null;
    return { k, c, total, n: ds.length, avg, max };
  });
  $('#tblCenters').innerHTML = `<thead><tr><th>Center</th><th class="num">Alamat</th><th class="num">Di peta</th><th class="num">Rata-rata</th><th class="num">Terjauh</th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-center="${r.k}"><td><span class="cdot" style="--c:${r.c.color}"></span><b>${r.k}</b></td>
      <td class="num">${fmtInt(r.total)}</td><td class="num">${fmtInt(r.n)}</td>
      <td class="num">${r.avg != null ? `${fmtKm(r.avg)} km` : '–'}</td><td class="num">${r.max != null ? `${fmtKm(r.max)} km` : '–'}</td></tr>`).join('')}</tbody>`;
}

let kelGroups = [];
function computeKelGroups(sel) {
  const groups = new Map();
  for (const x of sel.mapped) {
    const ad = adminFor(x.m.key, x.g, x.m.addr);
    const kel = ad?.kel || '(tidak diketahui)';
    const key = `${kel}|${ad?.kec || ''}|${ad?.kab || ''}`;
    let gr = groups.get(key);
    if (!gr) { gr = { kel, kec: ad?.kec || '', city: ad?.kab || '', idx: ad?.idx ?? null, n: 0, approx: 0, dsum: 0, dn: 0, ids: [] }; groups.set(key, gr); }
    gr.n++;
    if (x.g.level !== 'alamat' || (ad && ad.how !== 'poligon')) gr.approx++;
    gr.ids.push(x.m.id);
    if (x.dist != null) { gr.dsum += x.dist; gr.dn++; }
  }
  return [...groups.values()].sort((a, b) => b.n - a.n || a.kel.localeCompare(b.kel));
}

function renderKelurahan(sel) {
  kelGroups = computeKelGroups(sel);
  const q = state.kelQuery.toLowerCase();
  const filtered = q ? kelGroups.filter((g) => `${g.kel} ${g.kec} ${g.city}`.toLowerCase().includes(q)) : kelGroups;
  const shown = filtered.slice(0, state.kelLimit);
  const max = kelGroups[0]?.n || 1;
  const total = sel.mapped.length || 1;
  $('#tblKel').innerHTML = shown.length
    ? `<thead><tr><th class="num">#</th><th>Kelurahan</th><th class="num">Member</th><th class="bar-cell"></th></tr></thead>
      <tbody>${shown.map((g) => `<tr data-kel="${kelGroups.indexOf(g)}">
        <td class="num muted">${kelGroups.indexOf(g) + 1}</td>
        <td><div class="kel-name">${esc(g.kel)}</div><div class="kel-sub">${esc([g.kec, g.city].filter(Boolean).join(', '))}${g.dn ? ` · rata-rata ${fmtKm(g.dsum / g.dn)} km` : ''}${g.approx ? ` · ${fmtInt(g.approx)} perkiraan` : ''}</div></td>
        <td class="num"><b>${fmtInt(g.n)}</b><div class="kel-sub">${fmtPct(g.n / total)}</div></td>
        <td class="bar-cell"><div class="mini-bar" style="width:${(g.n / max) * 100}%"></div></td></tr>`).join('')}</tbody>`
    : `<tbody><tr><td class="empty">${q ? 'Tidak ada kelurahan yang cocok.' : 'Belum ada data.'}</td></tr></tbody>`;
  const more = $('#btnKelMore');
  more.hidden = filtered.length <= state.kelLimit;
  more.textContent = `Tampilkan semua (${fmtInt(filtered.length)} kelurahan)`;
}

let failGroups = [];
function renderFailed(sel) {
  const groups = new Map();
  for (const { m, g } of sel.failed) {
    let gr = groups.get(m.key);
    if (!gr) { gr = { key: m.key, addr: m.addr, center: m.center, names: [], g }; groups.set(m.key, gr); }
    gr.names.push(m.name);
  }
  failGroups = [...groups.values()];
  const shown = failGroups.slice(0, state.failLimit);
  $('#failList').innerHTML = shown.length ? shown.map((f, i) => `<li data-fail="${i}">
      <div class="addr">${esc(f.addr)}</div>
      <div class="meta">${esc(f.center || '-')} · ${esc(f.names.slice(0, 3).join(', '))}${f.names.length > 3 ? ` +${f.names.length - 3}` : ''}${f.g.manual ? ` · dicari: “${esc(f.g.manual)}”` : ''}</div>
      <div class="acts">
        <button type="button" data-edit="${i}">Ubah &amp; cari ulang</button>
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.addr)}" target="_blank" rel="noopener">Cek di Google Maps</a>
      </div>
      ${state.editingFail === f.key ? `<form data-retry="${i}"><input name="q" value="${esc(f.g.manual || cleanAddress(f.addr) || f.addr)}" aria-label="Teks pencarian"><button class="btn small" type="submit">Cari</button></form>` : ''}
    </li>`).join('')
    : `<li class="empty">${sel.pending ? 'Belum ada — geocoding masih berjalan.' : 'Tidak ada. Semua alamat berhasil dipetakan.'}</li>`;
  const more = $('#btnFailMore');
  more.hidden = failGroups.length <= state.failLimit;
  more.textContent = `Tampilkan semua (${fmtInt(failGroups.length)} alamat)`;
  $('#btnCopyFail').disabled = !failGroups.length;
  $('#btnRetryFail').disabled = !failGroups.length;
}

// ---------------------------------------------------------------- sumber data

async function loadFromUrl(url) {
  const csvUrl = toCsvUrl(url);
  setSrcStatus('Memuat data…');
  let res;
  try {
    res = await fetch(csvUrl, { cache: 'no-store' });
  } catch {
    throw new Error('Gagal mengambil data. Pastikan sheet sudah di-publish ke web (atau dibagikan "Siapa saja yang memiliki link").');
  }
  if (!res.ok) throw new Error(`Gagal mengambil data (HTTP ${res.status}). Pastikan sheet sudah di-publish ke web.`);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('Link ini mengembalikan halaman web, bukan CSV. Gunakan link "Publikasikan ke web" dengan format CSV.');
  return text;
}

function applyRows(rows, sourceLabel) {
  const parsed = parseRows(rows);
  state.members = parsed.members;
  state.noAddress = parsed.noAddress;
  state.totalRows = parsed.total;
  state.months = parsed.months;
  state.hiddenMonths.clear();
  state.loaded = true;
  resetMarkers();
  const uniq = new Set(parsed.members.map((m) => m.key)).size;
  setSrcStatus(`${sourceLabel}: ${fmtInt(parsed.total)} baris, ${fmtInt(parsed.members.length)} punya alamat (${fmtInt(uniq)} alamat unik), ${fmtInt(parsed.noAddress)} tanpa alamat di-skip.`);
  buildQueue();
  render();
  renderProgress();
  renderSourceUi();
  if (queue.items.length) runQueue();
}
function applyData(text, sourceLabel) { applyRows(parseCsvRows(text), sourceLabel); }

function setSrcStatus(text, isErr = false) {
  const el = $('#srcStatus');
  el.textContent = text;
  el.classList.toggle('err', isErr);
}

function updateCacheInfo() {
  let ok = 0;
  let fail = 0;
  for (const v of cache.values()) { if (v.status === 'ok') ok++; else fail++; }
  $('#cacheInfo').textContent = `Tersimpan di perangkat ini: ${fmtInt(ok)} alamat berhasil, ${fmtInt(fail)} gagal.`;
}

// ---------------------------------------------------------------- sinkron Google Sheet (Apps Script)

const cloud = {
  url: '',
  remoteT: new Map(),     // key -> t (versi yang sudah ada di sheet)
  dirty: new Set(),       // key yang belum terkirim ke sheet
  pushing: false,
  timer: null,
  lastSync: 0,
  error: '',
};
const PUSH_BATCH = 250;
const PUSH_DELAY = 15000;

function isScriptUrl(u) { return /^https:\/\/script\.google(usercontent)?\.com\//.test(u); }

async function cloudFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  let res;
  try {
    res = await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } catch (e) {
    throw new Error(e && e.name === 'AbortError'
      ? 'Google Sheet tidak merespons (lebih dari 90 detik).'
      : 'Tidak bisa terhubung ke Apps Script. Pastikan Web App di-deploy dengan akses "Anyone" (Siapa saja) dan link-nya diakhiri /exec.');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(/<html/i.test(text)
      ? 'Apps Script meminta login. Deploy ulang Web App dengan "Who has access: Anyone" (Siapa saja).'
      : 'Respons Apps Script tidak dikenali.');
  }
  if (!data || data.ok !== true) throw new Error((data && data.error) || 'Apps Script mengembalikan error.');
  return data;
}

function mergeRemoteCache(pairs) {
  let added = 0;
  for (const [key, raw] of pairs || []) {
    let v;
    try { v = JSON.parse(raw); } catch { continue; }
    if (!v || v.v !== CACHE_VERSION) continue;
    if (v.status === 'ok' && (!Number.isFinite(v.lat) || !Number.isFinite(v.lon))) continue;
    cloud.remoteT.set(key, v.t || 0);
    const cur = cache.get(key);
    const better = !cur
      || (v.status === 'ok' && cur.status !== 'ok')
      || ((v.t || 0) > (cur.t || 0) && !(cur.status === 'ok' && v.status !== 'ok'));
    if (better) {
      cache.set(key, v);
      idb.put(key, v);
      added++;
    }
  }
  // Hasil di perangkat ini yang belum ada / lebih baru dari yang di sheet → kirim.
  for (const [key, v] of cache) {
    const rt = cloud.remoteT.get(key);
    if (rt === undefined || (v.t || 0) > rt) cloud.dirty.add(key);
  }
  saveDirty();
  return added;
}

function saveDirty() { store.set('cloudDirty', JSON.stringify([...cloud.dirty])); }
function loadDirty() {
  try { for (const k of JSON.parse(store.get('cloudDirty') || '[]')) cloud.dirty.add(k); } catch { /* abaikan */ }
}

function markDirty(key) {
  if (!cloud.url) return;
  cloud.dirty.add(key);
  saveDirty();
  schedulePush();
}

function schedulePush(now = false) {
  if (!cloud.url || !cloud.dirty.size) { renderSync(); return; }
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(pushDirty, now ? 0 : PUSH_DELAY);
  renderSync();
}

async function pushDirty(keepalive = false) {
  if (!cloud.url || cloud.pushing || !cloud.dirty.size) return;
  cloud.pushing = true;
  renderSync();
  try {
    while (cloud.dirty.size) {
      const keys = [...cloud.dirty].slice(0, PUSH_BATCH).filter((k) => cache.has(k));
      const entries = keys.map((k) => [k, JSON.stringify(cache.get(k))]);
      if (entries.length) {
        await cloudFetch(cloud.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'cache', entries }),
          keepalive: keepalive && entries.length < 60,
        });
      }
      for (const [k] of entries) cloud.remoteT.set(k, cache.get(k).t || 0);
      [...cloud.dirty].slice(0, PUSH_BATCH).forEach((k) => cloud.dirty.delete(k));
      saveDirty();
      cloud.lastSync = Date.now();
      cloud.error = '';
      renderSync();
    }
  } catch (e) {
    cloud.error = e.message;
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(pushDirty, 60000);
  } finally {
    cloud.pushing = false;
    renderSync();
  }
}

async function loadFromCloud(url, label = 'Data dari Google Sheet') {
  cloud.url = url;
  cloud.error = '';
  setSync('busy', 'Memuat…', 'Mengambil data dari Google Sheet');
  setSrcStatus('Mengambil data & cache dari Google Sheet…');
  const data = await cloudFetch(`${url}${url.includes('?') ? '&' : '?'}action=all`);
  if (!Array.isArray(data.rows)) throw new Error('Apps Script tidak mengirim data member.');
  if (Array.isArray(data.centers) && data.centers.length) setCenters(data.centers);
  if (typeof applyKompetitorFeed === 'function') applyKompetitorFeed(data);
  const added = mergeRemoteCache(data.cache);
  cloud.lastSync = Date.now();
  applyRows(data.rows, `${label}${data.sheet ? ` (tab ${data.sheet})` : ''}`);
  if (added) toast(`${fmtInt(added)} hasil geocoding diambil dari Google Sheet`);
  schedulePush(true);
}

function setSync(cls, text, title) {
  const el = $('#syncStatus');
  el.className = `sync ${cls}`;
  el.textContent = text;
  el.title = title || text;
}

function renderSync() {
  if (cloud.url) {
    if (cloud.error) setSync('err', 'Gagal sinkron', cloud.error);
    else if (cloud.pushing || cloud.dirty.size) setSync('busy', 'Menyimpan…', `${fmtInt(cloud.dirty.size)} hasil geocoding menunggu dikirim ke Google Sheet`);
    else setSync('ok', 'Tersinkron', 'Data & hasil geocoding tersimpan di Google Sheet: sama di HP & laptop');
  } else if (state.loaded) {
    setSync('', 'Hanya di perangkat ini', 'Hubungkan Apps Script di tab Data supaya sama di HP & laptop');
  } else {
    setSync('', 'Belum ada data', 'Atur sumber data di tab Data');
  }
  const info = $('#cloudInfo');
  if (info) {
    info.textContent = cloud.url
      ? (cloud.error ? `Gagal sinkron: ${cloud.error}`
        : `Terhubung. ${cloud.lastSync ? `Sinkron terakhir ${new Date(cloud.lastSync).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : ''}${cloud.dirty.size ? ` · ${fmtInt(cloud.dirty.size)} hasil menunggu dikirim` : ''}`)
      : '';
  }
}

function sourceUrl() { return cloud.url ? { type: 'script', url: cloud.url } : (store.get('sheetUrl') ? { type: 'csv', url: store.get('sheetUrl') } : null); }

function renderSourceUi() {
  const src = sourceUrl();
  $('#btnConnect').textContent = cloud.url ? 'Hubungkan ulang' : 'Hubungkan';
  $('#btnSyncNow').hidden = !cloud.url;
  $('#btnDisconnect').hidden = !cloud.url;
  $('#btnCopySetup').disabled = !src;
  $('#dataDot').hidden = !!state.loaded;
  renderSync();
}

// ---------------------------------------------------------------- tab & install

function setView(v) {
  if (!['map', 'stats', 'kel', 'komp', 'data'].includes(v)) v = 'map';
  state.view = v;
  store.set('view', v);
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  for (const k of ['map', 'stats', 'kel', 'komp', 'data']) $(`#v-${k}`).hidden = k !== v;
  if (v === 'map') setTimeout(() => map.invalidateSize(), 0);
  if (v === 'komp' && state.members) renderKompetitor(selection());
  if (v === 'data') updateCacheInfo();
  window.scrollTo({ top: 0 });
}

let installEvt = null;
function initInstall() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const help = $('#installHelp');
  if (standalone) {
    $('#installText').textContent = 'Aplikasi sudah terpasang dan sedang dibuka sebagai aplikasi.';
  } else if (ios) {
    help.textContent = 'Di iPhone/iPad: buka di Safari, ketuk tombol Bagikan, lalu “Tambah ke Layar Utama”.';
  } else {
    help.textContent = 'Jika tombol tidak muncul: buka menu browser (⋮) → “Install aplikasi” / “Tambahkan ke layar utama”.';
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e;
    $('#btnInstall').hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installEvt = null;
    $('#btnInstall').hidden = true;
    toast('Aplikasi terpasang ✓');
  });
  $('#btnInstall').addEventListener('click', async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice.catch(() => null);
    installEvt = null;
    $('#btnInstall').hidden = true;
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* abaikan */ });
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------------------------------------------------------------- events

function bindEvents() {
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });
  $('#legend').addEventListener('click', onLegendClick);
  $('#centerChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-center]');
    if (!b) return;
    selectCenter(b.dataset.center);
  });
  $('#tblCenters').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-center]');
    if (tr) { selectCenter(tr.dataset.center); setView('map'); }
  });
  document.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    state.mode = b.dataset.mode;
    document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderMapLayers(selection());
    renderLegend();
  });
  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-show]');
    if (s) showMemberOnMap(+s.dataset.show);
  });
  $('#tblKel').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-kel]');
    if (!tr) return;
    const gr = kelGroups[+tr.dataset.kel];
    const pts = gr.ids.map((id) => cache.get(state.members[id].key)).map((g) => [g.lat, g.lon]);
    setView('map');
    const bounds = highlightKel(gr) || L.latLngBounds(pts);
    for (const p of pts) bounds.extend(p);
    setTimeout(() => map.fitBounds(bounds.pad(0.15), { maxZoom: 16 }), 50);
  });
  $('#kelSearch').addEventListener('input', (e) => { state.kelQuery = e.target.value.trim(); renderKelurahan(selection()); });
  $('#btnKelMore').addEventListener('click', () => { state.kelLimit = Infinity; renderKelurahan(selection()); });
  $('#btnFailMore').addEventListener('click', () => { state.failLimit = Infinity; renderFailed(selection()); });

  $('#failList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]');
    if (!b) return;
    const f = failGroups[+b.dataset.edit];
    state.editingFail = state.editingFail === f.key ? null : f.key;
    renderFailed(selection());
    const input = $('#failList form input');
    if (input) input.focus();
  });
  $('#failList').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target.closest('[data-retry]');
    const f = failGroups[+form.dataset.retry];
    const q = form.elements.q.value.trim();
    if (!q) return;
    state.editingFail = null;
    cache.delete(f.key);
    enqueueFront({ key: f.key, addr: f.addr, center: f.center, manual: q });
    render();
  });
  $('#btnCopyFail').addEventListener('click', async () => {
    const lines = ['Center\tNama\tAlamat'];
    for (const f of failGroups) lines.push(`${f.center}\t${f.names.join(', ')}\t${f.addr}`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('Daftar alamat gagal tersalin');
    } catch {
      toast('Gagal menyalin');
    }
  });
  $('#btnRetryFail').addEventListener('click', () => {
    if (!confirm(`Coba geocode ulang ${failGroups.length} alamat yang gagal?`)) return;
    for (const f of failGroups) { cache.delete(f.key); idb.del(f.key); }
    if (!queue.running) buildQueue();
    else {
      for (const f of failGroups) queue.items.push({ key: f.key, addr: f.addr, center: f.center });
      queue.total += failGroups.length;
    }
    render();
    runQueue();
  });

  $('#btnPause').addEventListener('click', () => {
    if (queue.running) { queue.paused = true; $('#btnPause').textContent = 'Menjeda…'; } else runQueue();
  });

  // --- sumber data
  $('#btnConnect').addEventListener('click', async () => {
    const url = $('#inpScript').value.trim();
    if (!isScriptUrl(url)) { setSrcStatus('Tempel link Web App Apps Script (diawali https://script.google.com/…/exec).', true); return; }
    await stopQueue();
    try {
      await loadFromCloud(url);
      store.set('scriptUrl', url);
      toast('Terhubung ke Google Sheet ✓');
    } catch (err) {
      cloud.url = store.get('scriptUrl') || '';
      setSrcStatus(err.message, true);
      renderSourceUi();
    }
  });
  $('#btnSyncNow').addEventListener('click', async () => {
    await stopQueue();
    try { await loadFromCloud(cloud.url); toast('Sinkron selesai'); } catch (err) { cloud.error = err.message; setSrcStatus(err.message, true); renderSync(); }
  });
  $('#btnDisconnect').addEventListener('click', () => {
    if (!confirm('Putuskan sambungan ke Google Sheet di perangkat ini? Data yang sudah tampil tetap ada di perangkat ini.')) return;
    cloud.url = '';
    cloud.dirty.clear();
    saveDirty();
    store.set('scriptUrl', '');
    $('#inpScript').value = '';
    renderSourceUi();
  });
  $('#btnLoadUrl').addEventListener('click', async () => {
    const url = $('#inpUrl').value.trim();
    if (!url) { setSrcStatus('Tempel link CSV terlebih dahulu.', true); return; }
    try {
      const text = await loadFromUrl(url);
      store.set('sheetUrl', url);
      applyData(text, 'Data dimuat');
    } catch (err) { setSrcStatus(err.message, true); }
  });
  $('#inpFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { applyData(await file.text(), `File ${file.name}`); } catch (err) { setSrcStatus(err.message, true); }
    e.target.value = '';
  });
  $('#btnCopySetup').addEventListener('click', async () => {
    const src = sourceUrl();
    if (!src) return;
    const link = `${location.origin}${location.pathname}#${src.type}=${encodeURIComponent(src.url)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Link setup tersalin. Buka di perangkat lain.');
    } catch {
      prompt('Salin link setup ini:', link);
    }
  });

  // --- geocoding & cache
  $('#selProvider').addEventListener('change', async (e) => {
    store.set('geoProvider', e.target.value);
    const wasRunning = queue.running || queue.items.length > 0;
    await stopQueue();
    setGeoMode(e.target.value);
    queue.error = '';
    renderProgress();
    if (wasRunning && queue.items.length) runQueue();
  });
  $('#btnExport').addEventListener('click', () => {
    const data = { app: 'sebaran-member', version: CACHE_VERSION, exported: new Date().toISOString(), entries: Object.fromEntries(cache) };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `geocode-cache-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('#inpImport').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== 'sebaran-member' || typeof data.entries !== 'object') throw new Error('File bukan cache dari aplikasi ini.');
      let n = 0;
      for (const [k, v] of Object.entries(data.entries)) {
        if (!v || v.v !== CACHE_VERSION) continue;
        if (v.status === 'ok' && (!Number.isFinite(v.lat) || !Number.isFinite(v.lon))) continue;
        const cur = cache.get(k);
        if (cur && cur.status === 'ok' && v.status !== 'ok') continue;
        cache.set(k, v);
        idb.put(k, v);
        if (cloud.url) cloud.dirty.add(k);
        n++;
      }
      saveDirty();
      updateCacheInfo();
      toast(`${fmtInt(n)} entri cache diimpor`);
      await stopQueue();
      resetMarkers();
      buildQueue();
      render();
      renderProgress();
      schedulePush(true);
      if (queue.items.length) runQueue();
    } catch (err) { setSrcStatus(`Impor gagal: ${err.message}`, true); }
    e.target.value = '';
  });
  $('#btnClearCache').addEventListener('click', async () => {
    if (!confirm('Hapus hasil geocoding yang tersimpan di perangkat ini? (Cache di Google Sheet tidak ikut terhapus.)')) return;
    await stopQueue();
    cache.clear();
    await idb.clear();
    resetMarkers();
    updateCacheInfo();
    if (cloud.url) {
      try { await loadFromCloud(cloud.url); return; } catch (err) { setSrcStatus(err.message, true); }
    }
    buildQueue();
    render();
    renderProgress();
    if (queue.items.length) runQueue();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && cloud.dirty.size) pushDirty(true);
  });
}

async function stopQueue() {
  queue.paused = true;
  while (queue.running) await sleep(200);
}

function selectCenter(code) {
  if (state.center === code) return;
  state.center = code;
  state.hiddenMonths.clear();
  state.kelLimit = KEL_PAGE;
  state.failLimit = FAIL_PAGE;
  state.editingFail = null;
  store.set('center', code);
  highlightLayer.clearLayers();
  prioritizeQueue();
  drawRings();
  fitToSelection();
  render();
}

// ---------------------------------------------------------------- start

async function main() {
  setGeoMode(store.get('geoProvider'));
  $('#selProvider').value = geo.mode;
  let storedCenters = null;
  try { storedCenters = JSON.parse(store.get('centers') || 'null'); } catch { /* abaikan */ }
  setCenters(storedCenters || DEFAULT_CENTERS);
  const savedCenter = store.get('center');
  if (savedCenter && (savedCenter === 'ALL' || CENTERS[savedCenter])) state.center = savedCenter;
  initMap();
  drawRings();
  loadKstate();
  bindEvents();
  bindKompEvents();
  initInstall();
  setView(store.get('view') || 'map');
  render();
  renderSourceUi();
  await Promise.all([idb.open().then(() => idb.loadAll()), loadKelurahan(), loadKompetitor()]);
  loadDirty();

  // Link setup dari perangkat lain: #script=… atau #csv=…
  const params = new URLSearchParams(location.hash.slice(1));
  const hashScript = params.get('script');
  const hashCsv = params.get('csv');
  if (hashScript && isScriptUrl(hashScript)) store.set('scriptUrl', hashScript);
  if (hashCsv) store.set('sheetUrl', hashCsv);
  if (hashScript || hashCsv) history.replaceState(null, '', location.pathname + location.search);

  const scriptUrl = store.get('scriptUrl');
  const csvUrl = store.get('sheetUrl');
  if (scriptUrl) $('#inpScript').value = scriptUrl;
  if (csvUrl) $('#inpUrl').value = csvUrl;
  if (scriptUrl) {
    try {
      await loadFromCloud(scriptUrl);
      return;
    } catch (err) {
      cloud.error = err.message;
      setSrcStatus(err.message, true);
      renderSync();
    }
  } else if (csvUrl) {
    try {
      applyData(await loadFromUrl(csvUrl), 'Data dimuat');
      return;
    } catch (err) {
      setSrcStatus(err.message, true);
    }
  }
  updateCacheInfo();
  renderSourceUi();
  if (!state.loaded) setView('data');
}

main();
