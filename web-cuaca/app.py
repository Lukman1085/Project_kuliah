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

load_dotenv()

app = Flask(__name__)
CORS(app)
Compress(app)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL tidak ditemukan di environment variables.")

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MBTILES_FILE = os.path.join(BASE_DIR, 'peta_indonesia.mbtiles')

WEATHER_CACHE = {}
CACHE_TTL = 1800  # 30 menit

# Variabel untuk memonitor panggilan API
API_CALL_TIMESTAMPS = []
LAST_API_CALL_COUNT = 0

# ================== FUNGSI API CUACA ==================

# --- Logika Pemetaan Ikon ---
# Kamus ini adalah "source of truth".
# Kunci adalah weather_code dari WMO.
# Nilainya adalah sebuah tuple: (deskripsi, kelas_ikon_siang, kelas_ikon_malam)
WMO_CODE_MAP = {
    0: ("Cerah", "wi-day-sunny", "wi-night-clear"),
    1: ("Sebagian Besar Cerah", "wi-day-sunny-overcast", "wi-night-alt-partly-cloudy"),
    2: ("Berawan Sebagian", "wi-day-cloudy", "wi-night-alt-cloudy"),
    3: ("Mendung", "wi-cloudy", "wi-cloudy"),
    45: ("Kabut", "wi-fog", "wi-fog"),
    48: ("Kabut Rime", "wi-fog", "wi-fog"),
    51: ("Gerimis Ringan", "wi-day-sprinkle", "wi-night-alt-sprinkle"),
    53: ("Gerimis Sedang", "wi-day-sprinkle", "wi-night-alt-sprinkle"),
    55: ("Gerimis Lebat", "wi-day-sprinkle", "wi-night-alt-sprinkle"),
    61: ("Hujan Ringan", "wi-day-rain", "wi-night-alt-rain"),
    63: ("Hujan Sedang", "wi-day-rain", "wi-night-alt-rain"),
    65: ("Hujan Lebat", "wi-day-rain", "wi-night-alt-rain"),
    71: ("Salju Ringan", "wi-day-snow", "wi-night-alt-snow"),
    73: ("Salju Sedang", "wi-day-snow", "wi-night-alt-snow"),
    75: ("Salju Lebat", "wi-day-snow", "wi-night-alt-snow"),
    80: ("Hujan Deras Ringan", "wi-day-showers", "wi-night-alt-showers"),
    81: ("Hujan Deras Sedang", "wi-day-showers", "wi-night-alt-showers"),
    82: ("Hujan Deras Lebat", "wi-day-showers", "wi-night-alt-showers"),
    95: ("Badai Petir", "wi-day-thunderstorm", "wi-night-alt-thunderstorm"),
    96: ("Badai Petir dengan Hujan Es", "wi-day-hail", "wi-night-alt-hail"),
    99: ("Badai Petir dengan Hujan Es Lebat", "wi-day-hail", "wi-night-alt-hail"),
}

def get_weather_info(weather_code, is_day):
    """
    Menerjemahkan weather_code dan is_day menjadi deskripsi dan kelas ikon.
    """
    # Default value jika kode tidak ditemukan
    default_info = ("Data Tidak Tersedia", "wi-na", "wi-na")
    
    info = WMO_CODE_MAP.get(weather_code, default_info)
    deskripsi = info[0]
    
    # is_day adalah 1 untuk siang, 0 untuk malam
    icon_class = info[1] if is_day == 1 else info[2]
    
    return deskripsi, f"wi {icon_class}" # Menambahkan prefix 'wi' yang dibutuhkan oleh library

