// --- REFAKTOR (Rencana 3.1 - TAHAP C: VISUAL ASSEMBLY) ---
// Definisi style peta dengan marker komposit (3-in-1)

const protocol = window.location.protocol;
const hostname = window.location.hostname;
const port = '5000';
const baseUrl = `${protocol}//${hostname}:${port}`;

export const MAP_STYLE = { 
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sources: { 
        'cartodb-positron-nolabels': { type: 'raster', tiles: ['https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' },
        'batas-wilayah-vector': { type: 'vector', tiles: [`${baseUrl}/tiles/{z}/{x}/{y}.pbf`], minzoom: 4, maxzoom: 14, attribution: 'Data Batas Wilayah BIG' },
        'data-cuaca-source': { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 13, clusterRadius: 80, promoteId: 'id' },
        'provinsi-source': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
    },
    layers: [ 
        // 1. Base Tiles & Boundaries
        { id: 'cartodb-positron-layer', type: 'raster', source: 'cartodb-positron-nolabels' },
        { id: 'batas-provinsi-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_provinsi', minzoom: 5, maxzoom: 7.99, paint: { 'line-color': '#A0522D', 'line-width': 1.5, 'line-opacity': 0.7 }},
        { id: 'batas-kabupaten-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_kabupatenkota', minzoom: 8, maxzoom: 10.99, paint: { 'line-color': '#4682B4', 'line-width': 1, 'line-opacity': 0.6 }},
        { id: 'batas-kecamatan-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_kecamatandistrik', minzoom: 11, maxzoom: 14, paint: { 'line-color': '#556B2F', 'line-width': 0.8, 'line-opacity': 0.5 }},
        
        // 2. Provinsi Points (Simple Dots)
        { id: 'provinsi-point-circle', type: 'circle', source: 'provinsi-source', paint: { 'circle-radius': 7, 'circle-color': 'rgba(255, 255, 255, 0.6)', 'circle-stroke-color': '#333', 'circle-stroke-width': 1 }},
        { 
            id: 'provinsi-point-label', 
            type: 'symbol', 
            source: 'provinsi-source', 
            layout: { 'text-field': ['get', 'nama_simpel'], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-anchor': 'left', 'text-offset': [0.8, 0], 'text-optional': true }, 
            paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
        },

        // 3. Cluster Bubbles (Tetap Sama)
        { id: 'cluster-background-layer', type: 'circle', source: 'data-cuaca-source', filter: ['has', 'point_count'], paint: { 'circle-radius': ['step', ['get', 'point_count'], 18, 50, 22, 200, 26], 'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 50, '#f1f075', 200, '#f28cb1'], 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': 0.9 }},
        { id: 'cluster-count-layer', type: 'symbol', source: 'data-cuaca-source', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Noto Sans Regular'], 'text-size': 12 }, paint: {'text-color': '#333333', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5, 'text-halo-blur': 1 } },
        
        // ============================================================
        // 4. MARKER KOMPOSIT BARU (The 3-in-1 Marker)
        // ============================================================

        // A. LAYER BASE (Lingkaran Putih Netral)
        // Kita gunakan ID lama 'unclustered-point-temp-circle' agar logic klik di map_manager.js tetap jalan!
        {
            id: 'unclustered-point-temp-circle', 
            type: 'circle', 
            source: 'data-cuaca-source', 
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': '#ffffff', // Putih netral
                // Ukuran sedikit lebih lebar oval untuk menampung 3 ikon berjajar
                'circle-radius': ['case', ['boolean', ['feature-state', 'active'], false], 22, 18], 
                'circle-stroke-width': ['case', ['boolean', ['feature-state', 'active'], false], 3, 1],
                'circle-stroke-color': ['case', ['boolean', ['feature-state', 'active'], false], '#007bff', '#cccccc'],
                'circle-opacity': 0.9,
                // Sedikit efek pitch-scaling agar marker tidak terlalu gepeng saat peta dimiringkan
                'circle-pitch-scale': 'viewport'
            }
        },

        // B. IKON CUACA (Kiri)
        {
            id: 'marker-symbol-weather',
            type: 'symbol',
            source: 'data-cuaca-source',
            filter: ['!', ['has', 'point_count']],
            layout: {
                // Ambil nama ikon dari feature-state yang disuntik di Tahap B. Fallback ke 'wi-na'
                'icon-image': ['coalesce', ['feature-state', 'icon_name'], 'wi-na'],
                'icon-size': 0.8,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-offset': [-32, 0] // Geser ke KIRI
            },
            paint: {
                'icon-opacity': ['case', ['boolean', ['feature-state', 'hasData'], false], 1, 0.5]
            }
        },

        // C. TERMOMETER FRAME (Tengah)
        {
            id: 'marker-symbol-thermo-ext',
            type: 'symbol',
            source: 'data-cuaca-source',
            filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': 'marker-thermometer-exterior', // Aset statis dari Tahap A
                'icon-size': 0.8,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-offset': [0, 0] // Tengah
            },
            paint: {
                'icon-opacity': ['case', ['boolean', ['feature-state', 'hasData'], false], 1, 0.5]
            }
        },

        // D. TERMOMETER ISI/MERCURY (Tengah - Berwarna)
        {
            id: 'marker-symbol-thermo-int',
            type: 'symbol',
            source: 'data-cuaca-source',
            filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': 'marker-thermometer-internal', // Aset SDF dari Tahap A
                'icon-size': 0.8,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-offset': [0, 0] // Tengah, menumpuk frame
            },
            paint: {
                // Ambil warna dari feature-state Tahap B
                'icon-color': ['coalesce', ['feature-state', 'temp_color'], '#cccccc'],
                'icon-opacity': ['case', ['boolean', ['feature-state', 'hasData'], false], 1, 0.5]
            }
        },

        // E. RAINDROP (Kanan - Berwarna)
        {
            id: 'marker-symbol-rain',
            type: 'symbol',
            source: 'data-cuaca-source',
            filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': 'marker-raindrop', // Aset SDF dari Tahap A
                'icon-size': 0.8,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-offset': [32, 0] // Geser ke KANAN
            },
            paint: {
                // Ambil warna dari feature-state Tahap B
                'icon-color': ['coalesce', ['feature-state', 'precip_color'], '#bdc3c7'],
                'icon-opacity': ['case', ['boolean', ['feature-state', 'hasData'], false], 1, 0.5]
            }
        },

        // F. LABEL TEKS (Bawah)
        {
            id: 'unclustered-point-label', 
            type: 'symbol', 
            source: 'data-cuaca-source', 
            filter: ['!', ['has', 'point_count']],
            layout: { 
                'text-field': ['get', 'nama_simpel'], 
                'text-font': ['Noto Sans Regular'], 
                'text-size': 10, 
                'text-anchor': 'top', 
                'text-offset': [0, 1.8], // Turunkan di bawah lingkaran
                'text-optional': false // Paksa tampil agar terlihat ramai
            },
            paint: { 
                'text-color': '#333', 
                'text-halo-color': '#fff', 
                'text-halo-width': 1.5 
            }
        }
    ]
};