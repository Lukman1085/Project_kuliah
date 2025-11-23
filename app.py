import os
import time
import random
import sqlite3
import requests
import json
import math
from datetime import datetime, timedelta
from flask import Flask, Response, render_template, request, jsonify
from flask_cors import CORS
from flask_compress import Compress
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
from pytz import timezone as pytz_timezone
import re

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

# ================== CACHE CONFIGURATION ==================
WEATHER_CACHE = {}
CACHE_TTL = 1800  # 30 menit

# [BARU] Cache khusus untuk Gempa (TTL lebih pendek karena real-time)
GEMPA_CACHE = {
    'bmkg': {'data': None, 'timestamp': 0},
    'usgs': {'data': None, 'timestamp': 0}
}
GEMPA_TTL_BMKG = 60   # 1 Menit (BMKG update tiap kejadian)
GEMPA_TTL_USGS = 300  # 5 Menit (USGS data global)

API_CALL_TIMESTAMPS = []
LAST_API_CALL_COUNT = 0

USE_REAL_API = False # PENTING! JADIKAN False JIKA DALAM PENGEMBANGAN ATAU PENGUJIAN

ID_REGEX = re.compile(r"^[a-zA-Z0-9_.-]+$")

# Regex sederhana untuk memvalidasi input pencarian
SEARCH_REGEX = re.compile(r"^[a-zA-Z0-9\s.,'-]+$")
MAX_SEARCH_LENGTH = 50 

# Peta WMO -> (deskripsi, icon siang, icon malam)
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

