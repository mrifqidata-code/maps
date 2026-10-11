# Sebaran Member

Aplikasi (bisa di-install di HP & laptop) untuk memvisualisasikan persebaran **member** dan **kompetitor (cabang Studiorenang)** relatif terhadap center Sparks Swim. Tampilan mengikuti dashboard *Rekap Mingguan Area*: filter center di atas, tab **Peta · Statistik · Kelurahan · Kompetitor · Data** (di HP tab ada di bawah). Menggantikan aplikasi terpisah *Persebaran Kompetitor Sparks Swim*.

**Link aplikasi:** https://mrifqidata-code.github.io/maps/

- **Peta** (OpenStreetMap + Leaflet), mode **Cluster / Pin / Heatmap / Wilayah** (warna per kelurahan)
  - *Semua center* → warna pin per center
  - *Satu center* → warna pin per **bulan registrasi**. Ketuk bulan di legenda untuk menyembunyikan/menampilkan. Ada lingkaran jarak 5/10/15 km.
  - Ketuk pin → nama (atau Sparks ID bila kolomnya ada), center, tanggal regis, alamat, jarak ke center, kelurahan
- **Statistik**: member terjauh (*longest range*), rata-rata & median jarak, ringkasan per center
- **Kelurahan**: jumlah member per kelurahan resmi (batas wilayah Dukcapil), terbanyak di atas (ketuk baris → batas kelurahan di peta)
- **Kompetitor** (dari aplikasi *Persebaran Kompetitor*): 45 cabang Studiorenang dengan jarak tempuh motor/garis lurus, harga survei per periode & paket (3/6/12 bulan), harga Sparks (pitch/bottom), gap per sesi, kompetitor utama per center, ringkasan per center. Tombol **Kompetitor** di tab Peta menampilkan cabang + label harga di peta (dan rute motor/radius).
- **Member vs kompetitor**: berapa member yang rumahnya lebih dekat ke cabang Studiorenang daripada ke center Sparks-nya, per center dan per cabang; tombol **Sorot rawan** menandai member tersebut di peta.
- **Data**: sumber data & sinkron, install aplikasi, server geocoding, cache, dan daftar alamat yang gagal di-geocode (bisa diedit & dicari ulang)
- Jarak dihitung dengan **haversine** (garis lurus) dari lokasi member ke center-nya masing-masing.

## Sinkron HP & laptop (Google Apps Script) — disarankan

Dengan Apps Script, app membaca data member **langsung dari Google Sheet** (tidak perlu *Publikasikan ke web*) dan **menyimpan hasil geocoding ke tab `Geocode Cache`** di sheet yang sama. Jadi geocoding cukup sekali, dan HP maupun laptop melihat hasil yang sama.

Pasang sekali (± 5 menit), dari akun Google pemilik sheet:

1. Buka Google Sheet member → **Ekstensi → Apps Script**.
2. Hapus isi `Code.gs`, lalu tempel seluruh isi file [`apps-script/Code.gs`](apps-script/Code.gs) dari repo ini → **Simpan** (ikon disket).
   - Jika data member bukan di tab pertama, isi `DATA_SHEET` dengan nama tabnya.
3. Klik **Terapkan (Deploy) → Deployment baru**. Pada ikon roda gigi pilih **Aplikasi web (Web app)**.
   - *Jalankan sebagai (Execute as)*: **Saya (Me)**
   - *Yang memiliki akses (Who has access)*: **Siapa saja (Anyone)**
4. Klik **Terapkan** → izinkan akses (pilih akun → *Advanced* → *Go to … (unsafe)* → *Allow*; ini script Anda sendiri).
5. Salin **URL aplikasi web** (diakhiri `/exec`).
6. Di app: tab **Data** → tempel di *Link Web App Apps Script* → **Hubungkan**.
7. Di perangkat lain: tab **Data → Salin link setup**, kirim ke perangkat itu (mis. lewat WhatsApp ke diri sendiri), lalu buka sekali. Sumber data langsung tersambung.

Catatan:
- Jika pilihan **Siapa saja (Anyone)** tidak tersedia (dibatasi admin Google Workspace kantor), buat salinan sheet di akun Gmail pribadi lalu pasang script di salinan itu, atau tetap pakai link CSV di bawah.
- Bila script diubah, buat versi baru: **Terapkan → Kelola deployment → Edit → Versi: Baru**. URL tetap sama.
- Siapa pun yang memegang URL `/exec` bisa membaca data member. Perlakukan URL itu seperti password; jangan ditaruh di repo.

