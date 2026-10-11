/**
 * Sebaran Member — penghubung Google Sheet untuk app di GitHub Pages.
 *
 * Fungsi:
 *  - GET  ?action=all   → data member (sheet data) + cache geocoding
 *  - GET  ?action=ping  → cek koneksi
 *  - POST {action:'cache', entries:[[key, json], ...]} → simpan hasil geocoding
 *
 * Hasil geocoding disimpan di tab "Geocode Cache" (dibuat otomatis), jadi semua
 * perangkat (HP, laptop) memakai hasil yang sama.
 *
 * Cara pasang: lihat README di repo (bagian "Sinkron HP & laptop").
 */

// Nama tab berisi data member. Kosongkan ('') untuk memakai tab pertama.
const DATA_SHEET = '';
const CACHE_SHEET = 'Geocode Cache';
const CACHE_HEADER = ['Key', 'Data (JSON)', 'Status', 'Lat', 'Lon', 'Kelurahan', 'Kecamatan', 'Kota', 'Server', 'Diperbarui'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || 'all';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = { ok: true, app: 'sebaran-member', version: 1 };
  if (action === 'ping') return json_(out);
  if (action === 'all' || action === 'data') {
    const sh = DATA_SHEET ? ss.getSheetByName(DATA_SHEET) : ss.getSheets()[0];
    if (!sh) return json_({ ok: false, error: 'Tab data "' + DATA_SHEET + '" tidak ditemukan.' });
    out.sheet = sh.getName();
    out.rows = sh.getDataRange().getDisplayValues();
  }
  if (action === 'all' || action === 'cache') out.cache = readCache_(ss);
  return json_(out);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Body bukan JSON.' });
  }
  if (body.action !== 'cache' || !Array.isArray(body.entries)) return json_({ ok: false, error: 'Request tidak dikenal.' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = cacheSheet_(ss);
    const last = sh.getLastRow();
    const width = CACHE_HEADER.length;
    const existing = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
    const index = new Map();
    existing.forEach(function (r, i) { index.set(String(r[0]), i); });

    const append = [];
    let updated = 0;
    body.entries.forEach(function (pair) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') return;
      const key = pair[0];
      const raw = pair[1];
      if (key.length > 600 || raw.length > 8000) return;
      let v;
      try { v = JSON.parse(raw); } catch (err) { return; }
      const row = toRow_(key, raw, v);
      if (index.has(key)) {
        existing[index.get(key)] = row;
        updated++;
      } else {
        index.set(key, existing.length + append.length);
        append.push(row);
      }
    });
    if (updated) sh.getRange(2, 1, existing.length, width).setValues(existing);
    if (append.length) sh.getRange(sh.getLastRow() + 1, 1, append.length, width).setValues(append);
    return json_({ ok: true, added: append.length, updated: updated });
  } finally {
    lock.releaseLock();
  }
}

function readCache_(ss) {
  const sh = ss.getSheetByName(CACHE_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .filter(function (r) { return r[0] && r[1]; })
    .map(function (r) { return [String(r[0]), String(r[1])]; });
}

function cacheSheet_(ss) {
  let sh = ss.getSheetByName(CACHE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CACHE_SHEET);
    sh.getRange(1, 1, 1, CACHE_HEADER.length).setValues([CACHE_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Kolom teks agar alamat/JSON tidak dibaca sebagai angka atau rumus.
    sh.getRange('A:B').setNumberFormat('@');
  }
  return sh;
}

function toRow_(key, raw, v) {
  const t = Number(v.t);
  return [
    key, raw, v.status === 'ok' ? 'berhasil' : 'gagal',
    v.status === 'ok' ? Number(v.lat) : '', v.status === 'ok' ? Number(v.lon) : '',
    safe_(v.kel), safe_(v.kec), safe_(v.city), safe_(v.src),
    isFinite(t) && t > 0 ? new Date(t) : '',
  ];
}

// Cegah teks yang diawali = + - @ dibaca sebagai rumus.
function safe_(s) {
  s = s == null ? '' : String(s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