def generate_dummy_api_response(wilayah_infos):
    """
    Menghasilkan data dummy (14 hari) untuk multi-lokasi,
    meniru struktur Open-Meteo (timezone & time array per lokasi).
    """
    print(f"MODE DUMMY: Menghasilkan data untuk {len(wilayah_infos)} lokasi.")
    dummy_list = []
    total_hourly_points = 336  # 14 hari * 24 jam
    total_daily_points = 14    # 14 hari
    possible_codes = list(WMO_CODE_MAP.keys())

    dummy_tz_str = 'Asia/Singapore'
    dummy_tz = pytz_timezone(dummy_tz_str)
    now_in_tz = datetime.now(dummy_tz)
    start_date_in_tz = (now_in_tz - timedelta(days=7)).date()

    start_datetime_local = datetime(start_date_in_tz.year, start_date_in_tz.month, start_date_in_tz.day, 0, 0, 0)

    dummy_hourly_times = [
        (start_datetime_local + timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M')
        for i in range(total_hourly_points)
    ]
    dummy_daily_times = [
        (start_date_in_tz + timedelta(days=i)).isoformat()
        for i in range(total_daily_points)
    ]

    localized_start = dummy_tz.localize(start_datetime_local)
    dummy_offset_second = localized_start.utcoffset()
    if dummy_offset_second is not None:
        dummy_offset_seconds = int(dummy_offset_second.total_seconds())
    dummy_tz_abbrev = localized_start.strftime('%Z')

    for info in wilayah_infos:
        hourly_data = {
            'time': dummy_hourly_times,
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
            'time': dummy_daily_times,
            'weather_code': [random.choice(possible_codes) for _ in range(total_daily_points)],
            'temperature_2m_max': [round(random.uniform(30.0, 34.0), 1) for _ in range(total_daily_points)],
            'temperature_2m_min': [round(random.uniform(23.0, 26.0), 1) for _ in range(total_daily_points)]
        }

        location_dummy = {
            'latitude': info['lat'],
            'longitude': info['lon'],
            'generationtime_ms': random.uniform(0.5, 2.0),
            'utc_offset_seconds': dummy_offset_seconds,
            'timezone': dummy_tz_str,
            'timezone_abbreviation': dummy_tz_abbrev,
            'elevation': random.uniform(5, 50),
            'hourly_units': {},
            'hourly': hourly_data,
            'daily_units': {},
            'daily': daily_data
        }
        dummy_list.append(location_dummy)
    return dummy_list

def call_open_meteo_api(wilayah_infos):
    """
    Memanggil API OpenMeteo asli (hourly + daily).
    """
    global LAST_API_CALL_COUNT, API_CALL_TIMESTAMPS
    if not wilayah_infos:
        return None

    base_url = "https://api.open-meteo.com/v1/forecast"
    latitudes = [str(info['lat']) for info in wilayah_infos]
    longitudes = [str(info['lon']) for info in wilayah_infos]

    params = {
        "latitude": ",".join(latitudes),
        "longitude": ",".join(longitudes),
        "hourly": "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min",
        "timezone": "auto",
        "forecast_days": 7,
        "past_days": 7
    }

    LAST_API_CALL_COUNT = len(wilayah_infos)
    API_CALL_TIMESTAMPS.append(time.time())
    print(f"MODE API ASLI: Memanggil OpenMeteo untuk {LAST_API_CALL_COUNT} lokasi.")
    
    try:
        response = requests.get(base_url, params=params, timeout=15)
        response.raise_for_status()
        api_data = response.json()
        if isinstance(api_data, dict):
            return [api_data]
        return api_data
    except requests.exceptions.HTTPError as http_err:
        print(f"HTTP error: {http_err} - {response.text}")
    except requests.exceptions.RequestException as req_err:
        print(f"Request error: {req_err}")
    except ValueError as json_err:
        print(f"Gagal parsing JSON: {json_err}")
    return None

def process_api_response(api_data_list, wilayah_infos):
    """
    Mengemas data per wilayah_id (14 hari penuh).
    """
    processed_data = {}
    for original_info, location_data in zip(wilayah_infos, api_data_list):
        wilayah_id = original_info['id']
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
    if not wilayah_infos:
        return {}
    api_data_list = call_open_meteo_api(wilayah_infos) if USE_REAL_API else generate_dummy_api_response(wilayah_infos)
    if api_data_list is None:
        return {}
    return process_api_response(api_data_list, wilayah_infos)

def process_wilayah_data(wilayah_list):
    final_data = {}
    ids_to_fetch_info = []
    current_time = time.time()

    for info in wilayah_list:
        wilayah_id = info["id"]
        # Pastikan kita meneruskan semua info yang diterima
        data_to_store = {**info}
        # Hapus data geo yang tidak perlu disimpan di cache
        data_to_store.pop('lat', None)
        data_to_store.pop('lon', None)


        if wilayah_id in WEATHER_CACHE and (current_time - WEATHER_CACHE[wilayah_id]['timestamp'] < CACHE_TTL):
            weather_data = WEATHER_CACHE[wilayah_id]['data']
            final_data[wilayah_id] = {**info, **weather_data} # Gabungkan info asli (dgn lat/lon) + data cache
        else:
            ids_to_fetch_info.append(info) 
    
    if ids_to_fetch_info:
        new_weather_data_map = get_weather_data_for_locations(ids_to_fetch_info)
        for info in ids_to_fetch_info:
            wilayah_id = info['id']
            if wilayah_id in new_weather_data_map:
                weather_data = new_weather_data_map[wilayah_id]
                WEATHER_CACHE[wilayah_id] = {"data": weather_data, "timestamp": current_time}
                final_data[wilayah_id] = {**info, **weather_data} # Gabungkan info asli (dgn lat/lon) + data baru

    return final_data

# ================== ROUTES ==================

@app.route('/api/wmo-codes')
def get_wmo_codes():
    return jsonify(WMO_CODE_MAP)

@app.route('/api/provinsi-info')
def get_provinsi_info():
    session = Session()
    try:
        query = text("""
            SELECT 
                "KDPPUM" as id, 
                "WADMPR" as nama_simpel, 
                "WADMPR" as nama_label, 
                latitude as lat, 
                longitude as lon,
                "TIPADM" as tipadm
            FROM batas_provinsi
            WHERE "KDPPUM" IS NOT NULL AND "WADMPR" IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL AND "TIPADM" = 1;
        """)
        result = session.execute(query)
        provinsi_info = [dict(row) for row in result.mappings()]
        return jsonify(provinsi_info)
    except Exception as e:
        print(f"Error in /api/provinsi-info: {e}")
        return jsonify({"error": "Internal server error"}), 500
    finally:
        session.close()

@app.route('/api/cari-lokasi')
def cari_lokasi():
    q = request.args.get('q', '').strip()

    if not q or len(q) < 3 or len(q) > MAX_SEARCH_LENGTH:
        return jsonify([])
        
    if not SEARCH_REGEX.match(q):
        return jsonify({"error": "Karakter tidak valid"}), 400

    session = Session()
    try:
        # [DATA INTEGRITY FIX]
        # Menggunakan UNION ALL untuk menggabungkan hasil dari tabel batas (ID valid)
        # dan tabel wilayah_administratif (fallback untuk Desa).
        # Label dikonstruksi dinamis menggunakan JOIN pattern matching.
        
        query = text("""
            SELECT * FROM (
                -- 1. PROVINSI (Valid dari batas_provinsi)
                SELECT 
                    "KDPPUM" as id,
                    "WADMPR" as nama_simpel,
                    "WADMPR" as nama_label,
                    latitude as lat, longitude as lon, "TIPADM" as tipadm
                FROM batas_provinsi
                WHERE "WADMPR" ILIKE :search_term
                
                UNION ALL
                
                -- 2. KABUPATEN/KOTA (Valid dari batas_kabupatenkota + Join Provinsi utk Label)
                SELECT 
                    k."KDPKAB" as id,
                    k."WADMKK" as nama_simpel,
                    CONCAT(k."WADMKK", ', ', p."WADMPR") as nama_label,
                    k.latitude as lat, k.longitude as lon, k."TIPADM" as tipadm
                FROM batas_kabupatenkota k
                LEFT JOIN batas_provinsi p ON p."KDPPUM" = LEFT(k."KDPKAB", 2)
                WHERE k."WADMKK" ILIKE :search_term
                
                UNION ALL
                
                -- 3. KECAMATAN (Valid dari batas_kecamatandistrik + Join Kab/Kota utk Label)
                SELECT 
                    c."KDCPUM" as id,
                    c."WADMKC" as nama_simpel,
                    CONCAT(c."WADMKC", ', ', k."WADMKK") as nama_label,
                    c.latitude as lat, c.longitude as lon, c."TIPADM" as tipadm
                FROM batas_kecamatandistrik c
                LEFT JOIN batas_kabupatenkota k ON k."KDPKAB" = LEFT(c."KDCPUM", 5) -- Asumsi ID format 'XX.XX' (5 char)
                WHERE c."WADMKC" ILIKE :search_term
                
                UNION ALL
                
                -- 4. DESA/KELURAHAN (Fallback ke wilayah_administratif, terima nasib ID mungkin rusak tapi user butuh ini)
                SELECT
                    "KDEPUM" as id,
                    "WADMKD" as nama_simpel,
                    label as nama_label,
                    latitude as lat, longitude as lon, "TIPADM" as tipadm
                FROM wilayah_administratif
                WHERE "TIPADM" = 4 AND label ILIKE :search_term
                
            ) AS united_search
            ORDER BY tipadm, nama_simpel
            LIMIT 10;
        """)
        
        search_term = f"%{q}%"
        
        result = session.execute(query, {"search_term": search_term})
        lokasi = [dict(row) for row in result.mappings()]
        
        return jsonify(lokasi)

    except Exception as e:
        print(f"Error in /api/cari-lokasi: {e}")
        return jsonify({"error": "Internal server error"}), 500
    finally:
        session.close()

@app.route('/api/data-cuaca')
def get_data_cuaca():
    session = Session()
    try:
        bbox_str = request.args.get('bbox')
        zoom = int(float(request.args.get('zoom', 9)))
        if not bbox_str:
            return jsonify({"error": "bbox parameter is required"}), 400

        xmin, ymin, xmax, ymax = [float(coord) for coord in bbox_str.split(',')]
        if not all(isinstance(c, (int, float)) for c in [xmin, ymin, xmax, ymax]):
            return jsonify({"error": "Invalid bbox coordinates"}), 400
        
        bbox_wkt = f'SRID=4326;POLYGON(({xmin} {ymin}, {xmax} {ymin}, {xmax} {ymax}, {xmin} {ymax}, {xmin} {ymin}))'
        
        query = None
        if 8 <= zoom <= 10:
            # Filter TIPADM = 2 (Kab/Kota)
            query = text("""
                SELECT
                    t1."KDPKAB" as id,
                    t1."WADMKK" as nama_simpel,
                    COALESCE(t2.label, t1."WADMKK") as nama_label,
                    t1.latitude as lat,
                    t1.longitude as lon,
                    t1."TIPADM" as tipadm
                FROM batas_kabupatenkota AS t1
                LEFT JOIN wilayah_administratif AS t2
                    ON t1."KDPKAB" = t2."KDPKAB" AND t2."TIPADM" = 2
                WHERE
                    ST_Intersects(t1.geometry, ST_GeomFromEWKT(:bbox_wkt))
                    AND t1."KDPKAB" IS NOT NULL;
            """)
        elif 11 <= zoom <= 14:
            # Filter TIPADM = 3 (Kecamatan)
            query = text("""
                SELECT
                    t1."KDCPUM" as id,
                    t1."WADMKC" as nama_simpel,
                    COALESCE(t2.label, t1."WADMKC") as nama_label,
                    t1.latitude as lat,
                    t1.longitude as lon,
                    t1."TIPADM" as tipadm
                FROM batas_kecamatandistrik AS t1
                LEFT JOIN wilayah_administratif AS t2
                    ON t1."KDCPUM" = t2."KDCPUM" AND t2."TIPADM" = 3
                WHERE
                    ST_Intersects(t1.geometry, ST_GeomFromEWKT(:bbox_wkt))
                    AND t1."KDCPUM" IS NOT NULL;
            """)
        else:
            return jsonify([])

        result = session.execute(query, {"bbox_wkt": bbox_wkt})
        wilayah_info = [dict(row) for row in result.mappings()]

        print(f"Ditemukan {len(wilayah_info)} wilayah di BBOX ini (dengan JOIN yang diperbaiki).")
        return jsonify(wilayah_info)

    except Exception as e:
        print(f"Error in /api/data-cuaca: {e}")
        return jsonify({"error": "Internal server error"}), 500
    finally:
        session.close()

# ===== ENDPOINT BARU UNTUK FITUR INI =====
@app.route('/api/sub-wilayah-cuaca')
def get_sub_wilayah_cuaca():
    session = Session()
    try:
        parent_id = request.args.get('id')
        parent_tipadm_str = request.args.get('tipadm')
        view_mode = request.args.get('view', 'full') # [MODIFIKASI LAZY LOAD] Default 'full' untuk kompatibilitas lama
        
        if not parent_id or not parent_tipadm_str:
            return jsonify({"error": "Parameter 'id' dan 'tipadm' diperlukan"}), 400
        
        # Validasi regex ID sederhana
        if not ID_REGEX.match(parent_id):
             return jsonify({"error": "ID induk tidak valid"}), 400

        parent_tipadm = int(parent_tipadm_str)
        target_tipadm = parent_tipadm + 1

        query_text = None
        # Gunakan string parent_id sebagai prefix untuk pencarian LIKE
        # Ini mengatasi masalah ID terpotong di tabel wilayah_administratif.
        # Kita mencari ke tabel 'batas_' yang ID-nya valid.
        params = {"parent_id_prefix": f"{parent_id}.%"} 

        if target_tipadm == 2: 
            # [DATA INTEGRITY FIX] Gunakan tabel batas_kabupatenkota sebagai source of truth
            # Cari Kabupaten yang ID-nya diawali dengan ID Provinsi parent
            query_text = """
                SELECT "KDPKAB" as id, "WADMKK" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm
                FROM batas_kabupatenkota
                WHERE "KDPKAB" LIKE :parent_id_prefix
                AND "KDPKAB" IS NOT NULL AND "WADMKK" IS NOT NULL;
            """
        elif target_tipadm == 3: 
            # [DATA INTEGRITY FIX] Gunakan tabel batas_kecamatandistrik sebagai source of truth
            # Cari Kecamatan yang ID-nya diawali dengan ID Kabupaten parent
            query_text = """
                SELECT "KDCPUM" as id, "WADMKC" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm
                FROM batas_kecamatandistrik
                WHERE "KDCPUM" LIKE :parent_id_prefix
                AND "KDCPUM" IS NOT NULL AND "WADMKC" IS NOT NULL;
            """
        elif target_tipadm == 4: 
            # [FALLBACK] Untuk Desa, tetap gunakan wilayah_administratif karena tidak ada tabel batas desa
            # Logic: Cari Desa yang KDCPUM-nya sama dengan Parent ID
            params = {"parent_id": parent_id} # Kembalikan ke exact match untuk level ini
            query_text = """
                SELECT "KDEPUM" as id, "WADMKD" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm
                FROM wilayah_administratif
                WHERE "TIPADM" = 4 AND "KDCPUM" = :parent_id
                AND "KDEPUM" IS NOT NULL AND "WADMKD" IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;
            """
        
        if query_text:
            query = text(query_text)
            result = session.execute(query, params)
            sub_wilayah_info = [dict(row) for row in result.mappings()]
            
            if not sub_wilayah_info:
                print(f"Tidak ditemukan sub-wilayah untuk {parent_id} (TIPADM {parent_tipadm})")
                return jsonify([])

            # [MODIFIKASI LAZY LOAD] Jika view='simple', kembalikan list saja TANPA panggil API cuaca
            if view_mode == 'simple':
                print(f"Mode Simple: Mengembalikan {len(sub_wilayah_info)} sub-wilayah tanpa data cuaca.")
                # Urutkan berdasarkan nama sebelum dikirim
                sorted_data = sorted(sub_wilayah_info, key=lambda x: x.get('nama_simpel', ''))
                return jsonify(sorted_data)

            # Mode Default (Full) - Logic Lama
            print(f"Memproses data cuaca untuk {len(sub_wilayah_info)} sub-wilayah...")
            data_cuaca_lengkap = process_wilayah_data(sub_wilayah_info)
            
            sorted_data = sorted(data_cuaca_lengkap.values(), key=lambda x: x.get('nama_simpel', ''))
            return jsonify(sorted_data)
        else:
            return jsonify([])

    except Exception as e:
        print(f"Error in /api/sub-wilayah-cuaca: {e}")
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

        query = text(f"""
            SELECT
                combined.id,
                combined.nama_simpel,
                COALESCE(wa.label, combined.nama_simpel) as nama_label,
                combined.lat,
                combined.lon,
                combined.tipadm
            FROM (
                -- TIPADM 1 (Provinsi)
                SELECT 
                    "KDPPUM" as id, "WADMPR" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm,
                    "KDPPUM" as j_prov, NULL as j_kab, NULL as j_kec, NULL as j_kel 
                FROM batas_provinsi 
                WHERE "KDPPUM" IN {ids_tuple_str}
                
                UNION ALL
                
                -- TIPADM 2 (Kab/Kota)
                SELECT 
                    "KDPKAB" as id, "WADMKK" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm,
                    NULL as j_prov, "KDPKAB" as j_kab, NULL as j_kec, NULL as j_kel 
                FROM batas_kabupatenkota 
                WHERE "KDPKAB" IN {ids_tuple_str}
                
                UNION ALL
                
                -- TIPADM 3 (Kecamatan)
                SELECT 
                    "KDCPUM" as id, "WADMKC" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm,
                    NULL as j_prov, NULL as j_kab, "KDCPUM" as j_kec, NULL as j_kel 
                FROM batas_kecamatandistrik 
                WHERE "KDCPUM" IN {ids_tuple_str}
                
                UNION ALL
                
                -- TIPADM 4 (Kel/Desa) - Ambil langsung dari tabel wilayah_administratif
                SELECT 
                    "KDEPUM" as id, "WADMKD" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm,
                    NULL as j_prov, NULL as j_kab, NULL as j_kec, "KDEPUM" as j_kel 
                FROM wilayah_administratif
                WHERE "KDEPUM" IN {ids_tuple_str} AND "TIPADM" = 4

            ) as combined
            LEFT JOIN wilayah_administratif AS wa
                ON (wa."KDPPUM" = combined.j_prov AND wa."TIPADM" = 1)
                OR (wa."KDPKAB" = combined.j_kab AND wa."TIPADM" = 2)
                OR (wa."KDCPUM" = combined.j_kec AND wa."TIPADM" = 3)
                OR (wa."KDEPUM" = combined.j_kel AND wa."TIPADM" = 4);
        """)
        
        result = session.execute(query)
        relevant_rows = [dict(row) for row in result.mappings()]
        
        if not relevant_rows:
             print(f"PERINGATAN: Tidak ada data ditemukan di /api/data-by-ids untuk {ids_tuple_str}")
             return jsonify({}), 404 

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

# ================== MODUL GEMPA PINTAR ==================

def calculate_esteva_intensity(magnitude, depth_km):
    """
    Estimasi MMI Menggunakan Aproksimasi Esteva (1970) yang disederhanakan.
    I = C1 + C2 * M - C3 * ln(R + C4)
    Kita asumsikan R (jarak hiposentral ke episenter) = depth_km.
    
    Koefisien disesuaikan agar M6.0 di 100km tidak menghasilkan MMI besar.
    """
    if not magnitude or not depth_km:
        return 0
    
    try:
        # Konstanta Aproksimasi (Dikalibrasi agar M6.0 Depth 120km ~ MMI 3-4)
        c1 = 1.5 
        c2 = 1.2 # Pengaruh Magnitudo
        c3 = 1.1 # Peluruhan Jarak
        c4 = 25  # Saturasi Jarak dekat
        
        # Jarak Hiposentral di Episenter = Kedalaman
        r = depth_km 
        
        # Rumus Dasar Esteva untuk PGA (Log scale) lalu konversi linear ke MMI
        # Kita pakai simplified direct MMI relation:
        intensity = c1 + (c2 * magnitude) - (c3 * math.log(r + c4))
        
        # Clamping hasil agar masuk akal (I - XII)
        return max(1.0, min(12.0, intensity))
    except:
        return 0

def get_impact_level(mmi, is_tsunami):
    """
    Menentukan Status UI & Warna berdasarkan MMI & Tsunami Flag.
    """
    # 1. CRITICAL OVERRIDE: TSUNAMI
    if is_tsunami:
        return {
            "status": "tsunami",
            "label": "BERPOTENSI TSUNAMI",
            "color": "#d32f2f", # Merah
            "pulse": "sonar",   # [NEW] Animasi Gelombang Sonar
            "description": "Jauhi pantai segera!"
        }
    
    # 2. STANDARD SHAKE CLASSIFICATION
    if mmi < 3.0:
        return {
            "status": "weak",
            "label": "Guncangan Lemah",
            "color": "#2196F3", # Biru
            "pulse": "none",    # Tidak ada animasi
            "description": "Dirasakan sebagian orang."
        }
    elif mmi < 6.0:
        return {
            "status": "moderate",
            "label": "Guncangan Terasa",
            "color": "#FFC107", # Kuning/Jingga
            "pulse": "slow",    # Detak lambat
            "description": "Benda ringan bergoyang."
        }
    else:
        return {
            "status": "severe",
            "label": "Guncangan Kuat",
            "color": "#E53935", # Merah
            "pulse": "fast",    # Detak cepat
            "description": "Potensi kerusakan bangunan."
        }

def parse_bmkg_to_geojson(bmkg_data):
    features = []
    gempa_list = bmkg_data.get('Infogempa', {}).get('gempa', [])
    if not isinstance(gempa_list, list): gempa_list = [gempa_list]

    for g in gempa_list:
        try:
            # BMKG Coordinates field: "-3.56,101.23" (Lat, Lon) string
            lat_raw, lon_raw = g['Coordinates'].split(',')
            lat, lon = float(lat_raw), float(lon_raw)
            mag = float(g['Magnitude'])
            
            # Parsing Kedalaman "119 km" -> 119.0
            depth_str = g['Kedalaman']
            depth_val = float(re.split(r'[^\d\.]', depth_str)[0])
            
            # Deteksi Tsunami dari String
            potensi_text = g.get('Potensi', '').lower()
            is_tsunami = "berpotensi tsunami" in potensi_text and "tidak" not in potensi_text
            
            # [LOGIKA PINTAR] Hitung MMI & Status
            estimated_mmi = calculate_esteva_intensity(mag, depth_val)
            impact = get_impact_level(estimated_mmi, is_tsunami)
            
            feature = {
                "type": "Feature",
                "properties": {
                    "mag": mag,
                    "place": g['Wilayah'],
                    "time": g.get('DateTime'), 
                    "depth": depth_str,
                    "depth_km": depth_val,
                    "tsunami": is_tsunami,
                    "source": "bmkg",
                    # [PROPERTI BARU UNTUK UI]
                    "mmi": round(estimated_mmi, 1),
                    "status_label": impact['label'],
                    "status_color": impact['color'],
                    "pulse_mode": impact['pulse'],
                    "status_desc": impact['description']
                },
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "id": f"bmkg-{g['Tanggal']}-{g['Jam']}" 
            }
            features.append(feature)
        except Exception as e:
            print(f"Skip BMKG Item: {e}")
            continue
    return {"type": "FeatureCollection", "features": features}

@app.route('/api/gempa/bmkg')
def get_gempa_bmkg():
    """
    Proxy untuk mengambil data Gempa Terkini dari BMKG.
    Menggunakan caching internal agar tidak membebani server BMKG.
    """
    global GEMPA_CACHE
    now = time.time()
    if GEMPA_CACHE['bmkg']['data'] and (now - GEMPA_CACHE['bmkg']['timestamp'] < GEMPA_TTL_BMKG): return jsonify(GEMPA_CACHE['bmkg']['data'])
    try:
        url = "https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json"
        print(f"Fetching BMKG Earthquake data from {url}...")
        resp = requests.get("https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json", timeout=10)
        resp.raise_for_status()
        geojson = parse_bmkg_to_geojson(resp.json())
        GEMPA_CACHE['bmkg'] = {'data': geojson, 'timestamp': now}
        return jsonify(geojson)
    except Exception as e:
        return jsonify(GEMPA_CACHE['bmkg']['data']) if GEMPA_CACHE['bmkg']['data'] else jsonify({"error": str(e)}), 502

@app.route('/api/gempa/usgs')
def get_gempa_usgs():
    """
    Proxy untuk mengambil data Gempa Signifikan dari USGS.
    """
    global GEMPA_CACHE
    now = time.time()
    if GEMPA_CACHE['usgs']['data'] and (now - GEMPA_CACHE['usgs']['timestamp'] < GEMPA_TTL_USGS): return jsonify(GEMPA_CACHE['usgs']['data'])
    try:
        url = "https://earthquake.usgs.gov/fdsnws/event/1/query"
        params = {"format": "geojson", "minlatitude": "-15", "maxlatitude": "10", "minlongitude": "90", "maxlongitude": "145", "minmagnitude": "4.5", "orderby": "time", "limit": "50"}
        print(f"Fetching USGS Earthquake data...")
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        
        usgs_data = resp.json()
        
        # Post-Processing USGS Data
        for feature in usgs_data.get('features', []):
            props = feature['properties']
            geom = feature['geometry']
            
            # Extract Kedalaman (Index 2 coordinates)
            depth_val = geom['coordinates'][2] if len(geom['coordinates']) > 2 else 10.0
            props['depth'] = f"{depth_val} km"
            props['depth_km'] = depth_val
            props['source'] = 'usgs'
            if 'place' not in props: props['place'] = 'Unknown Location'
            
            # Deteksi Tsunami (USGS pakai integer 0/1)
            is_tsunami = bool(props.get('tsunami', 0))
            
            # [LOGIKA PINTAR]
            estimated_mmi = calculate_esteva_intensity(props['mag'], depth_val)
            impact = get_impact_level(estimated_mmi, is_tsunami)
            
            # Inject Properti UI
            props['mmi'] = round(estimated_mmi, 1)
            props['status_label'] = impact['label']
            props['status_color'] = impact['color']
            props['pulse_mode'] = impact['pulse']
            props['status_desc'] = impact['description']
            
        GEMPA_CACHE['usgs'] = {'data': usgs_data, 'timestamp': now}
        return jsonify(usgs_data)
    except Exception as e:
        return jsonify(GEMPA_CACHE['usgs']['data']) if GEMPA_CACHE['usgs']['data'] else jsonify({"error": str(e)}), 502

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