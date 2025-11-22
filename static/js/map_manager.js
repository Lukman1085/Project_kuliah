import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { sidebarManager } from "./sidebar_manager.js";

// Set untuk melacak ID yang sedang dalam proses fetch agar tidak double-request
export const inflightIds = new Set();

/** 🗺️ MAP MANAGER (HYBRID VECTOR + CLIENT CLUSTERING)
 * * FITUR UTAMA:
 * 1. Vector Tile Rendering: Geometri diambil instan dari tile MVT/PBF.
 * 2. Grid-Based Clustering: Pengelompokan marker sisi klien berdasarkan jarak piksel layar.
 * 3. Interaction Guard: Mencegah fetch API saat user masih berinteraksi (drag/pan).
 * 4. Handover Maneuver: Logika visual marker aktif yang cerdas.
 * 5. Organic Motion: Animasi Pop-In & Transisi Warna Halus.
 */
export const mapManager = { 
    _map: null, 
    _markers: {}, // Menyimpan instance Single Marker & Cluster Marker
    _fetchDebounceTimer: null,
    _isInteracting: false, // Guard: Apakah user sedang menekan mouse/layar?

    /**
     * Menginisialisasi instance peta dan memasang event listener.
     */
    setMap: function(mapInstance) {
        this._map = mapInstance;
        console.log("Map instance telah di-set di mapManager.");
        
        const container = mapInstance.getContainer();

        // 1. INTERACTION GUARDS
        container.addEventListener('mousedown', () => { this._isInteracting = true; });
        container.addEventListener('touchstart', () => { this._isInteracting = true; }, { passive: true });

        // Deteksi saat user melepas klik/sentuh (di mana saja di window)
        window.addEventListener('mouseup', () => { 
            if (this._isInteracting) {
                this._isInteracting = false;
                // Trigger fetch manual saat lepas jari (jika peta sudah diam)
                if (!mapInstance.isMoving()) this.triggerFetchData(); 
            }
        });
        window.addEventListener('touchend', () => { 
            if (this._isInteracting) {
                this._isInteracting = false;
                if (!mapInstance.isMoving()) this.triggerFetchData();
            }
        });

        // 2. VISUAL RENDER
        mapInstance.on('move', () => { this.renderMarkers(); });
        mapInstance.on('zoom', () => { this.renderMarkers(); });
        mapInstance.on('pitch', () => { this.renderMarkers(); });

        // 3. DATA FETCH
        mapInstance.on('moveend', () => { 
            this._isInteracting = false; 
            this.renderMarkers(); 
            this.triggerFetchData(); 
        });
        
        // Render ulang saat tile vector selesai dimuat (memastikan geometri tersedia)
        mapInstance.on('sourcedata', (e) => {
            if (e.sourceId === 'batas-wilayah-vector' && e.isSourceLoaded) {
                this.renderMarkers();
            }
        });
    },

    getMap: function() { return this._map; },

    // State Management
    _isLoading: false, 
    _isClickLoading: false, 
    _activeLocationId: null, 
    _activeLocationSimpleName: null, 
    _activeLocationLabel: null, 
    _activeLocationData: null, 
    _previousActiveLocationId: null,

    // Getters
    getIsLoading: function() { return this._isLoading; }, 
    getIsClickLoading: function() { return this._isClickLoading; }, 
    getActiveLocationId: function() { return this._activeLocationId; }, 
    getActiveLocationSimpleName: function() { return this._activeLocationSimpleName; }, 
    getActiveLocationLabel: function() { return this._activeLocationLabel; }, 
    getActiveLocationData: function() { return this._activeLocationData; },
    
    /**
     * Debounce untuk fetch data API agar tidak spamming server.
     * Delay setelah moveend.
     */
    triggerFetchData: function() {
        if (this._fetchDebounceTimer) clearTimeout(this._fetchDebounceTimer);
        this._fetchDebounceTimer = setTimeout(() => {
            // Jangan fetch jika user masih menahan mouse/layar!
            if (this._isInteracting) {
                console.log("Fetch dibatalkan: User masih berinteraksi.");
                return;
            }
            this.fetchDataForVisibleMarkers();
        }, 600); 
    },

    /**
     * [ENGINE UTAMA] Client-Side Clustering & Rendering.
     * Menggabungkan fitur vektor berdasarkan jarak piksel layar.
     */
    renderMarkers: function() {
        const map = this.getMap();
        if (!map) return;

        const zoom = map.getZoom();
        let targetLayer = '';
        let idKey = '';
        let nameKey = '';
        let tipadmVal = 0;

        // Konfigurasi Layer
        if (zoom <= 7.99) {
            targetLayer = 'batas-provinsi-layer';
            idKey = 'KDPPUM'; nameKey = 'WADMPR'; tipadmVal = 1;
        } else if (zoom <= 10.99) {
            targetLayer = 'batas-kabupaten-layer';
            idKey = 'KDPKAB'; nameKey = 'WADMKK'; tipadmVal = 2;
        } else if (zoom <= 14) {
            targetLayer = 'batas-kecamatan-layer';
            idKey = 'KDCPUM'; nameKey = 'WADMKC'; tipadmVal = 3;
        } else {
            // Zoom > 14 (Desa) -> Bersihkan semua marker
            this._clearMarkers(new Set());
            return;
        }
        
        if (!map.getLayer(targetLayer)) return;

        // 1. Ambil fitur
        const features = map.queryRenderedFeatures({ layers: [targetLayer] });
        const bounds = map.getBounds();
        
        // 2. Pra-proses
        const validPoints = [];
        const processedIds = new Set();

        features.forEach(feature => {
            const props = feature.properties;
            const id = String(props[idKey]);
            const lat = parseFloat(props.latitude);
            const lon = parseFloat(props.longitude);

            // Validasi data & Cegah duplikasi ID dalam satu frame render
            if (!id || isNaN(lat) || isNaN(lon) || processedIds.has(id)) return;
            if (!bounds.contains([lon, lat])) return; 

            processedIds.add(id);
            
            // Simpan data titik beserta posisi layarnya (Pixel)
            // map.project() mengubah LatLon ke Pixel x,y. Ini kunci klasterisasi visual!
            validPoints.push({
                screenPoint: map.project([lon, lat]),
                lngLat: [lon, lat],
                id: id,
                props: props,
                tipadm: tipadmVal,
                name: props[nameKey],
                label: props.label || props[nameKey]
            });
        });

        // 3. Algoritma Klasterisasi Grid (Agresif: 90px)
        const clusters = []; 
        const CLUSTER_RADIUS = 90; 

        // Sort berdasarkan Latitude (Y) agar tumpukan z-index natural (atas menutupi bawah)
        validPoints.sort((a, b) => b.lngLat[1] - a.lngLat[1]);

        const usedPoints = new Set();

        validPoints.forEach((point, index) => {
            if (usedPoints.has(index)) return;

            // Titik ini menjadi pusat klaster baru
            const currentCluster = {
                isCluster: false, 
                centerPoint: point,
                members: [point]
            };

            usedPoints.add(index);

            // Cari tetangga yang belum dipakai
            for (let j = index + 1; j < validPoints.length; j++) {
                if (usedPoints.has(j)) continue;
                
                const neighbor = validPoints[j];
                // Hitung jarak Euclidean di layar (Pixel)
                const dx = currentCluster.centerPoint.screenPoint.x - neighbor.screenPoint.x;
                const dy = currentCluster.centerPoint.screenPoint.y - neighbor.screenPoint.y;
                const distance = Math.sqrt(dx*dx + dy*dy);

                if (distance <= CLUSTER_RADIUS) {
                    currentCluster.members.push(neighbor);
                    currentCluster.isCluster = true;
                    usedPoints.add(j);
                }
            }
            clusters.push(currentCluster);
        });

        // 4. Render ke DOM
        const activeMarkerIds = new Set();

        clusters.forEach(cluster => {
            // ID Unik untuk marker di peta (bisa ID lokasi atau ID gabungan klaster)
            // Untuk klaster, kita pakai ID lokasi pusat + suffix
            const primaryId = cluster.centerPoint.id; 
            const markerId = cluster.isCluster ? `cl-${primaryId}` : primaryId;
            
            activeMarkerIds.add(markerId);

            // Z-Index dinamis berdasarkan latitude (makin ke selatan/bawah makin tinggi)
            const zIndexBase = Math.round((90 - cluster.centerPoint.lngLat[1]) * 100);

            if (!this._markers[markerId]) {
                // Buat elemen baru (Marker belum ada)
                let markerEl;
                
                if (cluster.isCluster) {
                    markerEl = this._createClusterElement(cluster.members);
                } else {
                    // Single Marker
                    const p = cluster.centerPoint;
                    markerEl = this._createMarkerElement(p.id, {
                        nama_simpel: p.name,
                        nama_label: p.label,
                        tipadm: p.tipadm
                    });
                }
                
                // [ANIMASI] Tambahkan class Entrance agar "Pop-In"
                markerEl.classList.add('marker-entrance');
                
                markerEl.style.zIndex = zIndexBase;

                const newMarker = new maplibregl.Marker({
                    element: markerEl,
                    anchor: 'bottom'
                })
                .setLngLat(cluster.centerPoint.lngLat)
                .addTo(map);

                this._markers[markerId] = newMarker;

                // Jika single marker, cek cache cuaca (mungkin user geser dan marker ini muncul lagi)
                if (!cluster.isCluster) {
                    this._updateMarkerContent(primaryId);
                    // Restore highlight
                    if (primaryId === String(this._activeLocationId)) {
                         this._applyHighlightStyle(primaryId, true);
                    }
                }

            } else {
                // Marker sudah ada, update posisi
                // JANGAN tambah class marker-entrance lagi (biar tidak strobe)
                this._markers[markerId].setLngLat(cluster.centerPoint.lngLat);
                this._markers[markerId].getElement().style.zIndex = zIndexBase;
            }
        });

        // Bersihkan marker yang sudah tidak ada di viewport / hasil render terbaru
        this._clearMarkers(activeMarkerIds);
    },

    /** Hapus marker yang tidak lagi ada */
    _clearMarkers: function(activeIds) {
        for (const id in this._markers) {
            if (!activeIds.has(id)) {
                this._markers[id].remove();
                delete this._markers[id];
            }
        }
    },

    /**
     * [VISUAL REVISI 2] Membuat DOM Cluster.
     * Desain: Kapsul + Angka Gradien + Label "LOKASI"
     */
    _createClusterElement: function(members) {
        const count = members.length;
        const container = document.createElement('div');
        container.className = 'marker-container'; 
        
        // Logic Gradien
        let gradientClass = 'cluster-gradient-blue'; // Default (Biru)
        if (count > 10) gradientClass = 'cluster-gradient-yellow'; // Ramai (Kuning)
        if (count > 50) gradientClass = 'cluster-gradient-red'; // Padat (Merah)

        // Struktur HTML
        container.innerHTML = `
            <div class="marker-capsule" style="padding: 2px 8px 2px 2px; gap: 6px; align-items: center;">
                <!-- Lingkaran Angka dengan Gradien -->
                <div class="cluster-count-circle ${gradientClass}" style="
                    width: 32px; height: 32px; 
                    border-radius: 50%; 
                    color: white; font-weight: bold; font-size: 13px;
                    display: flex; justify-content: center; align-items: center;">
                    ${count}
                </div>
                <!-- Label Teks -->
                <span style="font-size: 11px; text-transform: uppercase;">Lokasi</span>
            </div>
            <!-- Animasi Pulsa -->
            <div class="marker-anchor"></div>
            <div class="marker-pulse"></div>
        `;

        // Event Klik Cluster
        container.addEventListener('click', (e) => {
            e.stopPropagation();
            const centerMember = members[0];
            const coordinates = centerMember.lngLat;
            
            const clusterData = {
                properties: { cluster_id: 'client-side', point_count: count },
                _directMembers: members 
            };

            this.handleClientClusterClick(clusterData, coordinates);
        });

        return container;
    },

    /** Fetch Data untuk Single Marker */
    fetchDataForVisibleMarkers: async function() {
        if (this._isInteracting) return; 

        const map = this.getMap();
        if (!map) return;
        const protocol = window.location.protocol; const hostname = window.location.hostname; const port = '5000'; const baseUrl = `${protocol}//${hostname}:${port}`;
        const loadingSpinner = document.getElementById('global-loading-spinner');
        
        if (this._isLoading) return;
        
        const renderedIds = Object.keys(this._markers);
        
        // [PERBAIKAN LOGIKA] Filter:
        // 1. Abaikan ID yang diawali 'cl-' (Cluster)
        // 2. [BARU] Abaikan jika marker adalah PROVINSI (tidak perlu fetch API cuaca)
        // 3. Ambil yang belum ada cache & belum inflight
        const idsToFetch = renderedIds.filter(id => {
            if (id.startsWith('cl-')) return false; 
            
            // Cek apakah ini provinsi?
            const marker = this._markers[id];
            if (marker) {
                const el = marker.getElement();
                // Marker provinsi memiliki class 'marker-theme-province' di kapsulnya atau badge khusus
                if (el.querySelector('.marker-theme-province')) {
                    return false; // SKIP PROVINSI dari fetch queue
                }
            }

            return !cacheManager.get(id) && !inflightIds.has(id);
        });
        
        // Logika Inisialisasi Awal: Jika belum ada data waktu global
        let isFirstLoad = (timeManager.getGlobalTimeLookup().length === 0); 
        
        if (isFirstLoad && !idsToFetch.length && renderedIds.length > 0) {
             // Cari satu single marker valid (NON PROVINSI) untuk inisialisasi waktu
             const firstValidSingle = renderedIds.find(id => {
                 if (id.startsWith('cl-')) return false;
                 const m = this._markers[id];
                 // Skip jika provinsi
                 if (m && m.getElement().querySelector('.marker-theme-province')) return false;
                 return true;
             });

             if (firstValidSingle && !inflightIds.has(firstValidSingle)) idsToFetch.push(firstValidSingle);
        } 
        
        if (!idsToFetch.length) { 
            this.updateAllMarkersForTime();
            return; 
        }
        
        // Tandai ID sedang diproses
        idsToFetch.forEach(id => inflightIds.add(id));
        this._isLoading = true; 
        if (!isFirstLoad && loadingSpinner) { loadingSpinner.style.display = 'block'; }
        
        // Tampilkan skeleton loading pada marker
        idsToFetch.forEach(id => this._updateMarkerContent(id));

        try {
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${idsToFetch.join(',')}`);
            if (!resp.ok) throw new Error(`Network error ${resp.status}`);
            const dataMap = await resp.json();
            
            for (const id in dataMap) {
                const data = dataMap[id];
                const didInitTime = this._processIncomingData(id, data);
                if (isFirstLoad && didInitTime) { isFirstLoad = false; }
                
                // Jika data yang baru diambil adalah lokasi yang sedang aktif (diklik user)
                const isActive = (String(id) === String(this._activeLocationId));
                if (isActive && this._isClickLoading) {
                    this._isClickLoading = false; 
                    this._activeLocationData = data;
                    if (sidebarManager.isOpen()) { sidebarManager.renderSidebarContent(); }
                }
            }
        } catch (e) { 
            console.error("Gagal fetch data cuaca:", e); 
        } finally {
            idsToFetch.forEach(id => inflightIds.delete(id));
            this._isLoading = false; 
            if (loadingSpinner) loadingSpinner.style.display = 'none';
            this.updateAllMarkersForTime(); 
        }
    },

    // =========================================================================
    // 5. EVENT HANDLERS
    // =========================================================================

    /**
     * Menangani klik pada cluster klien.
     * [LAZY LOADING] Sekarang menampilkan popup instan dengan skeleton, data di-fetch saat scroll.
     */
    handleClientClusterClick: function(clusterData, coordinates) {
        const members = clusterData._directMembers; 
        if (!members) return;

        popupManager.close(true);
        const pointCount = members.length;
        
        // [LAZY LOAD] Hapus pre-fetch loop (await fetch...)
        // Kita langsung siapkan generator konten

        const generateItems = () => {
            const idxDisplay = timeManager.getSelectedTimeIndex();
            const items = [];
            
            members.forEach(member => {
                const id = member.id;
                let data = cacheManager.get(id);
                
                // Jika data belum ada di cache, buat item skeleton (isLoading: true)
                if (!data) {
                     items.push({
                         id: id, // Penting untuk fetcher
                         nama: member.name, // Tampilkan nama yang sudah ada
                         isLoading: true, // Flag skeleton
                         // Logic klik tetap bisa jalan (akan trigger fetch single nanti)
                         onClick: () => this._triggerSingleClickFromCluster(id, member)
                     });
                } else {
                    // Data sudah ada, render normal
                    let suhuStr = '-';
                    let descStr = '...';
                    let iconStr = 'wi wi-na';

                    if (data.hourly) {
                        const extractedData = utils.extractHourlyDataPoint(data.hourly, idxDisplay);
                        const info = utils.getWeatherInfo(extractedData.weather_code, extractedData.is_day);
                        suhuStr = `${extractedData.suhu?.toFixed(1) ?? '-'}°C`;
                        descStr = info.deskripsi;
                        iconStr = info.ikon;
                    }

                    items.push({
                        id: id,
                        nama: data.nama_simpel,
                        suhu: suhuStr,
                        desc: descStr,
                        icon: iconStr,
                        isLoading: false,
                        onClick: () => this._triggerSingleClickFromCluster(id, member)
                    });
                }
            });

            return {
                title: pointCount > 100 ? `Menampilkan 100+ Lokasi:` : `${pointCount} Lokasi di area ini:`,
                items: items
            };
        };

        // [LAZY LOAD] Definisikan fungsi fetcher tunggal untuk dipanggil Popup Manager
        const singleFetcher = async (id) => {
            const protocol = window.location.protocol; const hostname = window.location.hostname; const port = '5000'; const baseUrl = `${protocol}//${hostname}:${port}`;
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${id}`);
            const dataMap = await resp.json();
            const data = dataMap[id];
            if (data) {
                this._processIncomingData(id, data); // Simpan cache & sync waktu
                // Update visual marker di peta juga jika perlu
                this._updateMarkerContent(id);
            }
            return data;
        };

        // Setup Popup Manager
        popupManager.setClusterGenerator(generateItems);
        popupManager.setFetchCallback(singleFetcher); // Daftarkan fetcher
        popupManager._activePopupType = 'cluster'; 
        
        // Render Awal (Mungkin berisi skeleton)
        const initialData = generateItems();
        const popupContent = popupManager.generateClusterPopupContent(initialData.title, initialData.items);
        
        // Buka Popup & Pasang Observer
        popupManager.open(coordinates, popupContent);
        popupManager.attachClusterObserver(); // Mulai pantau scroll
    },

    // Helper untuk klik item klaster
    _triggerSingleClickFromCluster: function(id, memberFallback) {
        popupManager.close(true);
        // Cek data terbaru di cache (siapa tahu baru kelar fetch)
        let data = cacheManager.get(id); 
        const clickProps = { 
            id: id, 
            nama_simpel: data ? data.nama_simpel : memberFallback.name, 
            nama_label: data ? (data.nama_label || data.nama_simpel) : (memberFallback.label || memberFallback.name), 
            lat: data ? data.latitude : memberFallback.lngLat[1], 
            lon: data ? data.longitude : memberFallback.lngLat[0], 
            tipadm: data ? data.tipadm : memberFallback.tipadm 
        };
        this.handleUnclusteredClick(clickProps);
    },

    // --- FUNGSI PENDUKUNG ---
    
    _createMarkerElement: function(id, props) {
        const safeId = String(id).replace(/\./g, '-');
        const tipadm = parseInt(props.tipadm, 10);
        const isProvince = (tipadm === 1);
        const container = document.createElement('div');
        container.className = 'marker-container'; 
        container.id = `marker-${safeId}`;
        
        if (isProvince) {
            container.innerHTML = `
                <div class="location-badge province-badge">${props.nama_simpel}</div>
                <div class="marker-capsule marker-theme-province" id="capsule-${safeId}">
                    <div class="main-icon-wrapper"><i class="wi wi-stars" style="font-size: 16px;"></i></div>
                    <div class="status-stack-province"><span style="font-size:10px; font-weight:bold; color:#555;">PROV</span></div>
                </div>
                <div class="marker-anchor"></div><div class="marker-pulse"></div>`;
        } else {
            container.innerHTML = `
                <div class="location-badge">${props.nama_simpel}</div>
                <div class="marker-capsule" id="capsule-${safeId}">
                    <div class="main-icon-wrapper"><i id="icon-weather-${safeId}" class="wi wi-na"></i></div>
                    <div class="status-stack">
                        <div class="thermo-stack"><i class="wi wi-thermometer-internal thermo-liquid" id="icon-thermo-${safeId}"></i><i class="wi wi-thermometer-exterior thermo-frame"></i></div>
                        <div class="rain-icon-box"><i class="wi wi-raindrop" id="icon-rain-${safeId}"></i></div>
                    </div>
                </div>
                <div class="marker-anchor"></div><div class="marker-pulse"></div>`;
        }

        container.addEventListener('click', (e) => {
            e.stopPropagation(); 
            this.handleUnclusteredClick({ 
                id: id, nama_simpel: props.nama_simpel, nama_label: props.nama_label, 
                lat: null, lon: null, tipadm: props.tipadm 
            });
        });
        return container;
    },

    /**
     * Memperbarui konten visual marker (Ikon, Warna) berdasarkan data cache & waktu.
     * Menangani state Skeleton Loading jika data belum tersedia.
     */
    _updateMarkerContent: function(id) {
        const markerInstance = this._markers[id];
        if (!markerInstance) return;
        const el = markerInstance.getElement();
        if (el.querySelector('.marker-theme-province')) return; 

        const safeId = String(id).replace(/\./g, '-');
        const capsuleEl = el.querySelector(`#capsule-${safeId}`);
        const weatherIconEl = el.querySelector(`#icon-weather-${safeId}`);
        const thermoIconEl = el.querySelector(`#icon-thermo-${safeId}`);
        const rainIconEl = el.querySelector(`#icon-rain-${safeId}`);
        const cachedData = cacheManager.get(id);
        const idx = timeManager.getSelectedTimeIndex();

        // State: Loading / Skeleton
        if (!cachedData) {
            el.classList.add('marker-skeleton'); 
            if (capsuleEl) capsuleEl.className = 'marker-capsule marker-theme-skeleton';
            if (weatherIconEl) weatherIconEl.className = 'wi wi-time-4'; 
            if (thermoIconEl) thermoIconEl.style.color = '#ccc';
            if (rainIconEl) rainIconEl.style.color = '#ccc';
            return;
        } 
        el.classList.remove('marker-skeleton');

        // State: Data Available
        if (cachedData.hourly?.time && idx < cachedData.hourly.time.length) {
            const hourly = cachedData.hourly;
            const code = hourly.weather_code?.[idx];
            const isDay = hourly.is_day?.[idx];
            const temp = hourly.temperature_2m?.[idx];
            const precip = hourly.precipitation_probability?.[idx];

            const weatherInfo = utils.getWeatherInfo(code, isDay);
            const themeClass = utils.getWeatherTheme(code, isDay);

            if (capsuleEl) capsuleEl.className = `marker-capsule ${themeClass}`;
            if (weatherIconEl) weatherIconEl.className = `wi ${weatherInfo.raw_icon_name}`;
            if (thermoIconEl) thermoIconEl.style.color = utils.getTempColor(temp);
            if (rainIconEl) rainIconEl.style.color = utils.getRainColor(precip);
            el.style.opacity = 1;
        } else { el.style.opacity = 0.7; }
    },
    
    /** Loop update ke semua marker (dipanggil saat slider waktu berubah) */
    updateAllMarkersForTime: function() {
        for (const id in this._markers) { 
            if (!id.startsWith('cl-')) this._updateMarkerContent(id); 
        }
    },

    /** Mengatur style visual saat marker aktif (diklik) */
    _applyHighlightStyle: function(id, isActive) {
        if (this._markers[id]) {
            const capsule = this._markers[id].getElement().querySelector(`.marker-capsule`); 
            if(capsule) {
                if (isActive) {
                    capsule.style.border = '2px solid #e74c3c';
                    capsule.style.transform = 'scale(1.15)';
                } else {
                    capsule.style.border = 'none';
                    capsule.style.transform = 'scale(1)';
                }
            }
            const container = this._markers[id].getElement();
            if (isActive) {
                container.classList.add('active-marker');
                container.style.zIndex = 10000; 
            } else {
                container.classList.remove('active-marker');
            }
        }
    },
    
    setActiveMarkerHighlight: function(id) { this._applyHighlightStyle(id, true); },
    
    removeActiveMarkerHighlight: function(idToRemove = null, forceRemove = false) { 
        const targetId = idToRemove || this._previousActiveLocationId;
        if (!targetId) return;
        
        // [LOGIKA PENGAMAN SIDEBAR]
        // Jika forceRemove = false, kita cek apakah sidebar terbuka.
        // Jika ya, jangan hapus highlight (karena sidebar menampilkan data marker ini).
        if (!forceRemove) {
            const isTargetActive = (String(targetId) === String(this._activeLocationId));
            if (isTargetActive && (sidebarManager.isOpen() || popupManager.isOpen())) { return; }
        }
        
        this._applyHighlightStyle(targetId, false);
        if (!idToRemove) { this._previousActiveLocationId = null; }
    },
    
    /** Mereset state lokasi aktif (bersihkan variabel dan UI) */
    resetActiveLocationState: function() {
        const idToReset = this._activeLocationId;
        if (sidebarManager.isOpen()) { 
            // Jangan paksa hapus jika sidebar terbuka (gunakan mekanisme handover untuk switching)
            this.removeActiveMarkerHighlight(idToReset, false); 
        } else {
            this._activeLocationId = null; 
            if (idToReset) { this.removeActiveMarkerHighlight(idToReset, false); }
            this._activeLocationSimpleName = null; this._activeLocationLabel = null; 
            this._activeLocationData = null; this._isClickLoading = false; this._previousActiveLocationId = null;
            if (timeManager.getGlobalTimeLookup().length > 0) { timeManager.updateUIWithRealData(); } 
            else { timeManager.updateTimePickerDisplayOnly(); }
        }
    },
    
    _processIncomingData: function(id, data) {
        if (!data) return false; 
        cacheManager.set(id, data);
        const isFirstLoad = (timeManager.getGlobalTimeLookup().length === 0);
        let didInitTime = false;
        if (isFirstLoad && data.hourly?.time?.length > 0) {
            timeManager.setGlobalTimeLookup(data.hourly.time);
            const realStartDate = new Date(data.hourly.time[0]);
            timeManager.initializeOrSync(realStartDate); 
            didInitTime = true;
        }
        return didInitTime; 
    },

    // Fallback Handle Cluster (deprecated)
    handleClusterClick: function(f, c) { console.warn("Deprecated handleClusterClick called"); },

    /**
     * Handler utama saat marker lokasi tunggal (unclustered) diklik.
     * Mengatur logic: Switching highlight, Buka Popup/Sidebar, dan Fetching data jika perlu.
     */
    handleUnclusteredClick: function(props) {
        const { id, nama_simpel, nama_label, lat, lon, tipadm } = props;
        let coordinates = [lon, lat];
        if ((!coordinates || coordinates[0] === null) && this._markers[id]) { 
            coordinates = this._markers[id].getLngLat().toArray(); 
        }
        if (!coordinates || isNaN(coordinates[0])) return; 
        
        console.log(`Handling Click: ${nama_simpel} (${id})`); 
        popupManager.close(true);

        // Handover Highlight: Matikan highlight lama sebelum nyalakan yang baru
        if (this._activeLocationId && String(this._activeLocationId) !== String(id)) {
             this.removeActiveMarkerHighlight(this._activeLocationId, true); 
        }

        this.resetActiveLocationState(); 
        this._activeLocationId = id; this._activeLocationSimpleName = nama_simpel; this._activeLocationLabel = nama_label;
        this.setActiveMarkerHighlight(id); 
        
        // CASE: Provinsi (Tampilkan Popup Khusus, tanpa fetch cuaca)
        const tipadmInt = parseInt(tipadm, 10);
        if (tipadmInt === 1) {
            this._activeLocationData = { id: id, nama_simpel: nama_simpel, nama_label: nama_label, tipadm: 1, type: 'provinsi' };
            this._isClickLoading = false;
            if (sidebarManager.isOpen()) { sidebarManager.renderSidebarContent(); }
            const popupContent = popupManager.generateProvincePopupContent(nama_simpel, nama_label);
            popupManager.open(coordinates, popupContent); return; 
        }

        // CASE: Cuaca (Cek Cache -> Fetch)
        const cachedData = cacheManager.get(id);
        if (inflightIds.has(id)) { 
            this._handleInflightState(props, coordinates); 
        } else if (cachedData) { 
            this._handleCacheHit(props, cachedData, coordinates); 
        } else { 
            this._handleCacheMiss(props, coordinates); 
        }
    },

    _handleInflightState: function(props, coordinates) {
        this._activeLocationData = null; this._isClickLoading = true;
        const loadingContent = popupManager.generateLoadingPopupContent(props.nama_simpel); popupManager.open(coordinates, loadingContent);
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
    },
    _handleCacheHit: function(props, data, coordinates) {
        this._activeLocationData = data; 
        // [SOLUSI] Update label jika data cache punya label lebih lengkap
        if (data.nama_label) this._activeLocationLabel = data.nama_label; 
        
        this._activeLocationData.tipadm = props.tipadm; this._isClickLoading = false;
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
        this._renderRichPopup(data, coordinates);
    },
    _handleCacheMiss: async function(props, coordinates) {
        const protocol = window.location.protocol; const hostname = window.location.hostname; const port = '5000'; const baseUrl = `${protocol}//${hostname}:${port}`;
        const { id, nama_simpel, tipadm } = props; 
        this._activeLocationData = null; this._isClickLoading = true; inflightIds.add(id);
        const loadingContent = popupManager.generateLoadingPopupContent(nama_simpel); const loadingPopupRef = popupManager.open(coordinates, loadingContent);
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent(); 
        try {
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${id}`);
            if (!resp.ok) throw new Error(`Network error ${resp.status}`);
            const dataMap = await resp.json();
            if (!dataMap?.[id]) throw new Error("Data lokasi tidak ditemukan");
            const data = dataMap[id];
            this._processIncomingData(id, data);
            if (this._activeLocationId === id) {
                this._activeLocationData = data; 
                // [SOLUSI] Update label setelah fetch API berhasil
                if (data.nama_label) this._activeLocationLabel = data.nama_label;
                
                this._activeLocationData.tipadm = tipadm; this._isClickLoading = false;
                this._updateMarkerContent(id);
                this._renderRichPopup(data, coordinates);
                if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
            }
        } catch (e) { 
            console.error(`Fetch failed for ${id}:`, e);
            if (this._activeLocationId === id) { 
                this._isClickLoading = false; this._activeLocationData = null;
                this.removeActiveMarkerHighlight(id, true); 
                if (popupManager.getInstance() === loadingPopupRef) { popupManager.setHTML(`<b>${nama_simpel}</b><br>Gagal: ${e.message}`); }
                if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent(); 
            }
        } finally { inflightIds.delete(id); }
    },

    /**
     * Menampilkan popup detail cuaca lengkap.
     */
    _renderRichPopup: function(data, coordinates) {
        const idxLocal = timeManager.getSelectedTimeIndex();
        const hasGlobalTimeDataNow = timeManager.getGlobalTimeLookup().length > 0;
        const localTimeStringNow = hasGlobalTimeDataNow ? timeManager.getGlobalTimeLookup()[idxLocal] : null;
        if (hasGlobalTimeDataNow && localTimeStringNow && data.hourly?.time && idxLocal < data.hourly.time.length) {
            const popupData = utils.extractHourlyDataPoint(data.hourly, idxLocal);
            const { deskripsi, ikon } = utils.getWeatherInfo(popupData.weather_code, popupData.is_day);
            const formattedTime = utils.formatLocalTimestampString(localTimeStringNow); 
            const popupContentElement = popupManager.generatePopupContent(data.nama_simpel, popupData, deskripsi, ikon, formattedTime);
            popupManager.open(coordinates, popupContentElement);
        } else {
            const content = `<b>${data.nama_simpel}</b><br>${hasGlobalTimeDataNow ? 'Data cuaca tidak valid.' : 'Data waktu belum siap.'}`;
            popupManager.open(coordinates, content);
        }
    }
};