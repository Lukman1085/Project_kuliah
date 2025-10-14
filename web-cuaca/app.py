import os
import sys
import sqlite3
from flask import Flask, Response, render_template, request, jsonify
from flask_cors import CORS
import geopandas as gpd
from shapely.geometry import box
import time
import random # Untuk simulasi data cuaca
import pandas as pd

# Latitude: y(point_on_surface($geometry))
# Longitude: x(point_on_surface($geometry))
# tippecanoe -o peta_indonesia.mbtiles --force   --named-layer='{"name": "batas_provinsi", "file": "batas_provinsi.geojson", "minzoom": 5, "maxzoom": 7}'   --named-layer='{"name": "batas_kabupatenkota", "file": "batas_kabupatenkota.geojson", "minzoom": 8, "maxzoom": 10}'   --named-layer='{"name": "batas_kecamatandistrik", "file": "batas_kecamatandistrik.geojson", "minzoom": 11, "maxzoom": 14}'

# tippecanoe -o peta_indonesia.mbtiles -f -z14 -Z5 --simplification=5 --detect-shared-borders    --named-layer='{"name": "batas_provinsi", "file": "batas_provinsi.geojson", "minzoom": 5, "maxzoom": 8}'    --named-layer='{"name": "batas_kabupatenkota", "file": "batas_kabupatenkota.geojson", "minzoom": 8, "maxzoom": 11}'    --named-layer='{"name": "batas_kecamatandistrik", "file": "batas_kecamatandistrik.geojson", "minzoom": 11, "maxzoom": 14}'

# Inisialisasi Flask
app = Flask(__name__)
CORS(app) # Aktifkan CORS untuk semua rute

# Dapatkan path absolut ke file MBTiles
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Koneksi ke file MBTiles
MBTILES_FILE = os.path.join(BASE_DIR, 'peta_indonesia.mbtiles')

# ================== BAGIAN API PENGAMBIL DATA CUACA ==================

# --- 1. Muat data GeoJSON ke memori saat server dimulai ---
print("Memuat data geospasial untuk API...")
# Gunakan file GeoJSON yang sudah bersih (hanya atribut penting)
# Pastikan path filenya benar
provinsi_gdf = gpd.read_file(os.path.join(BASE_DIR, "batas_provinsi.geojson")).to_crs(epsg=4326)
kabupaten_gdf = gpd.read_file(os.path.join(BASE_DIR, "batas_kabupatenkota.geojson")).to_crs(epsg=4326)
kecamatan_gdf = gpd.read_file(os.path.join(BASE_DIR, "batas_kecamatandistrik.geojson")).to_crs(epsg=4326)
print("Data geospasial berhasil dimuat.")

# --- 2. Siapkan Cache Sederhana ---
WEATHER_CACHE = {}
CACHE_TTL = 1800  # Waktu kedaluwarsa cache: 15 menit (dalam detik)

# ENDPOINT KHUSUS UNTUK DATA PROVINSI
@app.route('/api/provinsi-info')
def get_provinsi_info():
    """Mengirimkan informasi dasar untuk semua provinsi."""
    try:
        provinsi_info = []
        # GANTI 'KDPPUM' dengan nama kolom ID unik provinsi Anda
        # GANTI 'WADMPR' dengan nama kolom nama provinsi Anda
        id_column = 'KDPPUM'
        name_column = 'WADMPR'

        # Pastikan data tidak ada yang null
        clean_provinsi_gdf = provinsi_gdf.dropna(subset=[id_column, name_column, 'latitude', 'longitude'])

        for index, row in clean_provinsi_gdf.iterrows():
            provinsi_info.append({
                "id": row[id_column],
                "nama": row[name_column],
                "lat": row['latitude'],
                "lon": row['longitude']
            })
        return jsonify(provinsi_info)
    except Exception as e:
        print(f"Error in /api/provinsi-info: {e}")
        return jsonify({"error": "Internal server error"}), 500

