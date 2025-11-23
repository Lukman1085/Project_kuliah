const protocol = window.location.protocol;
const hostname = window.location.hostname;
const port = '5000';
const baseUrl = `${protocol}//${hostname}:${port}`;

/**
 * 🎨 MAP STYLE CONFIGURATION
 * Gaya: "Modern Muted Atlas"
 * Filosofi: Minimalis, Monokromatik, Data-Centric.
 * Peta dasar diredupkan agar Marker Cuaca menjadi fokus utama.
 */

// --- PALET WARNA (Slate / Blue Grey) ---
const COLORS = {
    provinsi: '#455A64',   // Gelap, Tegas
    kabupaten: '#90A4AE',  // Medium, Netral
    kecamatan: '#CFD8DC',  // Terang, Halus
    hover_fill: '#37474F'  // Warna isi saat di-hover (Gelap)
};

export const MAP_STYLE = { 
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sources: { 
        // 1. Base Raster (Ringan, Cacheable, Gratis)
        'cartodb-positron-nolabels': { 
            type: 'raster', 
            tiles: ['https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'], 
            tileSize: 256, 
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO' 
        },
        
        // 2. Vector Tiles Batas Wilayah (Lokal)
        'batas-wilayah-vector': { 
            type: 'vector', 
            tiles: [`${baseUrl}/tiles/{z}/{x}/{y}.pbf`], 
            minzoom: 4, 
            maxzoom: 14, 
            attribution: 'Data Batas Wilayah BIG',
            promoteId: {
                'batas_provinsi': 'KDPPUM',
                'batas_kabupatenkota': 'KDPKAB',
                'batas_kecamatandistrik': 'KDCPUM'
            }
        },
        
        // 3. GeoJSON Data Cuaca (Cluster/Markers)
        'data-cuaca-source': { 
            type: 'geojson', 
            data: { type: 'FeatureCollection', features: [] }, 
            cluster: true, 
            clusterMaxZoom: 13, 
            clusterRadius: 80, 
            promoteId: 'id' 
        },
        
        // 4. GeoJSON Provinsi Helper (Untuk Hit Target / Fallback)
        'provinsi-source': { 
            type: 'geojson', 
            data: { type: 'FeatureCollection', features: [] }, 
            promoteId: 'id' 
        },

        // 5. [BARU] GeoJSON Data Gempa (Combined BMKG & USGS)
        'gempa-source': {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            promoteId: 'id'
        }
    },
    layers: [ 
        // --- LAYER 1: BASEMAP ---
        { id: 'cartodb-positron-layer', type: 'raster', source: 'cartodb-positron-nolabels' },

        // --- LAYER 2: INTERACTION FILLS (Hover Effect) ---
        {
            id: 'batas-provinsi-fill',
            type: 'fill',
            source: 'batas-wilayah-vector',
            'source-layer': 'batas_provinsi',
            minzoom: 4, maxzoom: 7.99,
            paint: {
                'fill-color': COLORS.hover_fill,
                'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0]
            }
        },
        {
            id: 'batas-kabupaten-fill',
            type: 'fill',
            source: 'batas-wilayah-vector',
            'source-layer': 'batas_kabupatenkota',
            minzoom: 8, maxzoom: 10.99,
            paint: {
                'fill-color': COLORS.hover_fill,
                'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0]
            }
        },
        {
            id: 'batas-kecamatan-fill',
            type: 'fill',
            source: 'batas-wilayah-vector',
            'source-layer': 'batas_kecamatandistrik',
            minzoom: 11, maxzoom: 14,
            paint: {
                'fill-color': COLORS.hover_fill,
                'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0]
            }
        },

        // --- LAYER 3: BOUNDARY LINES (Aesthetic) ---
        { 
            id: 'batas-provinsi-layer', 
            type: 'line', 
            source: 'batas-wilayah-vector', 
            'source-layer': 'batas_provinsi', 
            minzoom: 4, maxzoom: 7.99, 
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': COLORS.provinsi, 'line-width': 1.5, 'line-opacity': 0.8 }
        },
        { 
            id: 'batas-kabupaten-layer', 
            type: 'line', 
            source: 'batas-wilayah-vector', 
            'source-layer': 'batas_kabupatenkota', 
            minzoom: 8, maxzoom: 10.99, 
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': COLORS.kabupaten, 'line-width': 1, 'line-opacity': 0.7 }
        },
        { 
            id: 'batas-kecamatan-layer', 
            type: 'line', 
            source: 'batas-wilayah-vector', 
            'source-layer': 'batas_kecamatandistrik', 
            minzoom: 11, maxzoom: 14, 
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': COLORS.kecamatan, 'line-width': 0.8, 'line-opacity': 0.9, 'line-dasharray': [2, 2] }
        },
        
        // --- LAYER 4: HIT TARGETS ---
        { 
            id: 'provinsi-point-hit-target', 
            type: 'circle', 
            source: 'provinsi-source', 
            paint: { 'circle-radius': 12, 'circle-color': '#000000', 'circle-opacity': 0, 'circle-stroke-width': 0 }
        },

        // --- [BARU] LAYER GEMPA (EARTHQUAKE) ---
        // Layer ini akan di-toggle (visible/none) lewat map_manager
        
        // [REVISI] Layer Heatmap DIHAPUS demi kejelasan data.

        // B. Layer Pulsa Gempa (Menggunakan Animated Image Selektif)
        {
            id: 'gempa-pulse-layer',
            type: 'symbol',
            source: 'gempa-source',
            minzoom: 4,
            layout: {
                'visibility': 'none', // Default mati
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                // [REVISI] Seleksi Ikon Berdasarkan Bahaya
                'icon-image': [
                    'case',
                    ['any', ['>=', ['get', 'mag'], 6], ['==', ['get', 'tsunami'], true]], 'pulsing-dot-danger', // Bahaya Tinggi -> Merah
                    ['>=', ['get', 'mag'], 4], 'pulsing-dot-warning', // Menengah -> Kuning
                    '' // Kecil -> Tidak ada pulsa (mengurangi noise)
                ]
            }
        },

        // C. Lingkaran Gempa Utama (Zoom > 4)
        {
            id: 'gempa-point-layer',
            type: 'circle',
            source: 'gempa-source',
            minzoom: 4,
            layout: { 'visibility': 'none' }, // Default mati
            paint: {
                // Radius berdasarkan Magnitudo
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    4, ['interpolate', ['linear'], ['get', 'mag'], 4, 3, 8, 10],
                    10, ['interpolate', ['linear'], ['get', 'mag'], 4, 8, 8, 25]
                ],
                // [REVISI] Warna berdasarkan Kedalaman (Depth) - Sesuai Laporan Teknis
                'circle-color': [
                    'step', ['get', 'depth_km'],
                    '#d32f2f', // Merah (Dangkal < 70km) -> Bahaya
                    70, '#fbc02d', // Kuning (Menengah 70-300km) -> Waspada
                    300, '#1976d2' // Biru (Dalam > 300km) -> Relatif Aman
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1.5,
                'circle-opacity': 0.9
            }
        },

        // D. Label Magnitudo Gempa (Zoom > 6)
        {
            id: 'gempa-label-layer',
            type: 'symbol',
            source: 'gempa-source',
            minzoom: 6,
            layout: {
                'visibility': 'none', // Default mati
                'text-field': '{mag}',
                'text-font': ['Noto Sans Regular'],
                'text-size': 11,
                'text-offset': [0, 0]
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#333333',
                'text-halo-width': 1
            }
        },

        // --- LAYER 6: CLUSTERS (Cuaca) ---
        { 
            id: 'cluster-background-layer', 
            type: 'circle', 
            source: 'data-cuaca-source', 
            filter: ['has', 'point_count'], 
            paint: { 
                'circle-radius': ['step', ['get', 'point_count'], 20, 50, 25, 200, 30], 
                'circle-color': ['step', ['get', 'point_count'], '#4FC3F7', 50, '#FFD54F', 200, '#F06292'], 
                'circle-stroke-width': 3, 
                'circle-stroke-color': 'rgba(255,255,255,0.8)', 
                'circle-opacity': 0.95 
            }
        },
        { 
            id: 'cluster-count-layer', 
            type: 'symbol', 
            source: 'data-cuaca-source', 
            filter: ['has', 'point_count'], 
            layout: { 
                'text-field': '{point_count_abbreviated}', 
                'text-font': ['Noto Sans Regular'], 
                'text-size': 13, 
                'text-offset': [0, 0]
            }, 
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(0,0,0,0.2)',
                'text-halo-width': 1
            } 
        },
        
        // --- LAYER 7: UNCLUSTERED (Cuaca) ---
        {
            id: 'unclustered-point-hit-target', 
            type: 'circle', 
            source: 'data-cuaca-source', 
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': '#ff0000', 
                'circle-radius': 6, 
                'circle-opacity': 0, 
                'circle-stroke-width': 0
            }
        }
    ]
};