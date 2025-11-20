const protocol = window.location.protocol;
const hostname = window.location.hostname;
const port = '5000';
const baseUrl = `${protocol}//${hostname}:${port}`;

export const MAP_STYLE = { 
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sources: { 
        'cartodb-positron-nolabels': { type: 'raster', tiles: ['https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OSM &copy; CARTO' },
        'batas-wilayah-vector': { type: 'vector', tiles: [`${baseUrl}/tiles/{z}/{x}/{y}.pbf`], minzoom: 4, maxzoom: 14 },
        'data-cuaca-source': { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 13, clusterRadius: 80 },
        'provinsi-source': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
    },
    layers: [ 
        { id: 'cartodb-positron-layer', type: 'raster', source: 'cartodb-positron-nolabels' },
        
        // --- Layer Batas Wilayah ---
        { id: 'batas-provinsi-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_provinsi', minzoom: 5, paint: { 'line-color': '#A0522D', 'line-width': 1.5, 'line-opacity': 0.7 }},
        { id: 'batas-kabupaten-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_kabupatenkota', minzoom: 8, paint: { 'line-color': '#4682B4', 'line-width': 1, 'line-opacity': 0.6 }},
        { id: 'batas-kecamatan-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_kecamatandistrik', minzoom: 11, paint: { 'line-color': '#556B2F', 'line-width': 0.8, 'line-opacity': 0.5 }},

        // --- Layer Provinsi Point (Non-Interaktif) ---
        { id: 'provinsi-point-circle', type: 'circle', source: 'provinsi-source', paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#333', 'circle-stroke-width': 1 }},
        { id: 'provinsi-point-label', type: 'symbol', source: 'provinsi-source', layout: { 'text-field': ['get', 'nama_simpel'], 'text-size': 10, 'text-offset': [0, 1] }, paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1 }},

        // --- Layer Cluster ---
        { id: 'cluster-background-layer', type: 'circle', source: 'data-cuaca-source', filter: ['has', 'point_count'], paint: { 'circle-radius': 20, 'circle-color': '#51bbd6' }},
        { id: 'cluster-count-layer', type: 'symbol', source: 'data-cuaca-source', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 } },

        // ============================================================
        // 🎨 DESAIN "SMART STACK" (TUMPUKAN CERDAS)
        // ============================================================

        // 1. LAYER DASAR: JANGKAR LINGKARAN (Warna Suhu)
        {
            id: 'marker-anchor-circle',
            type: 'circle',
            source: 'data-cuaca-source',
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': ['case',
                    ['boolean', ['feature-state', 'hasData'], false],
                    ['step', ['feature-state', 'suhu'], 
                        '#3498db', 20, '#2ecc71', 25, '#f1c40f', 30, '#e67e22', 33, '#e74c3c'
                    ],
                    '#95a5a6'
                ],
                'circle-radius': ['case', ['boolean', ['feature-state', 'active'], false], 9, 6],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-opacity': 0.9
            }
        },

        // 2. LAYER TEKS: NAMA WILAYAH
        {
            id: 'marker-label',
            type: 'symbol',
            source: 'data-cuaca-source',
            filter: ['!', ['has', 'point_count']],
            layout: {
                'text-field': ['get', 'nama_simpel'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 11,
                'text-anchor': 'bottom',
                'text-offset': [0, -1.2],
                'text-ignore-placement': false,
                'text-optional': true
            },
            paint: {
                'text-color': '#2c3e50',
                'text-halo-color': '#ffffff',
                'text-halo-width': 2,
                'text-halo-blur': 0.5
            }
        },

        // 3. LAYER IKON: CUACA (KIRI ATAS)
        {
            id: 'marker-icon-weather',
            type: 'symbol',
            source: 'data-cuaca-source',
            filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': ['get', 'weather_icon'], 
                'icon-size': 0.7,
                'icon-anchor': 'bottom',
                'icon-offset': [-25, -35],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            },
            paint: {
                'icon-opacity': ['case', ['boolean', ['feature-state', 'hasData'], false], 1, 0]
            }
        },

        // 4. LAYER IKON: TERMOMETER (TENGAH ATAS)
        {
            id: 'marker-icon-temp',
            type: 'symbol',
            source: 'data-cuaca-source',
            filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': 'icon-thermometer',
                'icon-size': 0.6,
                'icon-anchor': 'bottom',
                'icon-offset': [0, -35],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            },
            paint: {
                'icon-color': ['step', ['feature-state', 'suhu'], 
                    '#3498db', 20, '#2ecc71', 25, '#f1c40f', 30, '#e67e22', 33, '#e74c3c'
                ],
                'icon-opacity': ['case', ['boolean', ['feature-state', 'hasData'], false], 1, 0]
            }
        },

        // 5. LAYER IKON: HUJAN (KANAN ATAS)
        {
            id: 'marker-icon-precip',
            type: 'symbol',
            source: 'data-cuaca-source',
            filter: ['!', ['has', 'point_count']],
            layout: {
                'icon-image': 'icon-raindrop',
                'icon-size': 0.6,
                'icon-anchor': 'bottom',
                'icon-offset': [25, -35],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            },
            paint: {
                'icon-color': '#3498db',
                'icon-opacity': ['interpolate', ['linear'], ['feature-state', 'precip'],
                    0, 0.0, 10, 0.3, 50, 0.8, 100, 1.0
                ]
            }
        }
    ]
};