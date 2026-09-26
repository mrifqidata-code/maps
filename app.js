/* Sebaran Member — peta persebaran member per center.
 * Data: CSV Google Sheet (publish to web) atau upload file CSV.
 * Geocoding: Nominatim (OpenStreetMap), maks 1 request/detik, hasil di-cache di IndexedDB. */
'use strict';

// ---------------------------------------------------------------- konfigurasi

const CENTERS = {
  HIB: { lat: -6.179084581029557, lon: 106.97414478968899, color: '#2a78d6',
    addr: 'Mega Office Park, Jl. Harapan Indah Boulevard, Medan Satria, Kota Bekasi 17132' },
  KLM: { lat: -6.239288418633617, lon: 106.8997994939914, color: '#eb6834',
    addr: 'Jl. Pahlawan Revolusi No.11, Pd. Bambu, Duren Sawit, Jakarta Timur 13430' },
  KWC: { lat: -6.2185146814319925, lon: 106.61665600503935, color: '#1baf7a',
    addr: 'Jl. Palem Semi, Panunggangan Barat, Cibodas, Kota Tangerang 15318' },
  PML: { lat: -6.346124651378747, lon: 106.69648245109295, color: '#eda100',
    addr: 'Jl. Raya Puspitek, Babakan, Setu, Tangerang Selatan 15315' },
  BTU: { lat: -6.292965677930978, lon: 106.72602235903597, color: '#e87ba4',
    addr: 'Bintaro U-Town Jaya, Jl. Boulevard UPJ No.1, Sawah Baru, Ciputat, Tangerang Selatan 15413' },
  TMP: { lat: -6.124072093581825, lon: 106.70609238967546, color: '#008300',
    addr: 'Jl. Palem Raja Barat No.10, Pegadungan, Kalideres, Jakarta Barat 11830' },
};
const OTHER_COLOR = '#898781';
const MONTH_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300',
  '#4a3aa7', '#e34948', '#0f9fb5', '#8c564b', '#b5179e', '#5b6b00'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const NOMINATIM = 'https://nominatim.openstreetmap.org';
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
};
const cache = new Map();                // key -> hasil geocoding
const queue = { items: [], running: false, paused: false, total: 0, done: 0, ok: 0, fail: 0,
  durations: [], error: '', manual: new Map() };

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtInt = (n) => n.toLocaleString('id-ID');
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

function parseCsv(text) {
  const res = Papa.parse(text, { skipEmptyLines: 'greedy' });
  const rows = res.data;
  const hIdx = rows.findIndex((r, i) => i < 20 && r.some((c) => normHeader(c).startsWith('alamat')));
  if (hIdx < 0) throw new Error('Kolom "Alamat" tidak ditemukan di data. Pastikan link yang dipakai adalah CSV dari sheet yang benar.');
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

// ---------------------------------------------------------------- Nominatim

class NetError extends Error {}
let lastReq = 0;

async function nominatim(path, params) {
  const url = `${NOMINATIM}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; ; attempt++) {
    const wait = lastReq + REQ_INTERVAL - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      if (attempt >= 3) throw new NetError('Tidak bisa terhubung ke server geocoding.');
      await sleep(4000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) throw new NetError(`Server geocoding sibuk (HTTP ${res.status}).`);
      setNote(`Server geocoding membatasi request, menunggu ${30 * (attempt + 1)} detik…`);
      await sleep(30000 * (attempt + 1));
      setNote('');
      continue;
    }
    if (!res.ok) throw new NetError(`Server geocoding menolak request (HTTP ${res.status}).`);
    return res.json();
  }
}

function adminParts(a = {}) {
  const kel = a.village || a.suburb || a.quarter || a.neighbourhood || a.hamlet || '';
  const kec = a.city_district || (a.village && a.suburb) || a.town || '';
  const city = a.city || a.county || a.municipality || a.state_district || a.state || '';
  return { kel, kec: kec === kel ? '' : kec, city };
}

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
  const seen = new Set();
  for (const t of tries) {
    const sig = `${t.q}|${t.box.join(',')}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const hits = await nominatim('/search', {
      q: t.q, format: 'jsonv2', addressdetails: 1, limit: 1, countrycodes: 'id',
      'accept-language': 'id', viewbox: t.box.join(','), bounded: 1,
    });
    const hit = hits && hits[0];
    if (!hit || COARSE_TYPES.has(hit.addresstype)) continue;
    const lat = +hit.lat;
    const lon = +hit.lon;
    let parts = adminParts(hit.address);
    if (!parts.kel) {
      const rev = await nominatim('/reverse', {
        lat, lon, format: 'jsonv2', zoom: 17, addressdetails: 1, 'accept-language': 'id',
      }).catch((e) => { if (e instanceof NetError) throw e; return null; });
      if (rev && rev.address) parts = adminParts(rev.address);
    }
    return { v: CACHE_VERSION, status: 'ok', lat, lon, ...parts, level: t.level, q: t.q, t: Date.now() };
  }
  return { v: CACHE_VERSION, status: 'fail', tried: [...new Set(tries.map((t) => t.q))], manual: manualQuery || '', t: Date.now() };
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
      if (e instanceof NetError) {
        queue.items.unshift(it);
        queue.paused = true;
        queue.error = `${e.message} Geocoding dijeda — periksa koneksi lalu tekan Lanjutkan.`;
        break;
      }
      res = { v: CACHE_VERSION, status: 'fail', tried: [], t: Date.now() };
    }
    cache.set(it.key, res);
    idb.put(it.key, res);
    queue.done++;
    if (res.status === 'ok') queue.ok++; else queue.fail++;
    queue.durations.push(Date.now() - t0);
    if (queue.durations.length > 60) queue.durations.shift();
    renderProgress();
    scheduleRender();
  }
  queue.running = false;
  wake.release();
  renderProgress();
  scheduleRender(true);
}

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

