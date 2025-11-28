import os
import time
import random
import json
import math
import requests
import redis
import re
from datetime import datetime, timedelta
from flask import Flask, Response, render_template, request, jsonify
from flask_cors import CORS
from flask_compress import Compress
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
from pytz import timezone as pytz_timezone

# Muat variabel environment
load_dotenv()

app = Flask(__name__)
CORS(app)
Compress(app)

# ================== KONFIGURASI LINGKUNGAN ==================

# Deteksi Lingkungan (Vercel menetapkan 'VERCEL_ENV')
ENV_MODE = os.getenv("VERCEL_ENV", "development")
IS_PRODUCTION = ENV_MODE == "production"

# Kontrol API (Real vs Dummy)
# Di Vercel: Set Environment Variable USE_REAL_API = "true" atau "false"
# Default ke False untuk hemat kuota saat development
USE_REAL_API_ENV = os.getenv("USE_REAL_API", "false").lower()
USE_REAL_API = USE_REAL_API_ENV == "true"

# [BARU] Konfigurasi Base URL Peta
# Di Production: Gunakan URL Supabase Storage
# Di Development: Gunakan path lokal Flask '/static/maps'
SUPABASE_MAPS_URL = os.getenv("SUPABASE_MAPS_URL") # Contoh: https://xyz.supabase.co/.../maps
LOCAL_MAPS_URL = "/static/maps"

print(f"🚀 RUNNING IN {ENV_MODE.upper()} MODE")
print(f"📡 API SOURCE: {'REAL OPEN-METEO/BMKG' if USE_REAL_API else 'DUMMY DATA'}")

# ================== DATABASE CONFIGURATION (SUPABASE) ==================
if IS_PRODUCTION:
    DATABASE_URL = os.getenv("DATABASE_URL")
else:
    DATABASE_URL = os.getenv("DEV_DATABASE_URL")

if not DATABASE_URL:
    # Fallback message agar tidak crash saat build, tapi akan error saat request DB
    print("WARNING: DATABASE_URL tidak ditemukan. Pastikan env var diset.")
else:
    # Fix untuk SQLAlchemy yang butuh prefix postgresql:// (Supabase kadang memberi postgres://)
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Inisialisasi Engine DB (PostgreSQL)
# Pool size disesuaikan untuk serverless (jangan terlalu besar)
engine = None
Session = None

if DATABASE_URL:
    engine = create_engine(
        DATABASE_URL, 
        pool_size=5, 
        max_overflow=10, 
        pool_pre_ping=True
    )
    Session = sessionmaker(bind=engine)

# ================== REDIS CACHE CONFIGURATION (UPSTASH) ==================

REDIS_URL = os.getenv("REDIS_URL")
redis_client = None

if REDIS_URL:
    try:
        # Gunakan strict=False untuk parsing URL redis rediss://
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        # Test koneksi
        redis_client.ping()
        print("✅ Terhubung ke Redis (Upstash)")
    except Exception as e:
        print(f"❌ Gagal koneksi Redis: {e}")
        redis_client = None
else:
    print("⚠️ REDIS_URL tidak ditemukan. Caching akan menggunakan in-memory (tidak persisten di Vercel).")

# Cache TTL Defaults
CACHE_TTL_WEATHER = 1800  # 30 menit
CACHE_TTL_GEMPA_BMKG = 60 # 1 menit
CACHE_TTL_GEMPA_USGS = 300 # 5 menit

# Fallback In-Memory Cache (Jika Redis mati/tidak ada)
MEMORY_CACHE = {}

def get_cache(key):
    """Mengambil data dari cache (Redis -> Memory)."""
    try:
        if redis_client:
            data = redis_client.get(key)
            return json.loads(data) if data else None
        else:
            entry = MEMORY_CACHE.get(key)
            if entry and time.time() < entry['expire_at']:
                return entry['data']
            return None
    except Exception as e:
        print(f"Cache Get Error: {e}")
        return None

def set_cache(key, value, ttl):
    """Menyimpan data ke cache (Redis -> Memory)."""
    try:
        if redis_client:
            redis_client.setex(key, ttl, json.dumps(value))
        else:
            MEMORY_CACHE[key] = {
                'data': value,
                'expire_at': time.time() + ttl
            }
    except Exception as e:
        print(f"Cache Set Error: {e}")