# --- 3. Endpoint API Cerdas yang Baru ---
@app.route('/api/data-cuaca')
def get_data_cuaca():
    try:
        bbox_str = request.args.get('bbox')
        zoom = int(request.args.get('zoom', 9))  # Default zoom 9 jika tidak diberikan

        if not bbox_str:
            return jsonify({"error": "bbox parameter is required"}), 400

        xmin, ymin, xmax, ymax = [float(coord) for coord in bbox_str.split(',')]
        bbox_polygon = box(xmin, ymin, xmax, ymax)

        target_gdf = None
        id_column = None
        name_column = None

        # Tentukan data mana yang akan dicari berdasarkan zoom
        if 8 <= zoom <= 10:
            target_gdf = kabupaten_gdf
            # GANTI 'KDPKAB' DENGAN NAMA KOLOM ID UNIK KABUPATEN ANDA
            id_column = 'KDPKAB'
            name_column = 'WADMKK' 
        elif 11 <= zoom <= 14:
            target_gdf = kecamatan_gdf
            # GANTI 'WADMKC' DENGAN NAMA KOLOM ID UNIK KECAMATAN ANDA
            id_column = 'KDCPUM'
            name_column = 'WADMKC'
        else:
            # Tidak mengambil data cuaca untuk level provinsi
            return jsonify({})

        # Query spasial untuk menemukan poligon yang beririsan dengan Bbox
        poligon_terlihat = target_gdf[target_gdf.intersects(bbox_polygon)]

        # Pastikan tidak ada nilai NaN pada kolom ID
        poligon_terlihat = poligon_terlihat.dropna(subset=[id_column])
        
        # Ambil data centroid (titik tengah) untuk menempatkan marker
        # dan ID unik untuk setiap poligon yang terlihat
        wilayah_info = []
        for index, row in poligon_terlihat.iterrows():
            wilayah_info.append({
                "id": row[id_column],
                "nama": row[name_column],
                "lat": row['latitude'],
                "lon": row['longitude']
            })

        # --- Logika Caching ---
        final_data = {}
        ids_to_fetch = []
        current_time = time.time()

        for info in wilayah_info:
            wilayah_id = info["id"]
            if wilayah_id in WEATHER_CACHE and (current_time - WEATHER_CACHE[wilayah_id]['timestamp'] < CACHE_TTL):
                final_data[wilayah_id] = WEATHER_CACHE[wilayah_id]['data']
                # Tambahkan koordinat karena kita butuh di frontend
                final_data[wilayah_id]['nama'] = info['nama']
                final_data[wilayah_id]['lat'] = info['lat']
                final_data[wilayah_id]['lon'] = info['lon']
            else:
                ids_to_fetch.append(info)
        
        if ids_to_fetch:
            # Panggil API eksternal HANYA untuk ID yang tidak ada di cache
            new_weather_data = call_external_weather_api(ids_to_fetch)
            for wilayah_id, data in new_weather_data.items():
                WEATHER_CACHE[wilayah_id] = {"data": data, "timestamp": current_time}
                final_data[wilayah_id] = data
        
        return jsonify(final_data)

    except Exception as e:
        print(f"Error in /api/data-cuaca: {e}")
        return jsonify({"error": "Internal server error"}), 500
    