function renderProgress() {
  const el = $('#progress');
  const active = queue.total > 0 && (queue.running || queue.items.length > 0);
  el.hidden = !active && !queue.error;
  if (el.hidden) { document.title = 'Sebaran Member'; return; }
  const pct = queue.total ? Math.floor((queue.done / queue.total) * 100) : 0;
  $('#progBar').style.width = `${pct}%`;
  el.querySelector('.bar').setAttribute('aria-valuenow', String(pct));
  const avg = queue.durations.length ? queue.durations.reduce((a, b) => a + b, 0) / queue.durations.length : REQ_INTERVAL * 1.5;
  const eta = queue.items.length * avg;
  $('#progTitle').textContent = queue.running
    ? `Geocoding alamat… ${pct}%`
    : `Geocoding dijeda (${pct}%)`;
  $('#progDetail').textContent =
    `${fmtInt(queue.done)} / ${fmtInt(queue.total)} alamat unik · ${fmtInt(queue.ok)} berhasil · ${fmtInt(queue.fail)} gagal` +
    (queue.items.length ? ` · sisa ± ${fmtDuration(eta)}` : '');
  $('#btnPause').textContent = queue.running ? 'Jeda' : 'Lanjutkan';
  el.classList.toggle('error', !!queue.error);
  if (queue.error) setNote(queue.error);
  else if (queue.running && !$('#progNote').textContent) setNote('Biarkan halaman ini tetap terbuka. Hasil tersimpan otomatis, jadi aman jika terputus.');
  document.title = queue.running ? `(${pct}%) Sebaran Member` : 'Sebaran Member';
}

// ---------------------------------------------------------------- peta

let map;
let clusterLayer;
let pinLayer;
let heatLayer;
let centerLayer;
let ringLayer;
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
  heatLayer = L.heatLayer([], {
    radius: 22, blur: 18, maxZoom: 14, minOpacity: 0.35,
    gradient: { 0.2: '#b7d3f6', 0.4: '#6da7ec', 0.6: '#2a78d6', 0.8: '#1c5cab', 1: '#0d366b' },
  });
  ringLayer = L.layerGroup().addTo(map);
  centerLayer = L.layerGroup().addTo(map);

  for (const [code, c] of Object.entries(CENTERS)) {
    L.marker([c.lat, c.lon], {
      icon: L.divIcon({ html: `<div class="cmark" style="--c:${c.color}">${code}</div>`, className: '', iconSize: [44, 26], iconAnchor: [22, 13] }),
      zIndexOffset: 1000,
      keyboard: true,
      title: `Center ${code}`,
    }).bindPopup(`<div class="pop"><h3>Center ${esc(code)}</h3><p style="margin:0">${esc(c.addr)}</p></div>`).addTo(centerLayer);
  }

  fitToSelection();
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
  const kel = g?.kel ? `${esc(g.kel)}${g.kec ? `<br><span class="muted">${esc(g.kec)}${g.city ? `, ${esc(g.city)}` : ''}</span>` : ''}` : '<span class="muted">tidak diketahui</span>';
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