def call_external_weather_api(wilayah_infos):
    """
    FUNGSI SIMULASI: Fungsi ini SEKARANG HANYA MENGEMBALIKAN DATA CUACA.
    Data geo (nama, lat, lon) tidak lagi disertakan di sini.
    """
    global LAST_API_CALL_COUNT, API_CALL_TIMESTAMPS

    call_count = len(wilayah_infos)
    LAST_API_CALL_COUNT = call_count
    
    if call_count > 0:
        API_CALL_TIMESTAMPS.append(time.time())
    
    print(f"Memanggil API eksternal untuk {call_count} wilayah.")

    mock_data = {}
    # Daftar kode WMO yang mungkin untuk simulasi
    possible_codes = list(WMO_CODE_MAP.keys())

    for info in wilayah_infos:
        suhu = random.uniform(25.0, 32.0)
        weather_code = random.choice(possible_codes) # Menghasilkan weather_code acak dari daftar yang valid
        kelembapan = random.randint(60, 90)
        siangmalam = random.randint(0, 1)  # 0 = malam, 1 = siang
        prob_presipitasi = random.randint(0, 20)
        kecepatan_angin_10m = random.uniform(0.5, 5.0)
        arah_angin_10m = random.randint(0, 360)

        # --- PEMETAAN CUACA KE IKON DI SINI ---
        deskripsi_cuaca, kelas_ikon = get_weather_info(weather_code, siangmalam)

        mock_data[info['id']] = {
            "waktu": int(time.time()), # timestamp saat data diambil (format ISO 8601)
            "cuaca": deskripsi_cuaca,
            "kelas_ikon": kelas_ikon,
            "suhu": suhu,
            "kelembapan": kelembapan,
            "terasa": suhu - ((100 - kelembapan) / 5),  # Perkiraan suhu terasa
            "siangmalam": siangmalam,
            "prob_presipitasi": prob_presipitasi,
            "kecepatan_angin_10m": kecepatan_angin_10m,
            "arah_angin_10m": arah_angin_10m
        }
    return mock_data

def process_wilayah_data(wilayah_list):
    """
    Ambil data dari cache atau API eksternal, dan gabungkan dengan info geo.
    wilayah_list: [{id, nama, lat, lon}, ...]
    """
    final_data = {}
    ids_to_fetch_info = []
    current_time = time.time()

    for info in wilayah_list:
        wilayah_id = info["id"]
        if wilayah_id in WEATHER_CACHE and (current_time - WEATHER_CACHE[wilayah_id]['timestamp'] < CACHE_TTL):
            weather_data = WEATHER_CACHE[wilayah_id]['data']
            final_data[wilayah_id] = {**info, **weather_data}
        else:
            ids_to_fetch_info.append(info)
    
    if ids_to_fetch_info:
        new_weather_data_map = call_external_weather_api(ids_to_fetch_info)
        for info in ids_to_fetch_info:
            wilayah_id = info['id']
            if wilayah_id in new_weather_data_map:
                weather_data = new_weather_data_map[wilayah_id]
                WEATHER_CACHE[wilayah_id] = {"data": weather_data, "timestamp": current_time}
                final_data[wilayah_id] = {**info, **weather_data}

    return final_data


@app.route('/api/provinsi-info')
def get_provinsi_info():
    session = Session()
    try:
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
    session = Session()
    try:
        bbox_str = request.args.get('bbox')
        zoom = int(float(request.args.get('zoom', 9)))
        only_geo = str(request.args.get('only_geo', '0')).lower() in ('1', 'true', 'yes')

        if not bbox_str:
            return jsonify({"error": "bbox parameter is required"}), 400

        xmin, ymin, xmax, ymax = [float(coord) for coord in bbox_str.split(',')]
        bbox_wkt = f'SRID=4326;POLYGON(({xmin} {ymin}, {xmax} {ymin}, {xmax} {ymax}, {xmin} {ymax}, {xmin} {ymin}))'

        if 8 <= zoom <= 10:
            table_name, id_column, name_column = "batas_kabupatenkota", "KDPKAB", "WADMKK"
        elif 11 <= zoom <= 14:
            table_name, id_column, name_column = "batas_kecamatandistrik", "KDCPUM", "WADMKC"
        else:
            # Di zoom <= 7.99 kita memang tidak menampilkan marker cuaca
            return jsonify([]) if only_geo else jsonify({})

        query = text(f"""
            SELECT "{id_column}" as id, "{name_column}" as nama, latitude as lat, longitude as lon
            FROM {table_name}
            WHERE ST_Intersects(geometry, ST_GeomFromEWKT(:bbox_wkt)) AND "{id_column}" IS NOT NULL;
        """)
        
        result = session.execute(query, {"bbox_wkt": bbox_wkt})
        wilayah_info = [dict(row) for row in result.mappings()]

        print(f"Ditemukan {len(wilayah_info)} wilayah di BBOX ini.")
        if wilayah_info:
            print("Contoh data pertama:", wilayah_info[0])

        if only_geo:
            # Kembalikan data GEO SAJA: array of {id, nama, lat, lon}
            return jsonify(wilayah_info)

        # Default (backward compat) masih mengembalikan data lengkap (geo + cuaca)
        final_data = process_wilayah_data(wilayah_info)
        return jsonify(final_data)

    except Exception as e:
        print(f"Error in /api/data-cuaca: {e}")
        return jsonify({"error": "Internal server error"}), 500
    finally:
        session.close()