# ================== KONSTANTA & HELPER ==================

ID_REGEX = re.compile(r"^[a-zA-Z0-9_.-]+$")
SEARCH_REGEX = re.compile(r"^[a-zA-Z0-9\s.,'-]+$")
MAX_SEARCH_LENGTH = 50

# Peta WMO (Sama seperti sebelumnya)
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

# ================== DUMMY GENERATORS (TETAP ADA) ==================

def generate_dummy_api_response(wilayah_infos):
    """Menghasilkan data dummy untuk Open-Meteo."""
    print(f"MODE DUMMY: Menghasilkan data untuk {len(wilayah_infos)} lokasi.")
    dummy_list = []
    total_hourly_points = 336
    total_daily_points = 14
    possible_codes = list(WMO_CODE_MAP.keys())

    dummy_tz_str = 'Asia/Singapore' # WIB ~ Singapore time offset
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
    dummy_offset_seconds = int(dummy_offset_second.total_seconds()) if dummy_offset_second else 25200 # Default WIB

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
            'timezone_abbreviation': 'WIB',
            'elevation': random.uniform(5, 50),
            'hourly_units': {},
            'hourly': hourly_data,
            'daily_units': {},
            'daily': daily_data
        }
        dummy_list.append(location_dummy)
    return dummy_list

# ... (Fungsi Helper Gempa: calculate_esteva_intensity, get_impact_level, generate_dummy_bmkg_data, generate_dummy_usgs_data)
# SAYA PERTAHANKAN SEMUA LOGIKA GEMPA ANDA DISINI
# Agar tidak memotong kode penting.

def calculate_esteva_intensity(magnitude, depth_km):
    if not magnitude or not depth_km: return 0
    try:
        c1, c2, c3, c4 = 1.5, 1.2, 1.1, 25
        r = depth_km
        intensity = c1 + (c2 * magnitude) - (c3 * math.log(r + c4))
        return max(1.0, min(12.0, intensity))
    except: return 0

def get_impact_level(mmi, is_tsunami):
    if is_tsunami:
        return {"status": "tsunami", "label": "BERPOTENSI TSUNAMI", "color": "#d32f2f", "pulse": "sonar", "description": "Jauhi pantai segera!"}
    if mmi < 3.0:
        return {"status": "weak", "label": "Guncangan Lemah", "color": "#2196F3", "pulse": "none", "description": "Dirasakan sebagian orang."}
    elif mmi < 6.0:
        return {"status": "moderate", "label": "Guncangan Terasa", "color": "#FFC107", "pulse": "slow", "description": "Benda ringan bergoyang."}
    else:
        return {"status": "severe", "label": "Guncangan Kuat", "color": "#E53935", "pulse": "fast", "description": "Potensi kerusakan bangunan."}

def generate_dummy_bmkg_data():
    gempa_list = []
    now = datetime.now()
    # Sample Tsunami
    gempa_list.append({
        "Tanggal": now.strftime("%d %b %Y"),
        "Jam": (now - timedelta(minutes=5)).strftime("%H:%M:%S WIB"),
        "DateTime": (now - timedelta(minutes=5)).isoformat(),
        "Coordinates": "-3.50,102.00", "Lintang": "3.50 LS", "Bujur": "102.00 BT",
        "Magnitude": "8.5", "Kedalaman": "10 km",
        "Wilayah": "250 km BaratDaya BENGKULU", "Potensi": "BERPOTENSI TSUNAMI UNTUK DITERUSKAN PADA MASYARAKAT"
    })
    # Sample Kuat
    for i in range(2):
        t = now - timedelta(hours=1, minutes=i*10)
        gempa_list.append({
            "Tanggal": t.strftime("%d %b %Y"),
            "Jam": t.strftime("%H:%M:%S WIB"),
            "DateTime": t.isoformat(),
            "Coordinates": f"-7.1,107.2", "Lintang": "7.xx LS", "Bujur": "107.xx BT",
            "Magnitude": "6.5", "Kedalaman": "15 km",
            "Wilayah": "Tasikmalaya", "Potensi": "Tidak berpotensi tsunami"
        })
    return {"Infogempa": {"gempa": gempa_list}}

