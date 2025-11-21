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
        
        // [PERBAIKAN] Tambahkan promoteId: 'id' agar queryRenderedFeatures mengembalikan ID yang benar
        'provinsi-source': { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' } 
    },
    layers: [ 
        // 1. Base Tiles & Boundaries
        { id: 'cartodb-positron-layer', type: 'raster', source: 'cartodb-positron-nolabels' },
        { id: 'batas-provinsi-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_provinsi', minzoom: 5, maxzoom: 7.99, paint: { 'line-color': '#A0522D', 'line-width': 1.5, 'line-opacity': 0.7 }},
        { id: 'batas-kabupaten-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_kabupatenkota', minzoom: 8, maxzoom: 10.99, paint: { 'line-color': '#4682B4', 'line-width': 1, 'line-opacity': 0.6 }},
        { id: 'batas-kecamatan-layer', type: 'line', source: 'batas-wilayah-vector', 'source-layer': 'batas_kecamatandistrik', minzoom: 11, maxzoom: 14, paint: { 'line-color': '#556B2F', 'line-width': 0.8, 'line-opacity': 0.5 }},
        
        // 2. Provinsi Points (Invisible Hit Target - Dihandle HTML Marker)
        { 
            id: 'provinsi-point-hit-target', 
            type: 'circle', 
            source: 'provinsi-source', 
            paint: { 
                'circle-radius': 10, // Sedikit diperbesar agar mudah diklik
                'circle-color': '#ff0000', 
                'circle-opacity': 0, 
                'circle-stroke-width': 0 
            }
        },

        // 3. CLUSTER BUBBLES (MODERN)
        { 
            id: 'cluster-background-layer', 
            type: 'circle', 
            source: 'data-cuaca-source', 
            filter: ['has', 'point_count'], 
            paint: { 
                'circle-radius': ['step', ['get', 'point_count'], 20, 50, 25, 200, 30], 
                'circle-color': ['step', ['get', 'point_count'], '#4FC3F7', 50, '#FFD54F', 200, '#F06292'], 
                'circle-stroke-width': 4, 
                'circle-stroke-color': 'rgba(255,255,255,0.6)', 
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
                'text-size': 14, 
                'text-offset': [0, 0]
            }, 
            paint: {
                'text-color': '#ffffff', 
                'text-halo-color': 'rgba(0,0,0,0.3)', 
                'text-halo-width': 1, 
                'text-halo-blur': 0.5 
            } 
        },
        
        // 4. UNCLUSTERED POINTS (INVISIBLE HIT TARGET)
        {
            id: 'unclustered-point-hit-target', 
            type: 'circle', 
            source: 'data-cuaca-source', 
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': '#ff0000', 
                'circle-radius': 5, 
                'circle-opacity': 0, 
                'circle-stroke-width': 0
            }
        }
    ]
};