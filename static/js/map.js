// ============================= INISIALISASI PETA =============================
// Inisialisasi peta MapLibre
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {},
        layers: []
    },
    center: [118, -2], // Center di tengah Indonesia
    zoom: 4.5,
    minZoom: 4,
    maxZoom: 14
});

// Tambahkan kontrol navigasi (zoom, rotasi)
map.addControl(new maplibregl.NavigationControl(), 'top-right');
// Tambahkan kontrol skala
map.addControl(new maplibregl.ScaleControl());

// ============================= VARIABEL GLOBAL & STATE =============================
// Objek untuk menyimpan layer marker untuk setiap level
const markerLayers = {
    provinsi: null,
    kabupaten: null,
    kecamatan: null
};

// Objek untuk menyimpan instance MarkerClusterGroup
const markerClusters = {
    kabupaten: null,
    kecamatan: null
};

// Cache untuk menyimpan data marker yang sudah diambil
const markerDataCache = {
    provinsi: null, // Data provinsi dimuat sekali saja
    kabupaten: {},
    kecamatan: {}
};

// Menyimpan ID request yang sedang berjalan untuk menghindari panggilan ganda
let currentUpdateRequestId = 0;

// ============================= FUNGSI UTAMA PETA =============================

// Fungsi untuk membuat popup cuaca
function createWeatherPopup(feature) {
    const props = feature.properties;
    let content = `
        <div class="weather-popup">
            <h4>${props.nama}</h4>
            <p><strong>Cuaca:</strong> ${props.cuaca}</p>
            <p><strong>Suhu:</strong> ${props.suhu}°C (Terasa ${props.terasa.toFixed(1)}°C)</p>
            <p><strong>Kelembapan:</strong> ${props.kelembapan}%</p>
        </div>
    `;
    return new maplibregl.Popup({ offset: 25 }).setHTML(content);
}

// Fungsi untuk membuat marker HTML kustom
function createCustomMarker(color) {
    const el = document.createElement('div');
    el.className = 'custom-marker';
    el.style.backgroundColor = color;
    return el;
}

// Fungsi untuk mengambil data cuaca untuk marker yang terlihat
async function fetchVisibleWeatherData(bbox, zoom) {
    const requestId = ++currentUpdateRequestId;
    try {
        const url = new URL(`${window.location.origin}/api/data-cuaca`);
        url.searchParams.append('bbox', bbox.join(','));
        url.searchParams.append('zoom', zoom);

        const response = await fetch(url);
        if (!response.ok) throw new Error('Gagal mengambil data cuaca');
        
        const weatherData = await response.json();

        // Hanya proses respons jika ini adalah request terbaru
        if (requestId === currentUpdateRequestId) {
            updateMarkers(weatherData, zoom);
        }
    } catch (error) {
        console.error("Error fetching weather data:", error);
    }
}

// Fungsi untuk mengambil data cuaca berdasarkan ID (untuk cluster)
async function fetchWeatherDataByIds(ids, layerName) {
    try {
        const url = new URL(`${window.location.origin}/api/data-by-ids`);
        url.searchParams.append('ids', ids.join(','));
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('Gagal mengambil data berdasarkan ID');
        
        const weatherData = await response.json();
        
        // Tampilkan popup list untuk cluster
        displayClusterList(weatherData, layerName);

    } catch (error) {
        console.error("Error fetching data by IDs:", error);
    }
}

