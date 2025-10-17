import os
from flask import Flask, Response, render_template, request, jsonify
from flask_cors import CORS
from flask_compress import Compress
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from geoalchemy2 import Geometry
from shapely.geometry import box
import time
import random
from dotenv import load_dotenv
import sqlite3

# Muat environment variables dari .env file
load_dotenv()

# Inisialisasi Flask
app = Flask(__name__)
CORS(app)
Compress(app)

# Dapatkan URL database dari environment variables
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL tidak ditemukan di environment variables.")

# Setup koneksi database
engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)

# Path ke file MBTiles tetap sama
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MBTILES_FILE = os.path.join(BASE_DIR, 'peta_indonesia.mbtiles')

# ================== BAGIAN API PENGAMBIL DATA CUACA ==================

# Siapkan Cache Sederhana
WEATHER_CACHE = {}
CACHE_TTL = 1800  # 30 menit

@app.route('/api/provinsi-info')
def get_provinsi_info():
    """Mengirimkan informasi dasar untuk semua provinsi dari database."""
    session = Session()
    try:
        # Query langsung ke tabel batas_provinsi
        # Pastikan nama kolom (KDPPUM, WADMPR, latitude, longitude) sesuai dengan yang ada di database
        query = text("""
            SELECT "KDPPUM" as id, "WADMPR" as nama, latitude as lat, longitude as lon
            FROM batas_provinsi
            WHERE "KDPPUM" IS NOT NULL AND "WADMPR" IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;
        """)
        result = session.execute(query)
        provinsi_info = [dict(row) for row in result.mappings()]
        return jsonify(provinsi_info)
    except Exception as e:
        print(f"Error in /api/provinsi-info: {e}")
        return jsonify({"error": "Internal server error"}), 500
    finally:
        session.close()

@app.route('/api/data-cuaca')
def get_data_cuaca():
    """Mengambil data cuaca berdasarkan bounding box dan zoom level dari PostGIS."""
    session = Session()
    try:
        bbox_str = request.args.get('bbox')
        zoom = int(request.args.get('zoom', 9))

        if not bbox_str:
            return jsonify({"error": "bbox parameter is required"}), 400

        xmin, ymin, xmax, ymax = [float(coord) for coord in bbox_str.split(',')]
        
        # Membuat poligon dari bbox dengan SRID 4326 (WGS 84)
        bbox_wkt = f'SRID=4326;POLYGON(({xmin} {ymin}, {xmax} {ymin}, {xmax} {ymax}, {xmin} {ymax}, {xmin} {ymin}))'

        table_name = None
        id_column = None
        name_column = None

        if 8 <= zoom <= 10:
            table_name = "batas_kabupatenkota"
            id_column = "KDPKAB"
            name_column = "WADMKK"
        elif 11 <= zoom <= 14:
            table_name = "batas_kecamatandistrik"
            id_column = "KDCPUM"
            name_column = "WADMKC"
        else:
            return jsonify({})

        # Query spasial menggunakan ST_Intersects
        query = text(f"""
            SELECT "{id_column}" as id, "{name_column}" as nama, latitude as lat, longitude as lon
            FROM {table_name}
            WHERE ST_Intersects(geometry, ST_GeomFromEWKT(:bbox_wkt))
            AND "{id_column}" IS NOT NULL;
        """)
        
        result = session.execute(query, {"bbox_wkt": bbox_wkt})
        wilayah_info = [dict(row) for row in result.mappings()]

        # --- Logika Caching (tetap sama) ---
        final_data = {}
        ids_to_fetch = []
        current_time = time.time()

        for info in wilayah_info:
            wilayah_id = info["id"]
            if wilayah_id in WEATHER_CACHE and (current_time - WEATHER_CACHE[wilayah_id]['timestamp'] < CACHE_TTL):
                final_data[wilayah_id] = WEATHER_CACHE[wilayah_id]['data']
                # Selalu tambahkan info geo dari query, karena cache hanya simpan data cuaca
                final_data[wilayah_id]['nama'] = info['nama']
                final_data[wilayah_id]['lat'] = info['lat']
                final_data[wilayah_id]['lon'] = info['lon']
            else:
                ids_to_fetch.append(info)
        
        if ids_to_fetch:
            new_weather_data = call_external_weather_api(ids_to_fetch)
            for wilayah_id, data in new_weather_data.items():
                WEATHER_CACHE[wilayah_id] = {"data": data, "timestamp": current_time}
                final_data[wilayah_id] = data
        
        return jsonify(final_data)

    except Exception as e:
        print(f"Error in /api/data-cuaca: {e}")
        return jsonify({"error": "Internal server error"}), 500
    finally:
        session.close()

