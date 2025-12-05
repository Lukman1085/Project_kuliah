// =================================================================
// 🌍 KONFIGURASI SUMBER DATA PETA (DINAMIS)
// =================================================================

const COLORS = {
    provinsi: '#455A64',   
    kabupaten: '#90A4AE',  
    kecamatan: '#CFD8DC',  
    hover_fill: '#37474F'  
};

/**
 * 🎨 GET MAP STYLE FUNCTION
 * Fungsi ini mengembalikan objek style JSON secara dinamis.
 * Ia membaca 'window.APP_CONFIG.MAP_BASE_URL' yang disuntikkan oleh server.
 * Ini memungkinkan kita beralih antara File Lokal (Development) dan Supabase (Production)
 * tanpa mengubah kode JavaScript.
 */
export const getMapStyle = () => {
    
    // Ambil Base URL dari konfigurasi global (diset di index.html)
    // Jika tidak ada (fallback), gunakan path relatif lokal
    const baseUrl = (window.APP_CONFIG && window.APP_CONFIG.MAP_BASE_URL) 
        ? window.APP_CONFIG.MAP_BASE_URL 
        : '/static/maps';

    console.log("🗺️ Generating Map Style with Source:", baseUrl);

    return { 
        version: 8,
        glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
        
        sources: { 
            // 1. Basemap (Raster)
            'cartodb-positron-nolabels': { 
                type: 'raster', 
                tiles: ['https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'], 
                tileSize: 256, 
                attribution: '&copy; OSM &copy; CARTO' 
            },

            // 2. VECTOR SOURCE 1: PROVINSI (Zoom 4-7.99)
            'source_provinsi': { 
                type: 'vector', 
                // Konstruksi URL PMTiles: pmtiles:// + BASE_URL + /filename
                url: `pmtiles://${baseUrl}/batas_provinsi.pmtiles`, 
                attribution: 'BIG',
                promoteId: 'KDPPUM' 
            },

            // 3. VECTOR SOURCE 2: KABUPATEN/KOTA (Zoom 8-10.99)
            'source_kabupaten': { 
                type: 'vector', 
                url: `pmtiles://${baseUrl}/batas_kabupatenkota.pmtiles`, 
                attribution: 'BIG',
                promoteId: 'KDPKAB' 
            },

            // 4. VECTOR SOURCE 3: KECAMATAN (Zoom 11-14)
            'source_kecamatan': { 
                type: 'vector', 
                url: `pmtiles://${baseUrl}/batas_kecamatandistrik.pmtiles`, 
                attribution: 'BIG',
                promoteId: 'KDCPUM' 
            },

            // 5. Sumber Data Logika (GeoJSON)
            'data-cuaca-source': { 
                type: 'geojson', 
                data: { type: 'FeatureCollection', features: [] }, 
                cluster: true, clusterMaxZoom: 13, clusterRadius: 80, promoteId: 'id' 
            },
            'provinsi-source': { 
                type: 'geojson', 
                data: { type: 'FeatureCollection', features: [] }, 
                promoteId: 'id' 
            },
            'gempa-source': { 
                type: 'geojson', 
                data: { type: 'FeatureCollection', features: [] }, 
                promoteId: 'id' 
            }
        },

        layers: [ 
            // --- LAYER 1: BASEMAP ---
            { id: 'cartodb-positron-layer', type: 'raster', source: 'cartodb-positron-nolabels' },

            // --- LAYER PROVINSI (PMTILES) ---
            { 
                id: 'batas-provinsi-fill', type: 'fill', source: 'source_provinsi', 'source-layer': 'batas_provinsi', 
                minzoom: 4, maxzoom: 7.99, 
                paint: { 'fill-color': COLORS.hover_fill, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0] } 
            },
            { 
                id: 'batas-provinsi-layer', type: 'line', source: 'source_provinsi', 'source-layer': 'batas_provinsi', 
                minzoom: 4, maxzoom: 7.99, 
                layout: { 'line-join': 'round', 'line-cap': 'round' }, 
                paint: { 'line-color': COLORS.provinsi, 'line-width': 1.5, 'line-opacity': 0.8 } 
            },

            // --- LAYER KABUPATEN (PMTILES) ---
            { 
                id: 'batas-kabupaten-fill', type: 'fill', source: 'source_kabupaten', 'source-layer': 'batas_kabupatenkota', 
                minzoom: 8, maxzoom: 10.99, 
                paint: { 'fill-color': COLORS.hover_fill, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0] } 
            },
            { 
                id: 'batas-kabupaten-layer', type: 'line', source: 'source_kabupaten', 'source-layer': 'batas_kabupatenkota', 
                minzoom: 8, maxzoom: 10.99, 
                layout: { 'line-join': 'round', 'line-cap': 'round' }, 
                paint: { 'line-color': COLORS.kabupaten, 'line-width': 1, 'line-opacity': 0.7 } 
            },

            // --- LAYER KECAMATAN (PMTILES) ---
            { 
                id: 'batas-kecamatan-fill', type: 'fill', source: 'source_kecamatan', 'source-layer': 'batas_kecamatandistrik', 
                minzoom: 11, maxzoom: 14, 
                paint: { 'fill-color': COLORS.hover_fill, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0] } 
            },
            { 
                id: 'batas-kecamatan-layer', type: 'line', source: 'source_kecamatan', 'source-layer': 'batas_kecamatandistrik', 
                minzoom: 11, maxzoom: 14, 
                layout: { 'line-join': 'round', 'line-cap': 'round' }, 
                paint: { 'line-color': COLORS.kecamatan, 'line-width': 0.8, 'line-opacity': 0.9, 'line-dasharray': [2, 2] } 
            },

            // --- LAYER LOGIKA INTERAKSI ---
            { 
                id: 'provinsi-point-hit-target', type: 'circle', source: 'provinsi-source', 
                paint: { 'circle-radius': 12, 'circle-color': '#000000', 'circle-opacity': 0, 'circle-stroke-width': 0 } 
            },

            // --- LAYER GEMPA ---
            {
                id: 'gempa-pulse-layer', type: 'symbol', source: 'gempa-source', minzoom: 4,
                layout: {
                    'visibility': 'none', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
                    'icon-image': ['match', ['get', 'pulse_mode'], 'sonar', 'pulsing-dot-sonar', 'fast', 'pulsing-dot-fast', 'slow', 'pulsing-dot-slow', 'none', '', '']
                }
            },
            {
                id: 'gempa-point-layer', type: 'circle', source: 'gempa-source', minzoom: 4,
                layout: { 'visibility': 'none' },
                paint: {
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['interpolate', ['linear'], ['get', 'mag'], 4, 3, 8, 10], 10, ['interpolate', ['linear'], ['get', 'mag'], 4, 8, 8, 25]],
                    'circle-color': ['get', 'status_color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.9
                }
            },
            {
                id: 'gempa-label-layer', type: 'symbol', source: 'gempa-source', minzoom: 6,
                layout: { 'visibility': 'none', 'text-field': '{mag}', 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 0] },
                paint: { 'text-color': '#ffffff', 'text-halo-color': '#333333', 'text-halo-width': 1 }
            },

            // --- LAYER CLUSTER & CUACA ---
            { 
                id: 'cluster-background-layer', type: 'circle', source: 'data-cuaca-source', filter: ['has', 'point_count'], 
                paint: { 'circle-radius': ['step', ['get', 'point_count'], 20, 50, 25, 200, 30], 'circle-color': ['step', ['get', 'point_count'], '#4FC3F7', 50, '#FFD54F', 200, '#F06292'], 'circle-stroke-width': 3, 'circle-stroke-color': 'rgba(255,255,255,0.8)', 'circle-opacity': 0.95 } 
            },
            { 
                id: 'cluster-count-layer', type: 'symbol', source: 'data-cuaca-source', filter: ['has', 'point_count'], 
                layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-offset': [0, 0] }, 
                paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.2)', 'text-halo-width': 1 } 
            },
            { 
                id: 'unclustered-point-hit-target', type: 'circle', source: 'data-cuaca-source', filter: ['!', ['has', 'point_count']], 
                paint: { 'circle-color': '#ff0000', 'circle-radius': 6, 'circle-opacity': 0, 'circle-stroke-width': 0 } 
            }
        ]
    };
};