// Fungsi untuk memperbarui marker di peta
function updateMarkers(weatherData, zoom) {
    let targetLayer = null;
    let targetCache = null;
    let color = 'blue';
    let isCluster = false;

    if (zoom >= 5 && zoom < 8) {
        targetLayer = markerLayers.provinsi;
        targetCache = markerDataCache.provinsi; // Ini adalah array, bukan objek
        color = '#ff7f50'; // Coral
    } else if (zoom >= 8 && zoom <= 10) {
        targetLayer = markerClusters.kabupaten;
        targetCache = markerDataCache.kabupaten;
        color = '#20b2aa'; // LightSeaGreen
        isCluster = true;
    } else if (zoom >= 11 && zoom <= 14) {
        targetLayer = markerClusters.kecamatan;
        targetCache = markerDataCache.kecamatan;
        color = '#9370db'; // MediumPurple
        isCluster = true;
    }

    if (!targetLayer) return;

    const newMarkers = [];
    for (const id in weatherData) {
        // Untuk cluster, cache diindeks oleh ID. Untuk provinsi, kita tidak cache marker individual.
        if (!isCluster || !targetCache[id]) { 
            const data = weatherData[id];
            const markerEl = createCustomMarker(color);
            
            // Pastikan data.lon dan data.lat ada
            if (data.lon === undefined || data.lat === undefined) {
                console.error("Data marker tidak valid, lon/lat tidak ditemukan:", data);
                continue; // Lewati marker ini
            }

            const marker = new maplibregl.Marker(markerEl)
                .setLngLat([data.lon, data.lat])
                .setPopup(createWeatherPopup({ properties: data }));
            
            marker.properties = data; 
            
            if (isCluster) {
                targetCache[id] = marker;
            }
            newMarkers.push(marker);
        }
    }

    if (newMarkers.length > 0) {
        if (isCluster) {
            // Konversi ke Leaflet marker untuk MarkerClusterGroup
            const leafletMarkers = newMarkers.map(m => {
                const latLng = m.getLngLat();
                const leafletMarker = L.marker([latLng.lat, latLng.lng], {
                    icon: L.divIcon({
                        html: m.getElement().outerHTML,
                        className: '', // Kosongkan agar tidak ada style default leaflet
                        iconSize: [30, 30] // Sesuaikan ukuran
                    })
                });
                leafletMarker.bindPopup(m.getPopup()._content);
                leafletMarker.properties = m.properties;
                return leafletMarker;
            });
            targetLayer.addLayers(leafletMarkers);
        } else {
            // Untuk provinsi, kita tambahkan langsung ke layer group biasa
            const leafletMarkers = newMarkers.map(m => {
                 const latLng = m.getLngLat();
                 return L.marker([latLng.lat, latLng.lng]).setPopup(m.getPopup());
            });
            leafletMarkers.forEach(lm => targetLayer.addLayer(lm));
        }
    }
}

// Fungsi untuk mengelola visibilitas layer berdasarkan zoom
function manageLayerVisibility() {
    const zoom = map.getZoom();
    const leafletMap = map.getMapboxLeaflet();

    // Provinsi (Zoom 5-7)
    if (zoom >= 5 && zoom < 8) {
        if (!leafletMap.hasLayer(markerLayers.provinsi)) {
            leafletMap.addLayer(markerLayers.provinsi);
            loadProvinsiData(); // Panggil pemuatan data di sini
        }
    } else {
        if (leafletMap.hasLayer(markerLayers.provinsi)) {
            leafletMap.removeLayer(markerLayers.provinsi);
        }
    }

    // Kabupaten (Zoom 8-10)
    if (zoom >= 8 && zoom <= 10) {
        if (!leafletMap.hasLayer(markerClusters.kabupaten)) {
            leafletMap.addLayer(markerClusters.kabupaten);
        }
    } else {
        if (leafletMap.hasLayer(markerClusters.kabupaten)) {
            leafletMap.removeLayer(markerClusters.kabupaten);
        }
    }

    // Kecamatan (Zoom 11-14)
    if (zoom >= 11 && zoom <= 14) {
        if (!leafletMap.hasLayer(markerClusters.kecamatan)) {
            leafletMap.addLayer(markerClusters.kecamatan);
        }
    } else {
        if (leafletMap.hasLayer(markerClusters.kecamatan)) {
            leafletMap.removeLayer(markerClusters.kecamatan);
        }
    }
    
    // Panggil pembaruan data setelah visibilitas diatur
    updateMapData();
}

// Fungsi utama untuk memuat data saat peta bergerak atau zoom berubah
function updateMapData() {
    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const zoom = Math.floor(map.getZoom());
    
    // Hanya ambil data jika zoom berada dalam rentang yang ditentukan
    if (zoom >= 8) {
       fetchVisibleWeatherData(bbox, zoom);
    }
}