@app.route('/api/data-by-ids')
def get_data_by_ids():
    """Mengambil data cuaca berdasarkan daftar ID spesifik dari database."""
    session = Session()
    try:
        ids_str = request.args.get('ids')
        if not ids_str:
            return jsonify({"error": "ids parameter is required"}), 400

        list_of_ids = [f"'{id_}'" for id_ in ids_str.split(',')]
        ids_tuple_str = f"({','.join(list_of_ids)})"

        # Query untuk mencari di kedua tabel (kabupaten dan kecamatan)
        query = text(f"""
            SELECT id, nama, lat, lon FROM (
                SELECT "KDPKAB" as id, "WADMKK" as nama, latitude as lat, longitude as lon FROM batas_kabupatenkota
                WHERE "KDPKAB" IN {ids_tuple_str}
                UNION ALL
                SELECT "KDCPUM" as id, "WADMKC" as nama, latitude as lat, longitude as lon FROM batas_kecamatandistrik
                WHERE "KDCPUM" IN {ids_tuple_str}
            ) as combined_results;
        """)
        
        result = session.execute(query)
        relevant_rows = [dict(row) for row in result.mappings()]

        # --- Logika Caching dan Panggilan API (Sama seperti sebelumnya) ---
        final_data = {}
        ids_to_fetch_info = []
        current_time = time.time()
        
        for row in relevant_rows:
            wilayah_id = row['id']
            if wilayah_id in WEATHER_CACHE and (current_time - WEATHER_CACHE[wilayah_id]['timestamp'] < CACHE_TTL):
                final_data[wilayah_id] = WEATHER_CACHE[wilayah_id]['data']
                # Selalu tambahkan info geo dari query
                final_data[wilayah_id]['nama'] = row['nama']
                final_data[wilayah_id]['lat'] = row['lat']
                final_data[wilayah_id]['lon'] = row['lon']
            else:
                ids_to_fetch_info.append(row)

        if ids_to_fetch_info:
            new_weather_data = call_external_weather_api(ids_to_fetch_info)
            for wilayah_id, data in new_weather_data.items():
                WEATHER_CACHE[wilayah_id] = {"data": data, "timestamp": current_time}
                final_data[wilayah_id] = data
        
        return jsonify(final_data)

    except Exception as e:
        print(f"Error in /api/data-by-ids: {e}")
        return jsonify({"error": "Internal server error"}), 500
    finally:
        session.close()

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
    # Tentukan path ke file sertifikat
    cert_path = './localhost+3.pem'
    key_path = './localhost+3-key.pem'

    # Cek apakah kedua file sertifikat ada
    if os.path.exists(cert_path) and os.path.exists(key_path):
        # Jika ada, jalankan server dengan HTTPS (untuk development lokal)
        print("Menjalankan server dalam mode HTTPS...")
        context = (cert_path, key_path)
        app.run(host='0.0.0.0', port=5000, debug=False, ssl_context=context)
    else:
        # Jika tidak ada, jalankan server HTTP biasa (untuk lingkungan lain)
        print("Sertifikat SSL tidak ditemukan. Menjalankan server dalam mode HTTP...")
        app.run(host='0.0.0.0', port=5000, debug=False)