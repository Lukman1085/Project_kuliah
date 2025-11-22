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
            // [PENTING] Mapping properti ID agar Feature State (Hover) berfungsi
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
        } 
    },
    layers: [ 
        // --- LAYER 1: BASEMAP ---
        { id: 'cartodb-positron-layer', type: 'raster', source: 'cartodb-positron-nolabels' },

        // --- LAYER 2: INTERACTION FILLS (Hover Effect) ---
        // Layer ini transparan secara default (opacity 0), 
        // hanya muncul (opacity 0.1) saat state 'hover' bernilai true.
        {
            id: 'batas-provinsi-fill',
            type: 'fill',
            source: 'batas-wilayah-vector',
            'source-layer': 'batas_provinsi',
            minzoom: 4, maxzoom: 7.99,
            paint: {
                'fill-color': COLORS.hover_fill,
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.1, // Opacity saat hover (tipis)
                    0    // Opacity normal (invisible)
                ]
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
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.1,
                    0
                ]
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
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.1,
                    0
                ]
            }
        },

        // --- LAYER 3: BOUNDARY LINES (Aesthetic) ---
        { 
            id: 'batas-provinsi-layer', 
            type: 'line', 
            source: 'batas-wilayah-vector', 
            'source-layer': 'batas_provinsi', 
            minzoom: 4, maxzoom: 7.99, 
            layout: {
                'line-join': 'round', // Membuat sudut tumpul (organik)
                'line-cap': 'round'
            },
            paint: { 
                'line-color': COLORS.provinsi, 
                'line-width': 1.5, 
                'line-opacity': 0.8 
            }
        },
        { 
            id: 'batas-kabupaten-layer', 
            type: 'line', 
            source: 'batas-wilayah-vector', 
            'source-layer': 'batas_kabupatenkota', 
            minzoom: 8, maxzoom: 10.99, 
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: { 
                'line-color': COLORS.kabupaten, 
                'line-width': 0.8, 
                'line-opacity': 0.7 
            }
        },
        { 
            id: 'batas-kecamatan-layer', 
            type: 'line', 
            source: 'batas-wilayah-vector', 
            'source-layer': 'batas_kecamatandistrik', 
            minzoom: 11, maxzoom: 14, 
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: { 
                'line-color': COLORS.kecamatan, 
                'line-width': 0.5, 
                'line-opacity': 0.6,
                'line-dasharray': [2, 2] // Garis putus-putus halus
            }
        },
        
        // --- LAYER 4: HIT TARGETS (Invisible but functional) ---
        { 
            id: 'provinsi-point-hit-target', 
            type: 'circle', 
            source: 'provinsi-source', 
            paint: { 
                'circle-radius': 12, 
                'circle-color': '#000000', 
                'circle-opacity': 0, 
                'circle-stroke-width': 0 
            }
        },

        // --- LAYER 5: CLUSTERS ---
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
        
        // --- LAYER 6: UNCLUSTERED (Fallback) ---
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