# ENDPOINT UNTUK KLIK KLASTER
@app.route('/api/data-by-ids')
def get_data_by_ids():
    """Mengambil data cuaca berdasarkan daftar ID spesifik."""
    try:
        ids_str = request.args.get('ids')
        if not ids_str:
            return jsonify({"error": "ids parameter is required"}), 400

        list_of_ids = ids_str.split(',')
        
        # Gabungkan data kabupaten dan kecamatan untuk pencarian ID yang efisien
        # Kita rename kolom ID agar seragam untuk sementara
        kab_renamed = kabupaten_gdf.rename(columns={'KDPKAB': 'id', 'WADMKK': 'nama'})
        kec_renamed = kecamatan_gdf.rename(columns={'KDCPUM': 'id', 'WADMKC': 'nama'})
        all_gdf = pd.concat([
            kab_renamed[['id', 'nama', 'latitude', 'longitude']],
            kec_renamed[['id', 'nama', 'latitude', 'longitude']]
        ])
        
        # Cari semua baris yang ID-nya ada di dalam daftar yang diminta
        relevant_rows = all_gdf[all_gdf['id'].isin(list_of_ids)]

        # --- Logika Caching dan Panggilan API (Sama seperti sebelumnya) ---
        final_data = {}
        ids_to_fetch_info = []
        current_time = time.time()
        
        for index, row in relevant_rows.iterrows():
            wilayah_id = row['id']
            if wilayah_id in WEATHER_CACHE and (current_time - WEATHER_CACHE[wilayah_id]['timestamp'] < CACHE_TTL):
                # Data ada di cache dan masih valid
                final_data[wilayah_id] = WEATHER_CACHE[wilayah_id]['data']
                final_data[wilayah_id]['nama'] = row['nama']
                final_data[wilayah_id]['lat'] = row['latitude']
                final_data[wilayah_id]['lon'] = row['longitude']
            else:
                ids_to_fetch_info.append({
                    "id": wilayah_id, "nama": row['nama'],
                    "lat": row['latitude'], "lon": row['longitude']
                })

        if ids_to_fetch_info:
            new_weather_data = call_external_weather_api(ids_to_fetch_info)
            for wilayah_id, data in new_weather_data.items():
                WEATHER_CACHE[wilayah_id] = {"data": data, "timestamp": current_time}
                final_data[wilayah_id] = data
        
        return jsonify(final_data)

    except Exception as e:
        print(f"Error in /api/data-by-ids: {e}")
        return jsonify({"error": "Internal server error"}), 500

def call_external_weather_api(wilayah_infos):
    # FUNGSI SIMULASI: Ganti ini dengan panggilan ke API cuaca asli Anda
    mock_data = {}
    for info in wilayah_infos:
        suhu = random.randint(25, 32)
        kelembapan = random.randint(60, 90)
        mock_data[info['id']] = {
            "suhu": suhu,
            "cuaca": "Cerah" if suhu > 28 else "Berawan",
            "nama": info['nama'],
            "lat": info['lat'],
            "lon": info['lon'],
            "kelembapan": kelembapan,
            "terasa": suhu - (kelembapan / 100) * (suhu - 14.5)  # Perhitungan sederhana
        }
    return mock_data

# ================== AKHIR API PENGAMBIL DATA CUACA ==================

# Pemeriksaan penting! Cek apakah file mbtiles benar-benar ada sebelum menjalankan server
# if not os.path.exists(MBTILES_FILE):
#     print(f"FATAL ERROR: File MBTiles tidak ditemukan.")
#     print(f"Mencari di path: {MBTILES_FILE}")
#     print("Pastikan nama file sudah benar dan berada di folder yang sama dengan app.py")
#     sys.exit(1)

#Halaman Utama
@app.route('/')
def index():
  """Render halaman utama."""
  return render_template('index.html')

@app.route('/tiles/<int:z>/<int:x>/<int:y>.pbf')
def get_tile(z, x, y):
    """"Mengambil dan menyajikan satu vector tile dari file MBTiles."""
    db = None
    try:
        # MBTiles pada dasarnya adalah database SQLite
        db = sqlite3.connect(f'file:{MBTILES_FILE}?mode=ro', uri=True)
        cursor = db.cursor()

        # Sistem koordinat Y pada tile (TMS) adalah kebalikan dari yang biasa digunakan
        # Jadi kita perlu membaliknya
        y_flipped = (2 ** z - 1) - y

        # Query untuk mengambil data tile (formatnya adalah blob Gzipped PBF)
        query = 'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?'
        cursor.execute(query, (z, x, y_flipped))
        tile_data = cursor.fetchone()

        if tile_data:
            # Jika tile ditemukan, kirim sebagai respons
            # Header ini penting agar browser tahu ini adalah vector tile
            headers = {
                'Content-Type': 'application/x-protobuf',
                'Content-Encoding': 'gzip',
                'Access-Control-Allow-Origin': '*'
            }
            return Response(tile_data[0], headers=headers)
        else:
            # Jika tile tidak ditemukan untuk koordinat tersebut, kirim 404
            return Response('Tile not found', status=404)
    except sqlite3.Error as e:
        print(f"Database error: {e}")
        return Response('Internal server error', status=500)
    finally:
        if db:
            db.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
    # app.run(debug=True)