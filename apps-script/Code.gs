/**
 * Sebaran Member — penghubung Google Sheet untuk app di GitHub Pages.
 *
 * Fungsi:
 *  - GET  ?action=all   → data member + cache geocoding + daftar center + feed kompetitor
 *  - GET  ?action=ping  → cek koneksi
 *  - POST {action:'cache', entries:[[key, json], ...]} → simpan hasil geocoding
 *
 * Hasil geocoding disimpan di tab "Geocode Cache" (dibuat otomatis), jadi semua
 * perangkat (HP, laptop) memakai hasil yang sama.
 * Daftar center ada di tab "Centers" (dibuat otomatis dengan 6 center awal). Tambah center
 * baru cukup dengan menambah baris di tab itu.
 * Harga kompetitor dibaca dari sheet "Feed Kompetitor" (KOMPETITOR_FEED_ID) — tidak pernah
 * disimpan di repo GitHub. Daftar cabang kompetitor (semua brand) dibaca dari tab
 * "Lokasi Kompetitor" di sheet Competitor Analysis (dibuat otomatis saat pertama dipakai).
 *
 * Cara pasang: lihat README di repo (bagian "Sinkron HP & laptop").
 */

// Nama tab berisi data member. Kosongkan ('') untuk memakai tab pertama.
const DATA_SHEET = '';
const CACHE_SHEET = 'Geocode Cache';
const CACHE_HEADER = ['Key', 'Data (JSON)', 'Status', 'Lat', 'Lon', 'Kelurahan', 'Kecamatan', 'Kota', 'Server', 'Diperbarui'];

const CENTERS_SHEET = 'Centers';
const CENTERS_HEADER = ['Kode', 'Nama', 'Alamat', 'Lat', 'Lon', 'Warna (opsional)', 'Aktif (TRUE/FALSE)'];
const CENTERS_SEED = [
  ['HIB', 'Harapan Indah Bekasi', 'Mega Office Park, Jl. Harapan Indah Boulevard, Medan Satria, Kota Bekasi 17132', -6.179084581029557, 106.97414478968899, '', true],
  ['KLM', 'Kalimalang', 'Jl. Pahlawan Revolusi No.11, Pd. Bambu, Duren Sawit, Jakarta Timur 13430', -6.239288418633617, 106.8997994939914, '', true],
  ['KWC', 'Karawaci', 'Jl. Palem Semi, Panunggangan Barat, Cibodas, Kota Tangerang 15318', -6.2185146814319925, 106.61665600503935, '', true],
  ['PML', 'Pamulang', 'Jl. Raya Puspitek, Babakan, Setu, Tangerang Selatan 15315', -6.346124651378747, 106.69648245109295, '', true],
  ['BTU', 'Bintaro U-Town', 'Bintaro U-Town Jaya, Jl. Boulevard UPJ No.1, Sawah Baru, Ciputat, Tangerang Selatan 15413', -6.292965677930978, 106.72602235903597, '', true],
  ['TMP', 'Taman Palem', 'Jl. Palem Raja Barat No.10, Pegadungan, Kalideres, Jakarta Barat 11830', -6.124072093581825, 106.70609238967546, '', true],
];