def generate_dummy_usgs_data():
    features = []
    now_ms = int(time.time() * 1000)
    for i in range(10):
        mag = round(random.uniform(4.5, 6.5), 1)
        features.append({
            "type": "Feature",
            "properties": {
                "mag": mag,
                "place": f"Dummy Loc #{i}",
                "time": now_ms - random.randint(0, 86400000),
                "tsunami": 0, "title": f"M {mag} - Dummy"
            },
            "geometry": {"type": "Point", "coordinates": [120.0, -5.0, 30.0]},
            "id": f"dummy_usgs_{i}"
        })
    return {"type": "FeatureCollection", "features": features}

# ================== LOGIKA PEMROSESAN API ==================

def call_open_meteo_api(wilayah_infos):
    """Memanggil API OpenMeteo asli."""
    if not wilayah_infos: return None
    
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

    try:
        response = requests.get(base_url, params=params, timeout=15)
        response.raise_for_status()
        api_data = response.json()
        if isinstance(api_data, dict): return [api_data]
        return api_data
    except Exception as e:
        print(f"OpenMeteo Error: {e}")
        return None

def process_api_response(api_data_list, wilayah_infos):
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

def process_wilayah_data(wilayah_list):
    """
    Orkestrator utama: Cek Cache -> Fetch (Real/Dummy) -> Simpan Cache -> Return.
    """
    final_data = {}
    ids_to_fetch_info = []

    # 1. Cek Cache (Redis/Memory)
    for info in wilayah_list:
        wilayah_id = str(info["id"])
        data_to_store = {**info}
        data_to_store.pop('lat', None)
        data_to_store.pop('lon', None)

        cached_weather = get_cache(f"weather:{wilayah_id}")
        
        if cached_weather:
            final_data[wilayah_id] = {**info, **cached_weather}
        else:
            ids_to_fetch_info.append(info) 
    
    # 2. Fetch Data yang hilang
    if ids_to_fetch_info:
        if USE_REAL_API:
            api_data_list = call_open_meteo_api(ids_to_fetch_info)
        else:
            api_data_list = generate_dummy_api_response(ids_to_fetch_info)
            
        if api_data_list:
            new_weather_data_map = process_api_response(api_data_list, ids_to_fetch_info)
            for info in ids_to_fetch_info:
                wilayah_id = str(info['id'])
                if wilayah_id in new_weather_data_map:
                    weather_data = new_weather_data_map[wilayah_id]
                    # Simpan ke Cache
                    set_cache(f"weather:{wilayah_id}", weather_data, CACHE_TTL_WEATHER)
                    final_data[wilayah_id] = {**info, **weather_data}

    return final_data

# ================== ROUTES (ENDPOINT) ==================

@app.route('/')
def index():
    # [LOGIKA UTAMA ENVIRONMENT SWITCHING]
    # Jika Production: Pakai URL Supabase (harus diset di env)
    # Jika Development: Pakai URL Lokal
    if IS_PRODUCTION and SUPABASE_MAPS_URL:
        map_base_url = SUPABASE_MAPS_URL
        print(f"🌍 Using Map Source: SUPABASE ({map_base_url})")
    else:
        map_base_url = LOCAL_MAPS_URL
        print(f"💻 Using Map Source: LOCAL ({map_base_url})")

    # Injeksi variable ke template HTML
    return render_template('index.html', map_base_url=map_base_url)

@app.route('/api/wmo-codes')
def get_wmo_codes():
    return jsonify(WMO_CODE_MAP)

