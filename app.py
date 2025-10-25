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
import requests
from datetime import datetime, timedelta, timezone as dt_timezone
from pytz import timezone as pytz_timezone
import re  # <-- TAMBAHAN: Untuk validasi

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
MBTILES_FILE = os.path.join(BASE_DIR, 'static', 'peta_indonesia.mbtiles')

WEATHER_CACHE = {}
CACHE_TTL = 1800  # 30 menit

API_CALL_TIMESTAMPS = []
LAST_API_CALL_COUNT = 0

USE_REAL_API = True # Tetap False untuk pengujian

# Pola regex untuk validasi ID
# Memperbolehkan angka, huruf, dan underscore. Sesuaikan jika perlu.
ID_REGEX = re.compile(r"^[a-zA-Z0-9_.-]+$")

# ================== FUNGSI API CUACA (VERSI BARU) ==================

# Kamus ini akan dikirim ke frontend via endpoint baru
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
# Fungsi get_weather_info(code, is_day) dihapus dari sini,
# karena logikanya dipindah ke frontend.

def generate_dummy_api_response(wilayah_infos):
    """
    Menghasilkan data dummy (14 hari) untuk multi-lokasi.
    [VERSI PERBAIKAN]
    """
    print(f"MODE DUMMY: Menghasilkan data untuk {len(wilayah_infos)} lokasi.")
    dummy_list = []
    total_hourly_points = 336  # 14 hari * 24 jam
    total_daily_points = 14     # 14 hari
    possible_codes = list(WMO_CODE_MAP.keys())

    # --- PERBAIKAN: Meniru format timestamp OpenMeteo ---

    # 1. Tentukan timezone dummy (harus konsisten dengan data di bawah)
    dummy_tz_str = 'Asia/Singapore'
    dummy_tz = pytz_timezone(dummy_tz_str)
    
    # 2. Dapatkan 'sekarang' di timezone itu
    now_in_tz = datetime.now(dummy_tz)
    
    # 3. Dapatkan tanggal 7 hari lalu (hanya tanggal)
    start_date_in_tz = (now_in_tz - timedelta(days=7)).date()
    
    # 4. Buat datetime jam 00:00 pada tanggal itu (ini adalah start_datetime lokal)
    #    Kita buat sebagai datetime "naive" (tanpa info TZ)
    start_datetime_local = datetime(
        start_date_in_tz.year, 
        start_date_in_tz.month, 
        start_date_in_tz.day, 
        0, 0, 0
    )

    # 5. Buat daftar string waktu LOKAL (tanpa offset)
    #    Formatnya YYYY-MM-DDTHH:MM, persis seperti yang diharapkan frontend
    dummy_hourly_times = [
        (start_datetime_local + timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M') 
        for i in range(total_hourly_points)
    ]
    
    # 6. Buat daftar string tanggal (format YYYY-MM-DD)
    dummy_daily_times = [
        (start_date_in_tz + timedelta(days=i)).isoformat() 
        for i in range(total_daily_points)
    ]
    # --- AKHIR PERBAIKAN ---

    for info in wilayah_infos:
        hourly_data = {
            'time': dummy_hourly_times, # <-- Sekarang formatnya sudah benar
            'temperature_2m': [round(random.uniform(25.0, 32.0), 1) for _ in range(total_hourly_points)],
            'relative_humidity_2m': [random.randint(60, 90) for _ in range(total_hourly_points)],
            'apparent_temperature': [round(random.uniform(28.0, 35.0), 1) for _ in range(total_hourly_points)],
            'is_day': [random.randint(0, 1) for _ in range(total_hourly_points)],
            'precipitation_probability': [random.randint(0, 20) for _ in range(total_hourly_points)],
            'weather_code': [random.choice(possible_codes) for _ in range(total_hourly_points)],
            'wind_speed_10m': [round(random.uniform(0.5, 5.0), 1) for _ in range(total_hourly_points)],
            'wind_direction_10m': [random.randint(0, 360) for _ in range(total_hourly_points)]
        }
        daily_data = {
            'time': dummy_daily_times, # <-- Format ini sudah benar
            'weather_code': [random.choice(possible_codes) for _ in range(total_daily_points)],
            'temperature_2m_max': [round(random.uniform(30.0, 34.0), 1) for _ in range(total_daily_points)],
            'temperature_2m_min': [round(random.uniform(23.0, 26.0), 1) for _ in range(total_daily_points)]
        }
        
        # [PERBAIKAN KONSISTENSI]
        # Pastikan offset dan singkatan TZ sesuai dengan string waktu yang dibuat
        localized_start = dummy_tz.localize(start_datetime_local)
        localizeds = localized_start.utcoffset()
        if localizeds:
            dummy_offset_seconds = int(localizeds.total_seconds())
        dummy_tz_abbrev = localized_start.strftime('%Z') # Cth: SGT

        location_dummy = {
            'latitude': info['lat'], 'longitude': info['lon'], 'generationtime_ms': random.uniform(0.5, 2.0),
            'utc_offset_seconds': dummy_offset_seconds,      # <-- Konsisten
            'timezone': dummy_tz_str,                   # <-- Konsisten
            'timezone_abbreviation': dummy_tz_abbrev,   # <-- Konsisten
            'elevation': random.uniform(5, 50),
            'hourly_units': {}, 'hourly': hourly_data,
            'daily_units': {}, 'daily': daily_data
        }
        dummy_list.append(location_dummy)
    return dummy_list

def call_open_meteo_api(wilayah_infos):
    """
    Memanggil API OpenMeteo asli (meminta data hourly dan daily).
    """
    global LAST_API_CALL_COUNT, API_CALL_TIMESTAMPS
    if not wilayah_infos:
        return None

    base_url = "https://api.open-meteo.com/v1/forecast"
    latitudes = [str(info['lat']) for info in wilayah_infos]
    longitudes = [str(info['lon']) for info in wilayah_infos]

    params = {
        "latitude": ",".join(latitudes), "longitude": ",".join(longitudes),
        "hourly": "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min", # <-- TAMBAHAN: Minta data harian
        "timezone": "auto", "forecast_days": 7, "past_days": 7
    }

    call_count = len(wilayah_infos)
    LAST_API_CALL_COUNT = call_count
    API_CALL_TIMESTAMPS.append(time.time())
    print(f"MODE API ASLI: Memanggil OpenMeto untuk {call_count} lokasi.")
    
    try:
        response = requests.get(base_url, params=params, timeout=15)
        response.raise_for_status()
        api_data = response.json()
        if isinstance(api_data, dict):
            return [api_data]
        return api_data
    except requests.exceptions.HTTPError as http_err:
        print(f"HTTP error terjadi: {http_err} - {response.text}")
    except requests.exceptions.RequestException as req_err:
        print(f"Error koneksi atau request: {req_err}")
    except ValueError as json_err:
        print(f"Gagal mem-parsing JSON: {json_err}")
    return None

def process_api_response(api_data_list, wilayah_infos):
    """
    PERUBAHAN BESAR: Fungsi ini sekarang hanya mengemas data 14 hari (hourly+daily)
    ke dalam dict per wilayah_id. Tidak ada lagi pemilihan 'current_index'.
    """
    processed_data = {}
    for original_info, location_data in zip(wilayah_infos, api_data_list):
        wilayah_id = original_info['id']
        
        # Kirim semua data yang relevan
        processed_data[wilayah_id] = {
            "latitude": location_data.get('latitude'),
            "longitude": location_data.get('longitude'),
            "timezone": location_data.get('timezone'),
            "timezone_abbreviation": location_data.get('timezone_abbreviation'),
            "utc_offset_seconds": location_data.get('utc_offset_seconds'),
            "hourly": location_data.get('hourly', {}),
            "daily": location_data.get('daily', {})
        }
    return processed_data

def get_weather_data_for_locations(wilayah_infos):
    """
    Fungsi "gatekeeper" (Tidak berubah, tapi data yang dikembalikan berbeda).
    """
    if not wilayah_infos:
        return {}
    
    api_data_list = call_open_meteo_api(wilayah_infos) if USE_REAL_API else generate_dummy_api_response(wilayah_infos)
    
    if api_data_list is None:
        return {}
        
    return process_api_response(api_data_list, wilayah_infos)

# ================== FUNGSI PROSES DATA UTAMA ==================

def process_wilayah_data(wilayah_list):
    """
    PERUBAHAN: Cache sekarang menyimpan data 14 hari penuh, bukan data 1 indeks.
    """
    final_data = {}
    ids_to_fetch_info = []
    current_time = time.time()

    for info in wilayah_list:
        wilayah_id = info["id"]
        if wilayah_id in WEATHER_CACHE and (current_time - WEATHER_CACHE[wilayah_id]['timestamp'] < CACHE_TTL):
            weather_data = WEATHER_CACHE[wilayah_id]['data']
            # Gabungkan info geo (lat, lon, nama) dengan data cuaca lengkap
            final_data[wilayah_id] = {**info, **weather_data}
        else:
            ids_to_fetch_info.append(info)
    
    if ids_to_fetch_info:
        # Panggil gatekeeper, yang sekarang mengembalikan data 14 hari penuh
        new_weather_data_map = get_weather_data_for_locations(ids_to_fetch_info)
        
        for info in ids_to_fetch_info:
            wilayah_id = info['id']
            if wilayah_id in new_weather_data_map:
                weather_data = new_weather_data_map[wilayah_id] # Ini adalah data 14 hari
                WEATHER_CACHE[wilayah_id] = {"data": weather_data, "timestamp": current_time}
                # Gabungkan info geo (lat, lon, nama) dengan data cuaca lengkap
                final_data[wilayah_id] = {**info, **weather_data}

    return final_data

# ================== ROUTES ==================

# --- ENDPOINT AMBIL IKON CUACA ---
@app.route('/api/wmo-codes')
def get_wmo_codes():
    """
    Endpoint baru untuk mengirim peta WMO ke frontend.
    """
    return jsonify(WMO_CODE_MAP)

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
        # Parameter 'only_geo' sekarang jadi default behavior
        # only_geo = str(request.args.get('only_geo', '0')).lower() in ('1', 'true', 'yes')

        if not bbox_str:
            return jsonify({"error": "bbox parameter is required"}), 400

        xmin, ymin, xmax, ymax = [float(coord) for coord in bbox_str.split(',')]
        
        # Validasi BBOX sederhana
        if not all(isinstance(c, (int, float)) for c in [xmin, ymin, xmax, ymax]):
             return jsonify({"error": "Invalid bbox coordinates"}), 400
        
        bbox_wkt = f'SRID=4326;POLYGON(({xmin} {ymin}, {xmax} {ymin}, {xmax} {ymax}, {xmin} {ymax}, {xmin} {ymin}))'

        if 8 <= zoom <= 10:
            table_name, id_column, name_column = "batas_kabupatenkota", "KDPKAB", "WADMKK"
        elif 11 <= zoom <= 14:
            table_name, id_column, name_column = "batas_kecamatandistrik", "KDCPUM", "WADMKC"
        else:
            return jsonify([]) # Kembalikan array kosong

        query = text(f"""
            SELECT "{id_column}" as id, "{name_column}" as nama, latitude as lat, longitude as lon
            FROM {table_name}
            WHERE ST_Intersects(geometry, ST_GeomFromEWKT(:bbox_wkt)) AND "{id_column}" IS NOT NULL;
        """)
        
        result = session.execute(query, {"bbox_wkt": bbox_wkt})
        wilayah_info = [dict(row) for row in result.mappings()]

        print(f"Ditemukan {len(wilayah_info)} wilayah di BBOX ini.")
        # if wilayah_info:
        #     print("Contoh data pertama:", wilayah_info)
        # PERUBAHAN: Endpoint ini SEKARANG HANYA mengembalikan data geo.
        # Data cuaca akan diambil secara terpisah oleh /api/data-by-ids saat di-klik.
        return jsonify(wilayah_info)

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

        # --- TAMBAHAN: Validasi Keamanan ---
        list_of_ids_raw = ids_str.split(',')
        list_of_ids_validated = []
        for id_ in list_of_ids_raw:
            if ID_REGEX.match(id_):
                list_of_ids_validated.append(f"'{id_}'")
            else:
                print(f"PERINGATAN: ID tidak valid terdeteksi dan diabaikan: {id_}")
        
        if not list_of_ids_validated:
             return jsonify({"error": "No valid IDs provided"}), 400

        ids_tuple_str = f"({','.join(list_of_ids_validated)})"
        # --- Akhir Validasi ---

        query = text(f"""
            SELECT id, nama, lat, lon FROM (
                SELECT "KDPKAB" as id, "WADMKK" as nama, latitude as lat, longitude as lon FROM batas_kabupatenkota WHERE "KDPKAB" IN {ids_tuple_str}
                UNION ALL
                SELECT "KDCPUM" as id, "WADMKC" as nama, latitude as lat, longitude as lon FROM batas_kecamatandistrik WHERE "KDCPUM" IN {ids_tuple_str}
            ) as combined_results;
        """)
        
        result = session.execute(query)
        relevant_rows = [dict(row) for row in result.mappings()]

        # PERUBAHAN: Fungsi ini sekarang mengambil data 14-hari penuh dari cache/API
        final_data = process_wilayah_data(relevant_rows)
        
        return jsonify(final_data)

    except Exception as e:
        print(f"Error in /api/data-by-ids: {e}")
        return jsonify({"error": "Internal server error"}), 500
    finally:
        session.close()

# Rute monitoring, index, favicon, dan tiles tidak berubah
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
            return Response(tile_data[0], headers=headers) # tile_data[0] untuk data blob
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