// Sheet "Feed Kompetitor (dari Competitor Analysis)". Kosongkan bila tidak dipakai.
const KOMPETITOR_FEED_ID = '1JCvIrXRF0n9yJnucMUj2hOxuPJjjUY8T8tKi0tjvxyM';
// Sheet "Sparks Swim - Competitor Analysis": daftar cabang kompetitor ada di tab LOKASI_SHEET.
const KOMPETITOR_SHEET_ID = '1plqm0d-1sBAig0pzL3PG7jdanmrjSqggSCYcW06aEYQ';
const LOKASI_SHEET = 'Lokasi Kompetitor';
const LOKASI_HEADER = ['Brand', 'Cabang', 'Alamat', 'Koordinat (lat, lon)', 'Link Google Maps', 'Aktif (TRUE/FALSE)', 'Catatan'];

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
  if (action === 'all' || action === 'centers') out.centers = readCenters_(ss);
  if ((action === 'all' || action === 'kompetitor') && KOMPETITOR_FEED_ID) {
    try {
      const feed = SpreadsheetApp.openById(KOMPETITOR_FEED_ID).getSheets()[0];
      out.kompetitor = { rows: feed.getDataRange().getDisplayValues(), at: new Date().toISOString() };
    } catch (err) {
      out.kompetitorError = 'Feed Kompetitor tidak bisa dibuka: ' + err.message;
    }
  }
  if ((action === 'all' || action === 'kompetitor') && KOMPETITOR_SHEET_ID) {
    try {
      const sh = SpreadsheetApp.openById(KOMPETITOR_SHEET_ID).getSheetByName(LOKASI_SHEET);
      if (!sh) out.lokasiMissing = true;
      else out.lokasi = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, LOKASI_HEADER.length).getDisplayValues();
    } catch (err) {
      out.lokasiError = 'Tab "' + LOKASI_SHEET + '" tidak bisa dibuka: ' + err.message;
    }
  }
  return json_(out);
}

// Membuat tab "Lokasi Kompetitor" sekali, diisi daftar cabang yang dikirim app (hanya bila tab belum ada).
function seedLokasi_(rows) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(KOMPETITOR_SHEET_ID);
    if (ss.getSheetByName(LOKASI_SHEET)) return json_({ ok: true, created: false });
    const clean = rows.filter(function (r) { return Array.isArray(r) && r.length >= 4; }).slice(0, 2000)
      .map(function (r) {
        return LOKASI_HEADER.map(function (_, i) {
          if (i === 5) return r[i] !== false;
          if (i === 3) return String(r[i] == null ? '' : r[i]).replace(/^=+/, ''); // kolom teks; jangan diberi awalan '
          return safe_(r[i]);
        });
      });
    const sh = ss.insertSheet(LOKASI_SHEET, ss.getNumSheets());
    sh.getRange(1, 1, 1, LOKASI_HEADER.length).setValues([LOKASI_HEADER]).setFontWeight('bold');
    sh.getRange('D:D').setNumberFormat('@'); // koordinat sebagai teks, mis. "-6.2345, 106.8765"
    if (clean.length) sh.getRange(2, 1, clean.length, LOKASI_HEADER.length).setValues(clean);
    sh.setFrozenRows(1);
    return json_({ ok: true, created: true, rows: clean.length });
  } finally {
    lock.releaseLock();
  }
}

function readCenters_(ss) {
  let sh = ss.getSheetByName(CENTERS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CENTERS_SHEET, ss.getNumSheets());
    sh.getRange(1, 1, 1, CENTERS_HEADER.length).setValues([CENTERS_HEADER]).setFontWeight('bold');
    sh.getRange(2, 1, CENTERS_SEED.length, CENTERS_HEADER.length).setValues(CENTERS_SEED);
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, CENTERS_HEADER.length).getValues()
    .filter(function (r) { return String(r[0]).trim() && r[3] !== '' && r[4] !== ''; })
    .map(function (r) {
      return {
        code: String(r[0]).trim().toUpperCase(), name: String(r[1]).trim(), addr: String(r[2]).trim(),
        lat: Number(String(r[3]).replace(',', '.')), lon: Number(String(r[4]).replace(',', '.')),
        color: String(r[5]).trim(), active: !(r[6] === false || /^(false|tidak|no|0)$/i.test(String(r[6]).trim())),
      };
    });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Body bukan JSON.' });
  }
  if (body.action === 'seedLokasi' && Array.isArray(body.rows) && KOMPETITOR_SHEET_ID) return seedLokasi_(body.rows);
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
    sh = ss.insertSheet(CACHE_SHEET, ss.getNumSheets()); // di paling belakang, supaya tab data tetap tab pertama
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