// Fungsi untuk memuat data provinsi sekali saja
async function loadProvinsiData() {
    // Cek jika layer sudah punya marker, jangan muat ulang
    if (markerLayers.provinsi && markerLayers.provinsi.getLayers().length > 0) return;

    try {
        const response = await fetch('/api/provinsi-info');
        if (!response.ok) throw new Error('Gagal mengambil info provinsi');
        const data = await response.json();
        
        const markers = data.map(prov => {
            if (prov.lon === undefined || prov.lat === undefined) {
                console.error("Data provinsi tidak valid:", prov);
                return null;
            }
            const markerEl = createCustomMarker('#ff7f50'); // Coral
            const mapboxMarker = new maplibregl.Marker(markerEl)
                .setLngLat([prov.lon, prov.lat])
                .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<h4>${prov.nama}</h4>`));
            
            // Konversi ke Leaflet marker untuk layer group
            const latLng = mapboxMarker.getLngLat();
            const leafletMarker = L.marker([latLng.lat, latLng.lng], {
                icon: L.divIcon({
                    html: mapboxMarker.getElement().outerHTML,
                    className: '',
                    iconSize: [30, 30]
                })
            });
            leafletMarker.bindPopup(mapboxMarker.getPopup()._content);
            return leafletMarker;
        }).filter(m => m !== null); // Filter marker yang null

        if (markers.length > 0) {
            markerLayers.provinsi.addLayers(markers);
        }
        console.log("Data provinsi berhasil dimuat dan marker ditambahkan.");

    } catch (error) {
        console.error("Gagal memuat data provinsi:", error);
    }
}

// Fungsi untuk menampilkan daftar marker dalam cluster
function displayClusterList(weatherData, layerName) {
    const listContainer = document.getElementById('cluster-list-container');
    const listContent = document.getElementById('cluster-list-content');
    
    listContent.innerHTML = ''; // Kosongkan daftar sebelumnya
    
    for (const id in weatherData) {
        const data = weatherData[id];
        const item = document.createElement('div');
        item.className = 'cluster-list-item';
        item.innerHTML = `
            <strong>${data.nama}</strong><br>
            ${data.cuaca}, ${data.suhu}°C
        `;
        item.onclick = () => {
            map.flyTo({ center: [data.lon, data.lat], zoom: 14 });
            listContainer.style.display = 'none';
        };
        listContent.appendChild(item);
    }
    
    listContainer.style.display = 'block';
}


// ============================= EVENT LISTENERS =============================

map.on('load', () => {
    // 1. Tambahkan sumber data Vector Tile dari server Flask
    map.addSource('peta-indonesia', {
        type: 'vector',
        tiles: [`${window.location.origin}/tiles/{z}/{x}/{y}.pbf`],
        minzoom: 4,
        maxzoom: 14
    });

    // 2. Tambahkan layer-layer dasar dari sumber Vector Tile
    // Layer Batas Provinsi
    map.addLayer({
        'id': 'batas-provinsi',
        'type': 'line',
        'source': 'peta-indonesia',
        'source-layer': 'batas_provinsi',
        'layout': { 'visibility': 'visible' },
        'paint': {
            'line-color': '#aaa',
            'line-width': 1.5,
            'line-dasharray': [2, 2]
        }
    });

    // Layer Batas Kabupaten/Kota
    map.addLayer({
        'id': 'batas-kabupaten',
        'type': 'line',
        'source': 'peta-indonesia',
        'source-layer': 'batas_kabupatenkota',
        'minzoom': 7,
        'layout': { 'visibility': 'visible' },
        'paint': {
            'line-color': '#ccc',
            'line-width': 1
        }
    });
    
    // Layer Label Nama Provinsi
    map.addLayer({
        'id': 'label-provinsi',
        'type': 'symbol',
        'source': 'peta-indonesia',
        'source-layer': 'batas_provinsi',
        'minzoom': 5,
        'maxzoom': 8,
        'layout': {
            'text-field': ['get', 'WADMPR'],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': 12,
            'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
            'text-radial-offset': 0.5,
            'text-justify': 'auto'
        },
        'paint': {
            'text-color': '#333',
            'text-halo-color': '#fff',
            'text-halo-width': 1.5
        }
    });

// Inisialisasi layer marker dan cluster
    // Menggunakan mapbox-gl-leaflet untuk kompatibilitas MarkerCluster
    const leafletMap = map.getMapboxLeaflet();
    markerLayers.provinsi = L.layerGroup();
    
    markerClusters.kabupaten = L.markerClusterGroup({
        maxClusterRadius: 60,
        iconCreateFunction: function(cluster) {
            return L.divIcon({ html: `<b>${cluster.getChildCount()}</b>`, className: 'marker-cluster marker-cluster-kabupaten', iconSize: L.point(40, 40) });
        }
    });

    markerClusters.kecamatan = L.markerClusterGroup({
        maxClusterRadius: 40,
        iconCreateFunction: function(cluster) {
            return L.divIcon({ html: `<b>${cluster.getChildCount()}</b>`, className: 'marker-cluster marker-cluster-kecamatan', iconSize: L.point(40, 40) });
        }
    });

    // Event listener untuk klik cluster
    markerClusters.kabupaten.on('clusterclick', function (a) {
        const childMarkers = a.layer.getAllChildMarkers();
        const ids = childMarkers.map(marker => marker.properties.id);
        fetchWeatherDataByIds(ids, 'kabupaten');
    });
    markerClusters.kecamatan.on('clusterclick', function (a) {
        const childMarkers = a.layer.getAllChildMarkers();
        const ids = childMarkers.map(marker => marker.properties.id);
        fetchWeatherDataByIds(ids, 'kecamatan');
    });

    // Muat data provinsi di awal
    loadProvinsiData();

    // Panggil manageLayerVisibility untuk setup awal
    manageLayerVisibility();

    // Tambahkan event listener untuk pergerakan peta
    map.on('moveend', manageLayerVisibility);
    map.on('zoomend', manageLayerVisibility);

    // Tutup popup list cluster
    document.getElementById('cluster-list-close').onclick = function() {
        document.getElementById('cluster-list-container').style.display = 'none';
    };
});
