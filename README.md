# Sebaran Member

Aplikasi (bisa di-install di HP & laptop) untuk memvisualisasikan persebaran member berdasarkan alamat, relatif terhadap 6 center (HIB, KLM, KWC, PML, BTU, TMP). Tampilan mengikuti dashboard *Rekap Mingguan Area*: filter center di atas, empat tab **Peta · Statistik · Kelurahan · Data** (di HP tab ada di bawah).

**Link aplikasi:** https://mrifqidata-code.github.io/maps/

- **Peta** (OpenStreetMap + Leaflet), mode **Cluster / Pin / Heatmap**
  - *Semua center* → warna pin per center
  - *Satu center* → warna pin per **bulan registrasi**. Ketuk bulan di legenda untuk menyembunyikan/menampilkan. Ada lingkaran jarak 5/10/15 km.
  - Ketuk pin → nama (atau Sparks ID bila kolomnya ada), center, tanggal regis, alamat, jarak ke center, kelurahan
- **Statistik**: member terjauh (*longest range*), rata-rata & median jarak, ringkasan per center
- **Kelurahan**: jumlah member per kelurahan, terbanyak di atas (ketuk baris → zoom di peta)
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
4. Kelurahan diambil dari detail alamat hasil geocoding; bila kosong, dilakukan **reverse geocoding** pada titik tersebut.
5. Hasil yang hanya cocok di level kota/provinsi dianggap **gagal** (tidak dipetakan), supaya jarak tidak menyesatkan. Alamat itu muncul di daftar gagal untuk dicek manual.

Baris tanpa alamat (atau berisi teks yang bukan alamat) dilewati dan dihitung sebagai “Tanpa alamat”.

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
