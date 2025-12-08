# Proyek Web Peta Cuaca & Gempa Interaktif

Proyek ini adalah aplikasi web GIS (Geographic Information System) interaktif yang memvisualisasikan data cuaca dan aktivitas gempa bumi di wilayah Indonesia. Aplikasi ini menggabungkan performa tinggi dari **MapLibre GL JS** di sisi frontend dengan backend **Flask** yang ringan, didukung oleh database **PostgreSQL/PostGIS** untuk analisis spasial.

Proyek ini dirancang untuk dapat dijalankan secara **Lokal (Docker)** atau **Cloud (Vercel + Supabase + Upstash)**.

## 🌍 Sumber Data

Aplikasi ini menggunakan data dari berbagai sumber terpercaya:

* **Data Geospasial (Batas Wilayah):**
    * Sumber: **Badan Informasi Geospasial (BIG)**.
    * Format: Data vektor batas Provinsi, Kabupaten/Kota, dan Kecamatan diproses lalu dikonversi menjadi format *Vector Tiles* (`.pmtiles`) untuk rendering peta yang sangat cepat.
    * Link: [https://tanahair.indonesia.go.id/portal-web/unduh](https://tanahair.indonesia.go.id/portal-web/unduh)
* **Data Cuaca:**
    * Sumber: **Open-Meteo API**.
    * Cakupan: Data historis dan prakiraan hari ini, 7 hari sebelumnya, dan 7 hari setelahnya (Suhu, Curah Hujan, Kelembapan, Angin, dll).
    * Link: [https://open-meteo.com/en/docs](https://open-meteo.com/en/docs)
* **Data Gempa Bumi:**
    * Sumber: **BMKG** (Badan Meteorologi, Klimatologi, dan Geofisika) dan **USGS** (United States Geological Survey).
    * Fitur: Mendukung de-duplikasi data antar sumber dan deteksi potensi tsunami.
    * Link data BMKG: [https://data.bmkg.go.id/gempabumi/](https://data.bmkg.go.id/gempabumi/)
    * Link data USGS: [https://earthquake.usgs.gov/earthquakes/search/](https://earthquake.usgs.gov/earthquakes/search/)

## 🚀 Fitur Utama

-   **Peta Vector Tiles**: Rendering batas wilayah administratif yang halus dan cepat menggunakan protokol PMTiles.
-   **Monitoring Cuaca Real-time**: Visualisasi data cuaca per wilayah (Provinsi hingga Kecamatan/Distrik).
-   **Info Gempa Terintegrasi**: Mode khusus untuk melihat persebaran gempa terbaru dengan indikator kekuatan (Magnitude/MMI) dan potensi tsunami.
-   **Smart Caching**:
    -   *In-Memory* (Lokal) atau *Redis/Upstash* (Cloud) untuk menyimpan respon API eksternal.
    -   Mengurangi latensi dan menghemat kuota rate-limit API.
-   **Pencarian Lokasi**: *Autocomplete* pencarian wilayah administrasi di seluruh Indonesia.
-   **Responsif**: Tampilan sidebar dan peta yang menyesuaikan perangkat desktop dan mobile.

## 🛠️ Teknologi yang Digunakan

-   **Backend**: Flask (Python).
-   **Frontend**: MapLibre GL JS, Vanilla JS (ES6 modules).
-   **Database**: PostgreSQL + PostGIS Extension.
-   **Caching**: Redis (via Upstash untuk produksi).
-   **Maps Storage**: Supabase Storage (untuk file `.pmtiles` di produksi).

## 📋 Prasyarat

Sebelum memulai, pastikan Anda telah menginstal:

1.  **Python** (versi 3.9 atau lebih baru).
2.  **Docker** dan **Docker Compose** (untuk database lokal).
3.  **Git**.

---

## ⚙️ Konfigurasi Lingkungan (.env)

Proyek ini sangat bergantung pada variabel lingkungan. Buat file `.env` di root direktori proyek. Berikut adalah panduan lengkap variabelnya:

### 1. Variabel Wajib (Lokal dengan Docker)
Konfigurasi ini digunakan untuk menghubungkan Flask dengan container PostGIS lokal.

```env
# Kredensial Database Docker
POSTGRES_USER=user
POSTGRES_PASSWORD=password
POSTGRES_DB=weather_db
POSTGRES_PORT=5432

# URL Koneksi untuk Aplikasi (SQLAlchemy) saat berjalan lokal
DEV_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}"
````

### 2\. Variabel Mode & Deployment

Mengatur perilaku aplikasi antara Development (Lokal) dan Production (Cloud).

```env
# Lingkungan Aplikasi: "development" atau "production"
# - development: Menggunakan aset peta lokal (/static/maps) dan logging debug.
# - production: Menggunakan aset peta dari URL Cloud (Supabase) dan optimasi caching.
VERCEL_ENV="development"

# Sumber Data API: "true" atau "false"
# - true: Mengambil data ASLI dari Open-Meteo/BMKG/USGS (Membutuhkan internet).
# - false: Menggunakan data DUMMY (Untuk testing tanpa internet/hemat kuota).
USE_REAL_API=false
```

### 3\. Variabel Khusus Cloud / Migrasi Data

Variabel ini wajib diisi jika Anda melakukan **deployment ke Vercel** atau saat menjalankan **skrip migrasi data**.

```env
# URL Koneksi Database Utama (Supabase / Docker Internal Network)
# Saat migrasi lokal: Isi sama dengan DEV_DATABASE_URL
# Saat deploy cloud: Isi dengan Connection String dari Supabase (Transaction Pooler)
DATABASE_URL=

# URL Redis (Opsional)
# Jika diisi, aplikasi akan menggunakan Redis (misal: Upstash) untuk caching.
# Jika kosong, aplikasi menggunakan In-Memory Cache (hilang saat restart).
REDIS_URL=

# URL Bucket Storage Peta (Khusus Production)
# Link publik ke bucket Supabase tempat menyimpan file .pmtiles
SUPABASE_MAPS_URL=
```

-----

## 💻 Cara Menjalankan (Lokal dengan Docker)

### 1\. Kloning Repositori

```bash
git clone https://github.com/salman-dzaky/web-cuaca-gempa.git
```

### 2\. Siapkan Virtual Environment

```bash
python -m venv venv
# Windows
.\venv\Scripts\activate
# Linux/Mac
source venv/bin/activate
```

### 3\. Jalankan Database (PostGIS)

Pastikan Docker Desktop sudah berjalan. Ganti nilai variabel di file .env jika perlu.

```bash
docker-compose up -d
```

*Tunggu beberapa saat hingga container database siap menerima koneksi.*

### 4\. Instal Dependensi

```bash
pip install -r requirements.txt
```

### 5\. Migrasi Data (PENTING)

Langkah ini akan mengisi database PostGIS dengan data batas wilayah dari file GeoJSON dan CSV yang ada di folder `static`.

> **Catatan:** Pastikan variabel `DATABASE_URL` di file `.env` menunjuk ke database lokal Anda (sama dengan `DEV_DATABASE_URL`) sebelum menjalankan perintah ini.

```bash
python migrate_data.py
```

*Tunggu hingga proses selesai. Script ini akan membuat tabel `batas_provinsi`, `batas_kabupatenkota`, `batas_kecamatandistrik`, dan `wilayah_administratif`.*

### 6\. Jalankan Aplikasi

```bash
python app.py
```

Buka browser dan akses: `http://localhost:5000`

-----

## ☁️ Panduan Deployment (Vercel + Supabase)

Untuk men-deploy aplikasi ini ke internet secara gratis (tier hobby):

### 1\. Persiapan Database (Supabase)

1.  Buat proyek baru di [Supabase](https://supabase.com/).
2.  Masuk ke SQL Editor di dashboard Supabase, jalankan: `CREATE EXTENSION postgis;`
3.  Dapatkan *Connection String* (URI) database Anda.

### 2\. Migrasi Data ke Cloud

1.  Di komputer lokal, ubah isi `.env` variabel `DATABASE_URL` menjadi Connection String Supabase Anda.
2.  Jalankan `python migrate_data.py`. Data GeoJSON lokal akan diunggah ke Supabase.

### 3\. Hosting Aset Peta (Supabase Storage)

1.  Di Supabase, buat Bucket Storage baru bernama `maps` (set ke Public).
2.  Upload file `.pmtiles` (Provinsi, Kabupaten, Kecamatan) ke bucket tersebut.
3.  Salin URL publik folder tersebut untuk variabel `SUPABASE_MAPS_URL`.

### 4\. Setup Redis (Upstash - Opsional)

1.  Buat database Redis di [Upstash](https://upstash.com/).
2.  Salin URL koneksi (`rediss://...`) untuk variabel `REDIS_URL`.

### 5\. Deploy ke Vercel

1.  Install Vercel CLI atau hubungkan repositori GitHub ke dashboard Vercel.
2.  Tambahkan **Environment Variables** di pengaturan proyek Vercel:
      * `VERCEL_ENV`: `production`
      * `USE_REAL_API`: `true`
      * `DATABASE_URL`: (Connection String Supabase)
      * `REDIS_URL`: (URL Upstash)
      * `SUPABASE_MAPS_URL`: (URL Public Bucket Supabase)
3.  Deploy\!

-----

## 📂 Struktur Proyek

```
web-cuaca/
│
├── app.py                  # Entry point Flask & Backend API
├── migrate_data.py         # Skrip ETL (GeoJSON -> PostGIS)
├── docker-compose.yml      # Orkestrasi container Database Lokal
├── requirements.txt        # Daftar pustaka Python
├── vercel.json             # Konfigurasi deployment serverless
├── .env                    # Variabel lingkungan (JANGAN DI-COMMIT, PASTIKAN DIMASUKKAN KE .gitignore)
│
├── static/
│   ├── css/                # Stylesheets (Global, Sidebar, Map Controls)
│   ├── js/                 # Modular JavaScript (ES6)
│   │   ├── main.js         # Entry point Frontend
│   │   ├── map_manager.js  # Logika peta & marker
│   │   ├── weather_service.js  # Fetcher data cuaca
│   │   ├── gempa_manager.js # Fetcher data gempa
│   │   └── ...
│   ├── images/             # Ikon cuaca SVG
│   └── maps/               # File .pmtiles & .geojson (Sumber data jika deploy lokal)
│
└── templates/
    └── index.html          # Template HTML Utama
```

## 👥 Tim Pengembang

Proyek ini dibuat untuk memenuhi penugasan mata kuliah.

  * **Dzaky Dzakwan**
  * **Lukman Hakim**
  * **Salman Dzaky**

## 📄 Lisensi

[MIT License](https://www.google.com/search?q=LICENSE) - Silakan gunakan dan modifikasi kode ini untuk keperluan belajar atau pengembangan lebih lanjut.

```
MIT License

Copyright (c) 2025 salman-dzaky

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```
