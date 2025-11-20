// --- REFAKTOR (TAHAP D: HTML MARKER SETUP) ---

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
        
        // 2. Provinsi Points (TETAP - Lingkaran Sederhana)
        { id: 'provinsi-point-circle', type: 'circle', source: 'provinsi-source', paint: { 'circle-radius': 7, 'circle-color': 'rgba(255, 255, 255, 0.6)', 'circle-stroke-color': '#333', 'circle-stroke-width': 1 }},
        { 
            id: 'provinsi-point-label', 
            type: 'symbol', 
            source: 'provinsi-source', 
            layout: { 'text-field': ['get', 'nama_simpel'], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-anchor': 'left', 'text-offset': [0.8, 0], 'text-optional': true }, 
            paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
        },

        // 3. Cluster Bubbles (TETAP)
        { id: 'cluster-background-layer', type: 'circle', source: 'data-cuaca-source', filter: ['has', 'point_count'], paint: { 'circle-radius': ['step', ['get', 'point_count'], 18, 50, 22, 200, 26], 'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 50, '#f1f075', 200, '#f28cb1'], 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': 0.9 }},
        { id: 'cluster-count-layer', type: 'symbol', source: 'data-cuaca-source', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Noto Sans Regular'], 'text-size': 12 }, paint: {'text-color': '#333333', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5, 'text-halo-blur': 1 } },
        
        // 4. UNCLUSTERED POINTS (INVISIBLE HIT TARGET)
        // Ini penting! Kita butuh layer ini agar queryRenderedFeatures bisa menemukan titiknya,
        // meskipun titiknya tidak terlihat (opacity 0). HTML Marker akan ditempel di koordinat ini.
        {
            id: 'unclustered-point-hit-target', 
            type: 'circle', 
            source: 'data-cuaca-source', 
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': '#ff0000', // Warna debug (tidak akan terlihat krn opacity 0)
                'circle-radius': 5, 
                'circle-opacity': 0, // INVISIBLE
                'circle-stroke-width': 0
            }
        }
    ]
};