### Update script (versi dengan Centers & Kompetitor)

Bila sebelumnya sudah memasang Apps Script versi lama:

1. Ganti seluruh isi `Code.gs` dengan [`apps-script/Code.gs`](apps-script/Code.gs) terbaru → **Simpan**.
2. **Terapkan → Kelola deployment → ikon pensil → Versi: Versi baru → Terapkan**. URL `/exec` tetap sama.
3. Google akan meminta izin baru (script sekarang juga membaca sheet *Feed Kompetitor*): pilih akun → *Advanced* → *Go to … (unsafe)* → *Allow*. Bila tidak muncul, jalankan sekali fungsi `doGet` dari editor (tombol *Run*) untuk memicu permintaan izin.
4. Pastikan sheet **Feed Kompetitor** sudah diizinkan menarik data (buka sheet itu, klik sel A2, *Izinkan akses*).

### Daftar center (tab "Centers")

Saat script pertama kali dipanggil, tab **Centers** dibuat otomatis di sheet member dengan 6 center awal: `Kode | Nama | Alamat | Lat | Lon | Warna (opsional) | Aktif`.

- **Tambah center baru**: tambah satu baris. Kode harus sama persis dengan isi kolom `Center` di data member. Lat/Lon dari Google Maps (tekan lama lokasi → salin angka). Warna boleh kosong (otomatis).
- **Nonaktifkan center**: isi kolom Aktif dengan `FALSE`.
- Buka ulang aplikasi: center baru langsung muncul di filter, peta, statistik, dan tab Kompetitor. Alamat member center baru di-geocode ulang di sekitar center tersebut.
- Jarak tempuh motor & rute ke cabang kompetitor sudah dihitung untuk 6 center awal; center baru memakai jarak garis lurus sampai rutenya dihitung ulang.

### Harga kompetitor

Harga **tidak disimpan di repo** (repo publik). Harga dibaca dari sheet *Feed Kompetitor* (`KOMPETITOR_FEED_ID` di `Code.gs`), yang menarik data dari *Sparks Swim - Competitor Analysis*. Cara isi tetap sama: tambah baris di **Log Harga** / **Harga Sparks** / **Ringkasan** di sheet Competitor Analysis, lalu di app tab Kompetitor tekan **Muat ulang harga**. Lokasi & jarak cabang ada di `data/kompetitor.json` (data publik dari studiorenang.com).

## Alternatif tanpa sinkron: link CSV

Di tab **Data → Atau pakai link CSV / file**: tempel link *File → Bagikan → Publikasikan ke web* (format CSV), atau upload file CSV. Hasil geocoding hanya tersimpan di browser itu; pindahkan ke perangkat lain dengan **Ekspor cache / Impor cache**.

## Install sebagai aplikasi

- **Android (Chrome)**: buka link aplikasi → tab **Data → Install aplikasi**, atau menu ⋮ → *Install aplikasi*.
- **Laptop (Chrome/Edge)**: ikon install di ujung kanan address bar, atau tab **Data → Install aplikasi**.
- **iPhone (Safari)**: tombol Bagikan → *Tambah ke Layar Utama*.

### Tentang kecepatan geocoding

Nominatim (gratis, tanpa API key) membatasi **1 request per detik**, jadi geocoding pertama untuk ribuan alamat butuh waktu lama (± 1 jam per 2.500–3.000 alamat unik). Supaya praktis:

- Hasil geocoding **disimpan di browser** (IndexedDB) dan, bila Apps Script tersambung, di tab `Geocode Cache`. Aman di-*jeda*, ditutup, atau terputus: saat dibuka lagi, geocoding dilanjutkan dari yang belum. Setelah selesai, app terbuka instan.
- Alamat yang sama (mis. kakak-adik) hanya di-geocode sekali.
- Center yang sedang dipilih diproses lebih dulu.
- **Tip:** jalankan geocoding pertama di laptop (layar tidak mati). Dengan Apps Script, hasilnya otomatis tersimpan ke sheet dan langsung terpakai di HP.
- Data baru di sheet? Cukup buka ulang app: hanya alamat baru yang di-geocode.

### Server geocoding: Nominatim & Photon