@app.route('/api/data-by-ids')
def get_data_by_ids():
    session = Session()
    try:
        ids_str = request.args.get('ids')
        if not ids_str:
            return jsonify({"error": "ids parameter is required"}), 400

        list_of_ids = [f"'{id_}'" for id_ in ids_str.split(',')]
        ids_tuple_str = f"({','.join(list_of_ids)})"

        query = text(f"""
            SELECT id, nama, lat, lon FROM (
                SELECT "KDPKAB" as id, "WADMKK" as nama, latitude as lat, longitude as lon FROM batas_kabupatenkota WHERE "KDPKAB" IN {ids_tuple_str}
                UNION ALL
                SELECT "KDCPUM" as id, "WADMKC" as nama, latitude as lat, longitude as lon FROM batas_kecamatandistrik WHERE "KDCPUM" IN {ids_tuple_str}
            ) as combined_results;
        """)
        
        result = session.execute(query)
        relevant_rows = [dict(row) for row in result.mappings()]

        final_data = process_wilayah_data(relevant_rows)
        
        return jsonify(final_data)

    except Exception as e:
        print(f"Error in /api/data-by-ids: {e}")
        return jsonify({"error": "Internal server error"}), 500
    finally:
        session.close()

@app.route('/api/monitoring-stats')
def get_monitoring_stats():
    global API_CALL_TIMESTAMPS
    
    current_time = time.time()
    API_CALL_TIMESTAMPS = [t for t in API_CALL_TIMESTAMPS if current_time - t <= 60]
    calls_per_minute = len(API_CALL_TIMESTAMPS)
    calls_per_function = LAST_API_CALL_COUNT
    
    return jsonify({
        "panggilan_eksternal_per_menit": calls_per_minute,
        "panggilan_eksternal_per_fungsi_terakhir": calls_per_function
    })

@app.route('/')
def index():
  return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return '', 204

@app.route('/tiles/<int:z>/<int:x>/<int:y>.pbf')
def get_tile(z, x, y):
    db = None
    try:
        db = sqlite3.connect(f'file:{MBTILES_FILE}?mode=ro', uri=True)
        cursor = db.cursor()
        y_flipped = (2 ** z - 1) - y
        query = 'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?'
        cursor.execute(query, (z, x, y_flipped))
        tile_data = cursor.fetchone()
        if tile_data:
            headers = {
                'Content-Type': 'application/x-protobuf',
                'Content-Encoding': 'gzip',
                'Access-Control-Allow-Origin': '*'
            }
            return Response(tile_data[0], headers=headers)
        else:
            return Response('Tile not found', status=404)
    except sqlite3.Error as e:
        print(f"Database error: {e}")
        return Response('Internal server error', status=500)
    finally:
        if db:
            db.close()

if __name__ == '__main__':
    cert_path = './localhost+3.pem'
    key_path = './localhost+3-key.pem'
    if os.path.exists(cert_path) and os.path.exists(key_path):
        print("Menjalankan server dalam mode HTTPS...")
        context = (cert_path, key_path)
        app.run(host='0.0.0.0', port=5000, debug=False, ssl_context=context)
    else:
        print("Sertifikat SSL tidak ditemukan. Menjalankan server dalam mode HTTP...")
        app.run(host='0.0.0.0', port=5000, debug=False)
