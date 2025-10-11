import os
import sys
import sqlite3
from flask import Flask, Response, render_template
from flask_cors import CORS

# tippecanoe -o peta_indonesia.mbtiles --force   --named-layer='{"name": "batas_provinsi", "file": "batas_provinsi.geojson", "minzoom": 4, "maxzoom": 7}'   --named-layer='{"name": "batas_kabupatenkota", "file": "batas_kabupatenkota.geojson", "minzoom": 8, "maxzoom": 10}'   --named-layer='{"name": "batas_kecamatandistrik", "file": "batas_kecamatandistrik.geojson", "minzoom": 11, "maxzoom": 13}'

# Inisialisasi Flask
app = Flask(__name__)
CORS(app) # Aktifkan CORS untuk semua rute

# Dapatkan path absolut ke file MBTiles
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Koneksi ke file MBTiles
MBTILES_FILE = os.path.join(BASE_DIR, 'peta_indonesia.mbtiles')

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