Default-nya **Otomatis**: memakai Nominatim, dan jika Nominatim menolak akses (mis. IP diblokir sementara ± 20 jam, sering terjadi di jaringan seluler yang IP-nya dipakai bersama), app otomatis beralih ke [Photon](https://photon.komoot.io) (komoot). Photon juga gratis, tanpa API key, dan memakai data OpenStreetMap. Pilihan bisa diubah di *Data → Server geocoding*. Catatan: nama kelurahan dari Photon bisa sedikit kurang presisi dibanding Nominatim.

### Cara alamat dicocokkan

1. Alamat dibersihkan (RT/RW, nomor rumah, blok, kode pos dibuang; singkatan seperti `Jl.`, `Gg.`, `Komp.`, `Pd.` diperluas).
2. Dicari di sekitar center member tersebut (± 33 km) lebih dulu, lalu se-Jabodetabek bila belum ketemu.
3. Bila alamat lengkap tidak ketemu, dicoba bagian area (kelurahan/kecamatan) atau nama jalannya saja. Hasil seperti ini ditandai **“Lokasi perkiraan”** di popup.
4. **Kelurahan ditentukan dari batas wilayah resmi**: titik hasil geocoding dicek masuk ke poligon kelurahan/desa yang mana (lihat bagian *Data batas kelurahan*). Untuk titik berstatus *Lokasi perkiraan*, bila alamat menyebut nama kelurahan yang letaknya ≤ 4 km dari titik, nama dari alamat yang dipakai (ditandai di popup).
5. Hasil yang hanya cocok di level kota/provinsi dianggap **gagal** (tidak dipetakan), supaya jarak tidak menyesatkan. Alamat itu muncul di daftar gagal untuk dicek manual.

Baris tanpa alamat (atau berisi teks yang bukan alamat) dilewati dan dihitung sebagai “Tanpa alamat”.

## Data batas kelurahan

`data/kelurahan-jabodetabek.json` berisi batas 1.508 kelurahan/desa se-Jabodetabek (DKI Jakarta, Kota & Kab. Bekasi, Kota & Kab. Tangerang, Tangerang Selatan, Depok, Kota & Kab. Bogor), disederhanakan ke ketelitian ± 13 m. Sumber: Portal GIS Dukcapil Kemendagri, lewat [pararawendy/border-desa-indonesia-geojson](https://github.com/pararawendy/border-desa-indonesia-geojson) (repo tersebut tidak mencantumkan lisensi). Dibangun ulang dengan:

```
python3 tools/build_kelurahan.py path/ke/indonesia_villages_border.geojson
```

Dipakai untuk: nama kelurahan/kecamatan/kota resmi di popup & tabel, mode peta **Wilayah** (warna per kelurahan menurut jumlah member), dan garis batas saat baris di tab Kelurahan diketuk. Hasil geocoding lama tidak perlu diulang: kelurahan dihitung ulang dari titik yang tersimpan. Titik di luar Jabodetabek memakai label dari geocoder.

Ketepatan kelurahan mengikuti ketepatan titik: alamat yang hanya cocok sampai nama jalan/area bisa jatuh di kelurahan tetangga.

## Kolom yang dibaca

| Kolom di sheet | Dipakai untuk |
|---|---|
| `Center` | center member (HIB/KLM/KWC/PML/BTU/TMP) |
| `Child's Full Name …` | nama di popup & kartu “longest range” |
| `Sparks ID` *(opsional)* | bila ada, ditampilkan sebagai judul popup |
| `Alamat` | alamat yang di-geocode |
| `Tgl Regis` (atau `Regist Month`/`Regist Year`) | warna pin per bulan |

Koordinat center ada di `app.js` (`CENTERS`).

## Privasi

Repo ini **publik**, jadi **jangan commit** data member (CSV), file cache, atau URL Apps Script ke repo (`.gitignore` sudah mengecualikan `*.csv` dan `geocode-cache*.json`). Data hanya diambil oleh browser saat app dibuka. Alamat dikirim ke Nominatim/Photon untuk geocoding, tanpa nama.

## Hosting (GitHub Pages)

App ini statis (tanpa build). Aktifkan di GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch** → pilih branch dan folder `/ (root)` → *Save*. Setelah ± 1 menit, app tersedia di `https://<username>.github.io/maps/`. Service worker (`sw.js`) membuat app bisa di-install; file app selalu diambil dari jaringan dulu, jadi update langsung terpakai setelah dibuka ulang.

Untuk mencoba secara lokal: `python3 -m http.server` lalu buka `http://localhost:8000`.

## Library

Disertakan di `vendor/` (tanpa CDN): Leaflet 1.9.4, Leaflet.markercluster 1.5.3, Leaflet.heat 0.2.0, PapaParse 5.4.1. Lisensi masing-masing ada di foldernya.
