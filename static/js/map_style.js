const protocol = window.location.protocol;
const hostname = window.location.hostname;
const port = '5000';
const baseUrl = `${protocol}//${hostname}:${port}`;

/**
 * 🎨 MAP STYLE CONFIGURATION
 * Gaya: "Modern Muted Atlas"
 * Filosofi: Minimalis, Monokromatik, Data-Centric.
 */

// --- PALET WARNA (Slate / Blue Grey) ---
const COLORS = {
    provinsi: '#455A64',   
    kabupaten: '#90A4AE',  
    kecamatan: '#CFD8DC',  
    hover_fill: '#37474F'  
};

export const MAP_STYLE = { 
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sources: { 
        'cartodb-positron-nolabels': { type: 'raster', tiles: ['https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OSM &copy; CARTO' },
        'batas-wilayah-vector': { 
            type: 'vector', tiles: [`${baseUrl}/tiles/{z}/{x}/{y}.pbf`], minzoom: 4, maxzoom: 14, attribution: 'BIG',
            promoteId: { 'batas_provinsi': 'KDPPUM', 'batas_kabupatenkota': 'KDPKAB', 'batas_kecamatandistrik': 'KDCPUM' }
        },
        'data-cuaca-source': { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 13, clusterRadius: 80, promoteId: 'id' },
        'provinsi-source': { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' },
        'gempa-source': { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' }
    },
    layers: [ 
        // --- LAYER 1: BASEMAP ---
        { id: 'cartodb-positron-layer', type: 'raster', source: 'cartodb-positron-nolabels' },

        // --- LAYER INTERAKSI & BATAS WILAYAH (SAMA) ---
        { id: 'batas-provinsi-fill', type: 'fill', source: 'batas-wilayah-vector', 'source-layer': 'batas_provinsi', minzoom: 4, maxzoom: 7.99, paint: { 'fill-color': COLORS.hover_fill, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0] } },
        { id: 'batas-kabupaten-fill', type: 'fill', source: 'batas-wilayah-vector', 'source-layer': 'batas_kabupatenkota', minzoom: 8, maxzoom: 10.99, paint: { 'fill-color': COLORS.hover_fill, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0] } },
        { id: 'batas-kecamatan-fill', type: 'fill', source: 'batas-wilayah-vector', 'source-layer': 'batas_kecamatandistrik', minzoom: 11, maxzoom: 14, paint: { 'fill-color': COLORS.hover_fill, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0] } },
        { id: 'batas-provinsi-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_provinsi', minzoom: 4, maxzoom: 7.99, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': COLORS.provinsi, 'line-width': 1.5, 'line-opacity': 0.8 } },
        { id: 'batas-kabupaten-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_kabupatenkota', minzoom: 8, maxzoom: 10.99, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': COLORS.kabupaten, 'line-width': 1, 'line-opacity': 0.7 } },
        { id: 'batas-kecamatan-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_kecamatandistrik', minzoom: 11, maxzoom: 14, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': COLORS.kecamatan, 'line-width': 0.8, 'line-opacity': 0.9, 'line-dasharray': [2, 2] } },
        { id: 'provinsi-point-hit-target', type: 'circle', source: 'provinsi-source', paint: { 'circle-radius': 12, 'circle-color': '#000000', 'circle-opacity': 0, 'circle-stroke-width': 0 } },

        // --- [MODIFIKASI] LAYER GEMPA CERDAS (SMART EARTHQUAKE LAYER) ---
        
        // A. Layer Pulsa Dinamis (Sesuai Pulse Mode dari Backend)
        {
            id: 'gempa-pulse-layer',
            type: 'symbol',
            source: 'gempa-source',
            minzoom: 4,
            layout: {
                'visibility': 'none',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                // Logika Pemilihan Ikon berdasarkan Properti Backend
                'icon-image': [
                    'match', ['get', 'pulse_mode'],
                    'sonar', 'pulsing-dot-sonar', // Tsunami -> Sonar
                    'fast', 'pulsing-dot-fast',   // Kuat -> Cepat
                    'slow', 'pulsing-dot-slow',   // Sedang -> Lambat
                    'none', '',                   // Lemah -> Tidak ada pulsa
                    '' // Default fallback
                ]
            }
        },

        // B. Lingkaran Utama (Warna berdasarkan Status Dampak)
        {
            id: 'gempa-point-layer',
            type: 'circle',
            source: 'gempa-source',
            minzoom: 4,
            layout: { 'visibility': 'none' },
            paint: {
                // Radius tetap berdasarkan Magnitudo (Energi Fisik)
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    4, ['interpolate', ['linear'], ['get', 'mag'], 4, 3, 8, 10],
                    10, ['interpolate', ['linear'], ['get', 'mag'], 4, 8, 8, 25]
                ],
                // Warna berdasarkan Status Dampak (Manusiawi) - Dikirim Backend
                'circle-color': ['get', 'status_color'], 
                
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1.5,
                'circle-opacity': 0.9
            }
        },

        // C. Label Magnitudo (Opsional, hanya muncul saat zoom in)
        {
            id: 'gempa-label-layer',
            type: 'symbol',
            source: 'gempa-source',
            minzoom: 6,
            layout: {
                'visibility': 'none',
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

        // --- LAYER CLUSTER & CUACA (SAMA) ---
        { id: 'cluster-background-layer', type: 'circle', source: 'data-cuaca-source', filter: ['has', 'point_count'], paint: { 'circle-radius': ['step', ['get', 'point_count'], 20, 50, 25, 200, 30], 'circle-color': ['step', ['get', 'point_count'], '#4FC3F7', 50, '#FFD54F', 200, '#F06292'], 'circle-stroke-width': 3, 'circle-stroke-color': 'rgba(255,255,255,0.8)', 'circle-opacity': 0.95 } },
        { id: 'cluster-count-layer', type: 'symbol', source: 'data-cuaca-source', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-offset': [0, 0] }, paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.2)', 'text-halo-width': 1 } },
        { id: 'unclustered-point-hit-target', type: 'circle', source: 'data-cuaca-source', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#ff0000', 'circle-radius': 6, 'circle-opacity': 0, 'circle-stroke-width': 0 } }
    ]
};