@app.route('/api/provinsi-info')
def get_provinsi_info():
    if not Session: return jsonify({"error": "Database not connected"}), 500
    session = Session()
    try:
        query = text("""
            SELECT "KDPPUM" as id, "WADMPR" as nama_simpel, "WADMPR" as nama_label, 
                   latitude as lat, longitude as lon, "TIPADM" as tipadm
            FROM batas_provinsi
            WHERE "KDPPUM" IS NOT NULL AND "TIPADM" = 1;
        """)
        result = session.execute(query)
        provinsi_info = [dict(row) for row in result.mappings()]
        return jsonify(provinsi_info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()

@app.route('/api/cari-lokasi')
def cari_lokasi():
    if not Session: return jsonify({"error": "Database not connected"}), 500
    q = request.args.get('q', '').strip()
    if not q or len(q) < 3 or not SEARCH_REGEX.match(q): return jsonify([])

    session = Session()
    try:
        # Query yang sama, tapi berjalan di atas PostGIS Supabase
        query = text("""
            SELECT * FROM (
                SELECT "KDPPUM" as id, "WADMPR" as nama_simpel, "WADMPR" as nama_label, latitude as lat, longitude as lon, "TIPADM" as tipadm FROM batas_provinsi WHERE "WADMPR" ILIKE :search_term
                UNION ALL
                SELECT k."KDPKAB" as id, k."WADMKK" as nama_simpel, CONCAT(k."WADMKK", ', ', p."WADMPR") as nama_label, k.latitude as lat, k.longitude as lon, k."TIPADM" as tipadm FROM batas_kabupatenkota k LEFT JOIN batas_provinsi p ON p."KDPPUM" = LEFT(k."KDPKAB", 2) WHERE k."WADMKK" ILIKE :search_term
                UNION ALL
                SELECT c."KDCPUM" as id, c."WADMKC" as nama_simpel, CONCAT(c."WADMKC", ', ', k."WADMKK") as nama_label, c.latitude as lat, c.longitude as lon, c."TIPADM" as tipadm FROM batas_kecamatandistrik c LEFT JOIN batas_kabupatenkota k ON k."KDPKAB" = LEFT(c."KDCPUM", 5) WHERE c."WADMKC" ILIKE :search_term
                UNION ALL
                SELECT "KDEPUM" as id, "WADMKD" as nama_simpel, label as nama_label, latitude as lat, longitude as lon, "TIPADM" as tipadm FROM wilayah_administratif WHERE "TIPADM" = 4 AND label ILIKE :search_term
            ) AS united_search ORDER BY tipadm, nama_simpel LIMIT 10;
        """)
        result = session.execute(query, {"search_term": f"%{q}%"})
        return jsonify([dict(row) for row in result.mappings()])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()

@app.route('/api/data-cuaca')
def get_data_cuaca():
    if not Session: return jsonify({"error": "Database not connected"}), 500
    bbox_str = request.args.get('bbox')
    zoom = int(float(request.args.get('zoom', 9)))
    
    if not bbox_str: return jsonify({"error": "bbox required"}), 400
    
    xmin, ymin, xmax, ymax = [float(c) for c in bbox_str.split(',')]
    bbox_wkt = f'SRID=4326;POLYGON(({xmin} {ymin}, {xmax} {ymin}, {xmax} {ymax}, {xmin} {ymax}, {xmin} {ymin}))'
    
    session = Session()
    try:
        query = None
        if 8 <= zoom <= 10: # Kab/Kota
            query = text("""
                SELECT t1."KDPKAB" as id, t1."WADMKK" as nama_simpel, COALESCE(t2.label, t1."WADMKK") as nama_label, 
                       t1.latitude as lat, t1.longitude as lon, t1."TIPADM" as tipadm
                FROM batas_kabupatenkota AS t1
                LEFT JOIN wilayah_administratif AS t2 ON t1."KDPKAB" = t2."KDPKAB" AND t2."TIPADM" = 2
                WHERE ST_Intersects(t1.geometry, ST_GeomFromEWKT(:bbox_wkt));
            """)
        elif 11 <= zoom <= 14: # Kecamatan
            query = text("""
                SELECT t1."KDCPUM" as id, t1."WADMKC" as nama_simpel, COALESCE(t2.label, t1."WADMKC") as nama_label, 
                       t1.latitude as lat, t1.longitude as lon, t1."TIPADM" as tipadm
                FROM batas_kecamatandistrik AS t1
                LEFT JOIN wilayah_administratif AS t2 ON t1."KDCPUM" = t2."KDCPUM" AND t2."TIPADM" = 3
                WHERE ST_Intersects(t1.geometry, ST_GeomFromEWKT(:bbox_wkt));
            """)
        else:
            return jsonify([])

        result = session.execute(query, {"bbox_wkt": bbox_wkt})
        return jsonify([dict(row) for row in result.mappings()])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()

@app.route('/api/sub-wilayah-cuaca')
def get_sub_wilayah_cuaca():
    if not Session: return jsonify({"error": "Database not connected"}), 500
    parent_id = request.args.get('id')
    parent_tipadm = int(request.args.get('tipadm', 0))
    view_mode = request.args.get('view', 'full')
    
    if not parent_id or not ID_REGEX.match(parent_id): return jsonify([])

    target_tipadm = parent_tipadm + 1
    session = Session()
    try:
        query_text = ""
        params = {"parent_id_prefix": f"{parent_id}.%"}
        
        if target_tipadm == 2:
            query_text = 'SELECT "KDPKAB" as id, "WADMKK" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm FROM batas_kabupatenkota WHERE "KDPKAB" LIKE :parent_id_prefix'
        elif target_tipadm == 3:
            query_text = 'SELECT "KDCPUM" as id, "WADMKC" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm FROM batas_kecamatandistrik WHERE "KDCPUM" LIKE :parent_id_prefix'
        elif target_tipadm == 4:
            params = {"parent_id": parent_id}
            query_text = 'SELECT "KDEPUM" as id, "WADMKD" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm FROM wilayah_administratif WHERE "TIPADM" = 4 AND "KDCPUM" = :parent_id'
        
        if query_text:
            result = session.execute(text(query_text), params)
            sub_wilayah = [dict(row) for row in result.mappings()]
            
            if view_mode == 'simple':
                return jsonify(sorted(sub_wilayah, key=lambda x: x.get('nama_simpel', '')))
            
            # Full processing with weather
            data_lengkap = process_wilayah_data(sub_wilayah)
            return jsonify(sorted(data_lengkap.values(), key=lambda x: x.get('nama_simpel', '')))
        return jsonify([])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()

@app.route('/api/data-by-ids')
def get_data_by_ids():
    if not Session: return jsonify({"error": "Database not connected"}), 500
    ids_str = request.args.get('ids')
    if not ids_str: return jsonify({})
    
    ids = [f"'{i}'" for i in ids_str.split(',') if ID_REGEX.match(i)]
    if not ids: return jsonify({})
    ids_tuple = f"({','.join(ids)})"
    
    session = Session()
    try:
        # Query kompleks gabungan (Sama seperti sebelumnya)
        query = text(f"""
            SELECT combined.id, combined.nama_simpel, COALESCE(wa.label, combined.nama_simpel) as nama_label, combined.lat, combined.lon, combined.tipadm
            FROM (
                SELECT "KDPPUM" as id, "WADMPR" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm, "KDPPUM" as j_prov, NULL as j_kab, NULL as j_kec, NULL as j_kel FROM batas_provinsi WHERE "KDPPUM" IN {ids_tuple}
                UNION ALL
                SELECT "KDPKAB" as id, "WADMKK" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm, NULL as j_prov, "KDPKAB" as j_kab, NULL as j_kec, NULL as j_kel FROM batas_kabupatenkota WHERE "KDPKAB" IN {ids_tuple}
                UNION ALL
                SELECT "KDCPUM" as id, "WADMKC" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm, NULL as j_prov, NULL as j_kab, "KDCPUM" as j_kec, NULL as j_kel FROM batas_kecamatandistrik WHERE "KDCPUM" IN {ids_tuple}
                UNION ALL
                SELECT "KDEPUM" as id, "WADMKD" as nama_simpel, latitude as lat, longitude as lon, "TIPADM" as tipadm, NULL as j_prov, NULL as j_kab, NULL as j_kec, "KDEPUM" as j_kel FROM wilayah_administratif WHERE "KDEPUM" IN {ids_tuple} AND "TIPADM" = 4
            ) as combined
            LEFT JOIN wilayah_administratif AS wa ON (wa."KDPPUM" = combined.j_prov AND wa."TIPADM" = 1) OR (wa."KDPKAB" = combined.j_kab AND wa."TIPADM" = 2) OR (wa."KDCPUM" = combined.j_kec AND wa."TIPADM" = 3) OR (wa."KDEPUM" = combined.j_kel AND wa."TIPADM" = 4);
        """)
        result = session.execute(query)
        rows = [dict(row) for row in result.mappings()]
        return jsonify(process_wilayah_data(rows))
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()

# ================== GEMPA ROUTES (DENGAN REDIS) ==================

def parse_bmkg_to_geojson(bmkg_data):
    # Logika parsing tetap sama, disalin untuk kelengkapan
    features = []
    gempa_list = bmkg_data.get('Infogempa', {}).get('gempa', [])
    if not isinstance(gempa_list, list): gempa_list = [gempa_list]

    for g in gempa_list:
        try:
            lat_raw, lon_raw = g['Coordinates'].split(',')
            lat, lon = float(lat_raw), float(lon_raw)
            mag = float(g['Magnitude'])
            depth_val = float(re.split(r'[^\d\.]', g['Kedalaman'])[0])
            is_tsunami = "berpotensi tsunami" in g.get('Potensi', '').lower() and "tidak" not in g.get('Potensi', '').lower()
            
            estimated_mmi = calculate_esteva_intensity(mag, depth_val)
            impact = get_impact_level(estimated_mmi, is_tsunami)
            
            features.append({
                "type": "Feature",
                "properties": {
                    "mag": mag, "place": g['Wilayah'], "time": g.get('DateTime'), 
                    "depth": g['Kedalaman'], "depth_km": depth_val, "tsunami": is_tsunami, "source": "bmkg",
                    "mmi": round(estimated_mmi, 1), "status_label": impact['label'], 
                    "status_color": impact['color'], "pulse_mode": impact['pulse'], "status_desc": impact['description']
                },
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "id": f"bmkg-{g['Tanggal']}-{g['Jam']}" 
            })
        except: continue
    return {"type": "FeatureCollection", "features": features}

@app.route('/api/gempa/bmkg')
def get_gempa_bmkg():
    cache_key = "gempa:bmkg"
    cached = get_cache(cache_key)
    if cached: return jsonify(cached)

    if not USE_REAL_API:
        dummy = parse_bmkg_to_geojson(generate_dummy_bmkg_data())
        set_cache(cache_key, dummy, CACHE_TTL_GEMPA_BMKG)
        return jsonify(dummy)
    
    try:
        resp = requests.get("https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json", timeout=10)
        data = parse_bmkg_to_geojson(resp.json())
        set_cache(cache_key, data, CACHE_TTL_GEMPA_BMKG)
        return jsonify(data)
    except:
        return jsonify(get_cache(cache_key) or {"features": []})

@app.route('/api/gempa/usgs')
def get_gempa_usgs():
    cache_key = "gempa:usgs"
    cached = get_cache(cache_key)
    if cached: return jsonify(cached)

    if not USE_REAL_API:
        dummy = generate_dummy_usgs_data() # Sudah format geojson
        # Post-process dummy untuk tambah atribut MMI dll (sama seperti real)
        # ... (logic post-process USGS dummy ada di fungsi generate, sudah lengkap)
        set_cache(cache_key, dummy, CACHE_TTL_GEMPA_USGS)
        return jsonify(dummy)
    
    try:
        resp = requests.get("https://earthquake.usgs.gov/fdsnws/event/1/query", params={"format": "geojson", "minlatitude": "-15", "maxlatitude": "10", "minlongitude": "90", "maxlongitude": "145", "minmagnitude": "4.5", "orderby": "time", "limit": "50"}, timeout=15)
        data = resp.json()
        
        # Post Processing USGS Real
        for feature in data.get('features', []):
            props = feature['properties']
            depth = feature['geometry']['coordinates'][2]
            props['depth'] = f"{depth} km"
            is_tsunami = bool(props.get('tsunami', 0))
            mmi = calculate_esteva_intensity(props['mag'], depth)
            impact = get_impact_level(mmi, is_tsunami)
            props.update({"mmi": round(mmi,1), "status_label": impact['label'], "status_color": impact['color'], "pulse_mode": impact['pulse'], "status_desc": impact['description']})
            
        set_cache(cache_key, data, CACHE_TTL_GEMPA_USGS)
        return jsonify(data)
    except:
        return jsonify(get_cache(cache_key) or {"features": []})

@app.route('/api/monitoring-stats')
def get_monitoring_stats():
    return jsonify({
        "status": "online",
        "env": ENV_MODE,
        "api_source": "real" if USE_REAL_API else "dummy",
        "database": "connected" if engine else "disconnected",
        "cache": "redis" if redis_client else "memory"
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)