# Proyek Web Peta Cuaca Interaktif

Ini adalah proyek web untuk menampilkan data cuaca secara interaktif di atas peta Indonesia. Aplikasi ini menggunakan arsitektur modern dengan backend Flask (Python) dan database PostGIS untuk menangani data geospasial, serta frontend berbasis MapLibre GL JS untuk rendering peta yang efisien.

## Fitur Utama

- **Peta Vector Tiles**: Menggunakan format `.mbtiles` untuk rendering peta dasar yang cepat dan efisien.
- **Data Geospasial Dinamis**: Batas-batas wilayah (provinsi, kabupaten, kecamatan) dimuat dari database PostGIS, bukan dari file statis.
- **Pemuatan Data Cerdas (On-Demand)**: Data marker cuaca hanya dimuat untuk area yang terlihat di peta, mengurangi beban server dan klien.
- **Layer Berbasis Zoom**: Tampilan marker (provinsi, kabupaten, kecamatan) disesuaikan secara otomatis berdasarkan tingkat zoom peta.
- **Marker Terklasterisasi**: Marker untuk kabupaten dan kecamatan dikelompokkan secara otomatis pada tingkat zoom yang lebih rendah untuk menjaga kejelasan peta.
- **Caching**: Data cuaca di-cache di sisi server dan klien untuk meminimalkan panggilan API eksternal yang berulang.
- **Lingkungan Berbasis Docker**: Database PostgreSQL + PostGIS dijalankan dalam kontainer Docker untuk kemudahan penyiapan dan portabilitas.

## Prasyarat

Sebelum memulai, pastikan Anda telah menginstal perangkat lunak berikut:

1.  **Python** (versi 3.8 atau lebih baru)
2.  **Docker** dan **Docker Compose**
3.  **Git**

## Cara Menjalankan Proyek

Ikuti langkah-langkah ini untuk menyiapkan dan menjalankan aplikasi di lingkungan lokal Anda.

### 1. Kloning Repositori

```bash
git clone https://github.com/Lukman1085/Project_kuliah.git
cd Project_kuliah/web-cuaca
```

### 2. Buat dan Aktifkan Lingkungan Virtual Python

Sangat disarankan untuk menggunakan lingkungan virtual untuk mengisolasi dependensi proyek.

```bash
# Membuat lingkungan virtual
python -m venv venv

# Mengaktifkan di Windows
.\venv\Scripts\activate

# Mengaktifkan di macOS/Linux
source venv/bin/activate
```

### 3. Siapkan File Konfigurasi

Proyek ini menggunakan file `.env` untuk mengelola variabel lingkungan seperti kredensial database. Salin file `.env.example` lalu hilangkan `.example` dibelakangnya, atau buat file baru bernama `.env` di dalam direktori `web-cuaca` dengan isi sebagai berikut:

```env
POSTGRES_USER=user
POSTGRES_PASSWORD=password
POSTGRES_DB=weather_db
DATABASE_URL="postgresql://user:password@localhost:5432/weather_db"
```

Ganti nilai untuk meningkatkan keamanan.

**Penting**: Jangan pernah memasukkan file `.env` ini ke dalam sistem kontrol versi (Git). File `.gitignore` sudah seharusnya dikonfigurasi untuk mengabaikannya.

### 4. Jalankan Database

Aplikasi ini memerlukan database PostGIS yang berjalan. Gunakan Docker Compose untuk menjalankannya dengan mudah.

```bash
docker-compose up -d
```
Perintah ini akan mengunduh image PostGIS (jika belum ada) dan menjalankan kontainer database di latar belakang. Data akan disimpan dalam volume Docker bernama `postgis_data` sehingga tidak akan hilang saat kontainer dimatikan.

*PENTING:* Tunggu sekitar 15-30 detik agar database siap.

### 5. Instal Dependensi Python

Instal semua pustaka Python yang diperlukan menggunakan file `requirements.txt`.

```bash
pip install -r requirements.txt
```

### 6. Migrasi Data Awal

Setelah database berjalan dan dependensi terinstal, jalankan skrip migrasi untuk mengisi database dengan data dari file GeoJSON dan CSV.

```bash
python migrate_data.py
```
Skrip ini akan membuat tabel-tabel yang diperlukan (`batas_provinsi`, `batas_kabupatenkota`, `batas_kecamatandistrik`, `wilayah_administratif`) dan mengisinya dengan data. Proses ini hanya perlu dilakukan sekali saat penyiapan awal.

**Penting**: Jika terjadi masalah pada langkah 4 atau 6, jalankan perintah berikut di root (web-cuaca).
```bash
docker-compose down -v
``` 
Ini akan mematikan kontainer dan menghapus volume yang berkaitan.

Kemudian ulangi langkah 4 dan 6.

### 7. Jalankan Aplikasi Web

Terakhir, jalankan server aplikasi Flask.

*PASTIKAN BAHWA KONTAINER DOCKER BERJALAN DI BELAKANG LAYAR!*

```bash
python app.py
```

Server akan berjalan, dan Anda dapat mengakses aplikasi di browser Anda. Biasanya, aplikasi akan tersedia di `https://localhost:5000` (jika sertifikat SSL ditemukan) atau `http://localhost:5000`.

### 8. Tindakan Pos-Migrasi

Jika ingin mematikan server PostgreSQL, jalankan:
```bash
docker-compose down
```

Jika ingin menyalakannya lagi, jalankan:
```bash
docker-compose up
```

Sewaktu-waktu file GeoJSON dan CSV akan diedit, jalankan `python migrate_data.py` untuk mengimpor data baru ke database. Ini akan menimpa tabel yang ada di dalam database dengan yang baru.

Pastikan container docker sedang berjalan sebelum melakukan update.

## Struktur Proyek

```
web-cuaca/
│
├── app.py                  # Backend utama (Flask)
├── migrate_data.py         # Skrip untuk migrasi data ke PostGIS
├── docker-compose.yml      # Konfigurasi untuk layanan database Docker
├── .env                    # File konfigurasi (lokal, tidak di-commit)
├── requirements.txt        # Dependensi Python
│
├── static/
│   ├── js/
│   │   └── map.js          # Logika frontend utama (MapLibre GL JS)
│   └── styles/
│       └── styles.css      # Styling untuk halaman
│
├── templates/
│   └── index.html          # Halaman HTML utama
│
├── *.geojson               # Data geospasial sumber (sebelum migrasi)
├── *.csv                   # Data administratif sumber (sebelum migrasi)
└── *.mbtiles               # Data vector tiles untuk peta dasar
```

#### Lainnya
Proyek ini dibuat untuk memenuhi penugasan mata kuliah.
Anggota:
- Dzaky
- Lukman
- Salman