function getMarker(m, g) {
  let mk = markers.get(m.id);
  if (!mk) {
    mk = L.circleMarker([g.lat, g.lon], { radius: 7, weight: 2, color: '#ffffff', fillOpacity: 0.92 });
    mk.bindPopup(() => popupHtml(m), { maxWidth: 280 });
    markers.set(m.id, mk);
  }
  const color = memberColor(m);
  if (mk.options.fillColor !== color) mk.setStyle({ fillColor: color });
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
  document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  renderCenterTable();
  renderKelurahan(sel);
  renderFailed(sel);
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
  if (state.mode !== 'heat') {
    const want = new Set();
    const toAdd = [];
    for (const { m, g } of sel.mapped) {
      want.add(m.id);
      const mk = getMarker(m, g);
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
  heatLayer.setLatLngs(state.mode === 'heat' ? sel.mapped.map(({ g }) => [g.lat, g.lon, 1]) : []);
  for (const [mode, layer] of [['cluster', clusterLayer], ['pins', pinLayer], ['heat', heatLayer]]) {
    if (state.mode === mode && !map.hasLayer(layer)) map.addLayer(layer);
    if (state.mode !== mode && map.hasLayer(layer)) map.removeLayer(layer);
  }
}

function renderLegend() {
  const div = $('#legend');
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
function renderKelurahan(sel) {
  const groups = new Map();
  for (const x of sel.mapped) {
    const kel = x.g.kel || '(tidak diketahui)';
    const key = `${kel}|${x.g.kec || ''}|${x.g.city || ''}`;
    let gr = groups.get(key);
    if (!gr) { gr = { kel, kec: x.g.kec, city: x.g.city, n: 0, dsum: 0, dn: 0, ids: [] }; groups.set(key, gr); }
    gr.n++;
    gr.ids.push(x.m.id);
    if (x.dist != null) { gr.dsum += x.dist; gr.dn++; }
  }
  kelGroups = [...groups.values()].sort((a, b) => b.n - a.n || a.kel.localeCompare(b.kel));
  const q = state.kelQuery.toLowerCase();
  const filtered = q ? kelGroups.filter((g) => `${g.kel} ${g.kec} ${g.city}`.toLowerCase().includes(q)) : kelGroups;
  const shown = filtered.slice(0, state.kelLimit);
  const max = kelGroups[0]?.n || 1;
  const total = sel.mapped.length || 1;
  $('#tblKel').innerHTML = shown.length
    ? `<thead><tr><th class="num">#</th><th>Kelurahan</th><th class="num">Member</th><th class="bar-cell"></th></tr></thead>
      <tbody>${shown.map((g) => `<tr data-kel="${kelGroups.indexOf(g)}">
        <td class="num muted">${kelGroups.indexOf(g) + 1}</td>
        <td><div class="kel-name">${esc(g.kel)}</div><div class="kel-sub">${esc([g.kec, g.city].filter(Boolean).join(', '))}${g.dn ? ` · rata-rata ${fmtKm(g.dsum / g.dn)} km` : ''}</div></td>
        <td class="num"><b>${fmtInt(g.n)}</b><div class="kel-sub">${Math.round((g.n / total) * 1000) / 10}%</div></td>
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

// ---------------------------------------------------------------- data loading

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

function applyData(text, sourceLabel) {
  const parsed = parseCsv(text);
  state.members = parsed.members;
  state.noAddress = parsed.noAddress;
  state.totalRows = parsed.total;
  state.months = parsed.months;
  state.hiddenMonths.clear();
  resetMarkers();
  const uniq = new Set(parsed.members.map((m) => m.key)).size;
  setSrcStatus(`${sourceLabel}: ${fmtInt(parsed.total)} baris, ${fmtInt(parsed.members.length)} punya alamat (${fmtInt(uniq)} alamat unik), ${fmtInt(parsed.noAddress)} tanpa alamat di-skip.`);
  buildQueue();
  render();
  renderProgress();
  if (queue.items.length) runQueue();
}

function setSrcStatus(text, isErr = false) {
  const el = $('#srcStatus');
  el.textContent = text;
  el.classList.toggle('err', isErr);
}

function updateCacheInfo() {
  let ok = 0;
  let fail = 0;
  for (const v of cache.values()) { if (v.status === 'ok') ok++; else fail++; }
  $('#cacheInfo').textContent = `Tersimpan: ${fmtInt(ok)} alamat berhasil, ${fmtInt(fail)} gagal.`;
}

// ---------------------------------------------------------------- events

function bindEvents() {
  $('#legend').addEventListener('click', onLegendClick);
  $('#centerChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-center]');
    if (!b) return;
    selectCenter(b.dataset.center);
  });
  $('#tblCenters').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-center]');
    if (tr) { selectCenter(tr.dataset.center); document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
  document.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    state.mode = b.dataset.mode;
    document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    renderMapLayers(selection());
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
    document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    map.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 16 });
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
      flash($('#btnCopyFail'), 'Tersalin ✓');
    } catch {
      flash($('#btnCopyFail'), 'Gagal menyalin');
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

  const dlg = $('#dlgSettings');
  $('#btnSettings').addEventListener('click', () => { updateCacheInfo(); dlg.showModal(); });
  $('#btnLoadUrl').addEventListener('click', async () => {
    const url = $('#inpUrl').value.trim();
    if (!url) { setSrcStatus('Tempel link CSV terlebih dahulu.', true); return; }
    try {
      const text = await loadFromUrl(url);
      store.set('sheetUrl', url);
      applyData(text, 'Data dimuat');
      dlg.close();
    } catch (err) { setSrcStatus(err.message, true); }
  });
  $('#inpFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      applyData(await file.text(), `File ${file.name}`);
      dlg.close();
    } catch (err) { setSrcStatus(err.message, true); }
    e.target.value = '';
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
        n++;
      }
      updateCacheInfo();
      setSrcStatus(`${fmtInt(n)} entri cache diimpor.`);
      queue.paused = true;
      while (queue.running) await sleep(200);
      resetMarkers();
      buildQueue();
      render();
      renderProgress();
      if (queue.items.length) runQueue();
    } catch (err) { setSrcStatus(`Impor gagal: ${err.message}`, true); }
    e.target.value = '';
  });
  $('#btnClearCache').addEventListener('click', async () => {
    if (!confirm('Hapus semua hasil geocoding yang tersimpan? Semua alamat harus di-geocode ulang.')) return;
    queue.paused = true;
    while (queue.running) await sleep(200);
    cache.clear();
    await idb.clear();
    resetMarkers();
    updateCacheInfo();
    buildQueue();
    render();
    renderProgress();
    if (queue.items.length) runQueue();
  });
}

function selectCenter(code) {
  if (state.center === code) return;
  state.center = code;
  state.hiddenMonths.clear();
  state.kelLimit = KEL_PAGE;
  state.failLimit = FAIL_PAGE;
  state.editingFail = null;
  store.set('center', code);
  prioritizeQueue();
  drawRings();
  fitToSelection();
  render();
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1600);
}

// ---------------------------------------------------------------- start

async function main() {
  const savedCenter = store.get('center');
  if (savedCenter && (savedCenter === 'ALL' || CENTERS[savedCenter])) state.center = savedCenter;
  initMap();
  drawRings();
  bindEvents();
  render();
  await idb.open();
  await idb.loadAll();

  const params = new URLSearchParams(location.hash.slice(1));
  const hashUrl = params.get('csv');
  if (hashUrl) { store.set('sheetUrl', hashUrl); history.replaceState(null, '', location.pathname + location.search); }
  const url = hashUrl || store.get('sheetUrl');
  if (url) {
    $('#inpUrl').value = url;
    try {
      applyData(await loadFromUrl(url), 'Data dimuat');
      return;
    } catch (err) {
      setSrcStatus(err.message, true);
    }
  }
  updateCacheInfo();
  $('#dlgSettings').showModal();
}

main();
