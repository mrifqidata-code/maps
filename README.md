# Sebaran Member

Web app (bisa dibuka di HP) untuk memvisualisasikan persebaran member berdasarkan alamat, relatif terhadap 6 center (HIB, KLM, KWC, PML, BTU, TMP).

- **Peta interaktif** (OpenStreetMap + Leaflet) dengan mode **Cluster / Pin / Heatmap**
  - *Semua center* → warna pin per center
  - *Satu center* → warna pin per **bulan registrasi** (Jan 2026 ≠ Feb 2026). Ketuk bulan di legenda untuk menyembunyikan/menampilkan. Ada lingkaran jarak 5/10/15 km.
  - Ketuk pin → nama (atau Sparks ID bila kolomnya ada), center, tanggal regis, alamat, jarak ke center, kelurahan
- **Statistik**: member terjauh (*longest range*), rata-rata & median jarak, ringkasan per center, jumlah member per kelurahan (terbanyak di atas), dan daftar alamat yang gagal di-geocode (bisa diedit & dicari ulang)
- Jarak dihitung dengan **haversine** (garis lurus) dari lokasi member ke center-nya masing-masing.

## Cara pakai

1. **Publish sheet sebagai CSV.** Di Google Sheet: *File → Bagikan → Publikasikan ke web* → pilih sheet yang berisi data dan format **CSV (.csv)** → *Publikasikan* → salin link-nya.
   - Alternatif: sheet dibagikan “Siapa saja yang memiliki link dapat melihat”, lalu tempel link biasa (`…/edit#gid=0`).
   - Atau: ekspor sheet ke CSV dan pakai tombol **Upload file CSV**.
2. Buka app, ketuk **Data**, tempel link, lalu **Muat data**. Link disimpan di browser itu saja (tidak masuk ke repo).
3. Geocoding berjalan otomatis dengan indikator progress (jumlah alamat, berhasil/gagal, perkiraan sisa waktu). Peta dan statistik terisi bertahap.

### Tentang kecepatan geocoding

Nominatim (gratis, tanpa API key) membatasi **1 request per detik**, jadi geocoding pertama untuk ribuan alamat butuh waktu lama (± 1 jam per 2.500–3.000 alamat unik). Supaya praktis:

- Hasil geocoding **disimpan di browser** (IndexedDB). Aman di-*jeda*, ditutup, atau terputus: saat dibuka lagi, geocoding dilanjutkan dari yang belum. Setelah selesai, app terbuka instan.
- Alamat yang sama (mis. kakak-adik) hanya di-geocode sekali.
- Center yang sedang dipilih diproses lebih dulu.
- **Tip:** jalankan geocoding pertama di laptop (layar tidak mati), lalu *Data → Ekspor cache*, dan di HP *Data → Impor cache*.
- Data baru di sheet? Cukup buka ulang app: hanya alamat baru yang di-geocode.

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

Repo ini **publik**, jadi **jangan commit** data member (CSV) atau file cache ke repo (`.gitignore` sudah mengecualikan `*.csv` dan `geocode-cache*.json`). Data hanya diambil oleh browser saat app dibuka. Alamat dikirim ke Nominatim untuk geocoding, tanpa nama.

## Hosting (GitHub Pages)

App ini statis (tanpa build). Aktifkan di GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch** → pilih branch dan folder `/ (root)` → *Save*. Setelah ± 1 menit, app tersedia di `https://<username>.github.io/maps/`. Di HP, buka link itu lalu *Tambahkan ke Layar Utama*.

Untuk mencoba secara lokal: `python3 -m http.server` lalu buka `http://localhost:8000`.

## Library

Disertakan di `vendor/` (tanpa CDN): Leaflet 1.9.4, Leaflet.markercluster 1.5.3, Leaflet.heat 0.2.0, PapaParse 5.4.1. Lisensi masing-masing ada di foldernya.
