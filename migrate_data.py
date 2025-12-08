import os
import geopandas as gpd
import pandas as pd
from sqlalchemy import create_engine
from dotenv import load_dotenv
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Muat environment variables dari .env file
load_dotenv()

# Dapatkan URL database dari environment variables
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL tidak ditemukan di environment variables. Pastikan file .env sudah benar.")

def migrate_geojson_to_postgis(filepath, table_name, engine):
    """
    Membaca file GeoJSON dan memigrasikannya ke tabel PostGIS.
    """
    try:
        logging.info(f"Membaca file GeoJSON: {filepath}...")
        gdf = gpd.read_file(filepath)
        
        # Pastikan kolom 'geometry' ada
        if 'geometry' not in gdf.columns:
            raise ValueError("File GeoJSON tidak memiliki kolom 'geometry'.")
            
        logging.info(f"Memigrasikan data ke tabel '{table_name}'...")
        # Menggunakan to_sql dari GeoPandas untuk membuat tabel dengan tipe geometri PostGIS
        gdf.to_postgis(name=table_name, con=engine, if_exists='replace', index=False)
        
        logging.info(f"Migrasi untuk tabel '{table_name}' berhasil. {len(gdf)} baris ditambahkan.")
    except Exception as e:
        logging.error(f"Gagal memigrasikan {filepath} ke tabel {table_name}: {e}")
        # Jangan raise error fatal agar proses lain tetap jalan (misal file tidak ada)
        pass

def migrate_csv_to_postgres(filepath, table_name, engine, dtype=None):
    """
    Membaca file CSV dan memigrasikannya ke tabel PostgreSQL.
    """
    try:
        logging.info(f"Membaca file CSV: {filepath}...")
        df = pd.read_csv(filepath, dtype=dtype)
        
        logging.info(f"Memigrasikan data ke tabel '{table_name}'...")
        # Menggunakan to_sql dari Pandas
        df.to_sql(name=table_name, con=engine, if_exists='replace', index=False)
        
        logging.info(f"Migrasi untuk tabel '{table_name}' berhasil. {len(df)} baris ditambahkan.")
    except Exception as e:
        logging.error(f"Gagal memigrasikan {filepath} ke tabel {table_name}: {e}")
        # Jangan raise error fatal agar proses lain tetap jalan (misal file tidak ada)
        pass

def main():
    """
    Fungsi utama untuk menjalankan semua proses migrasi.
    """
    engine = None
    try:
        logging.info("Membuat koneksi ke database...")
        if DATABASE_URL is not None:
            engine = create_engine(DATABASE_URL)
        else:
            raise ValueError("DATABASE_URL is not set in environment variables.")
        
        # Daftar file GeoJSON dan nama tabel yang diinginkan
        geojson_files = {
            "batas_negara.geojson": "batas_negara",
            "batas_provinsi.geojson": "batas_provinsi",
            "batas_kabupatenkota.geojson": "batas_kabupatenkota",
            "batas_kecamatandistrik.geojson": "batas_kecamatandistrik"
        }
        
        # Migrasi semua file GeoJSON
        for filename, tablename in geojson_files.items():
            filepath = os.path.join(os.path.dirname(__file__), 'static', filename)
            if os.path.exists(filepath):
                migrate_geojson_to_postgis(filepath, tablename, engine)
            else:
                logging.warning(f"File {filepath} tidak ditemukan, dilewati.")

        # Definisi tipe data eksplisit untuk kolom-kolom di CSV yang berpotensi memiliki mixed dtypes
        # Kolom kode sebaiknya diperlakukan sebagai string (str) untuk menghindari kehilangan angka nol di depan
        # atau masalah mixed-type yang diidentifikasi oleh Pandas.
        csv_dtypes = {
            'OBJECTID': 'int64',
            'KDBBPS': 'str', 'KDCBPS': 'str', 'KDCPUM': 'str',
            'KDEBPS': 'str', 'KDEPUM': 'str', 'KDPBPS': 'str',     
            'KDPKAB': 'str', 'KDPPUM': 'str',
            'WIADKC': 'str', 'WIADKK': 'str', 'WIADPR': 'str', 'WIADKD': 'str',
            'UUPP': 'str', 'layer': 'str', 'label': 'str'
        }

        # Migrasi file CSV
        csv_filepath = os.path.join(os.path.dirname(__file__), 'static', "wilayah_administratif_indonesia.csv")
        if os.path.exists(csv_filepath):
            migrate_csv_to_postgres(csv_filepath, "wilayah_administratif", engine, dtype=csv_dtypes)
        else:
            logging.warning(f"File {csv_filepath} tidak ditemukan, dilewati.")
            
        logging.info("Semua proses migrasi data telah selesai.")
        
    except Exception as e:
        logging.error(f"Terjadi kesalahan fatal selama migrasi: {e}")
    finally:
        if 'engine' in locals() and engine:
            engine.dispose()
            logging.info("Koneksi database ditutup.")

if __name__ == "__main__":
    main()