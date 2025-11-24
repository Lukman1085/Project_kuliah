import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { sidebarManager } from "./sidebar_manager.js";

// Set untuk melacak ID yang sedang dalam proses fetch agar tidak double-request
export const inflightIds = new Set();

/** 🗺️ MAP MANAGER (HYBRID VECTOR + CLIENT CLUSTERING + GEMPA) */
export const mapManager = { 
    _map: null, 
    _markers: {}, 
    _fetchDebounceTimer: null,
    _isInteracting: false,
    
    // [FIX ANIMASI] Flag untuk menandai apakah peta sedang dalam animasi programatik (FlyTo)
    _isFlying: false,
    
    // State untuk Hover Poligon
    _hoveredStateId: null,
    _hoveredSourceLayer: null,
    _isHoveringMarker: false,

    _isGempaLayerActive: false, 
    _gempaData: null,

    // [BARU] State loading khusus gempa untuk mencegah konflik UI
    _isGempaLoading: false,

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
                if (!mapInstance.isMoving() && !this._isFlying) this.triggerFetchData(); 
            }
        });
        window.addEventListener('touchend', () => { 
            if (this._isInteracting) {
                this._isInteracting = false;
                if (!mapInstance.isMoving() && !this._isFlying) this.triggerFetchData();
            }
        });

        // 2. VISUAL RENDER
        mapInstance.on('move', () => { this.renderMarkers(); });
        mapInstance.on('zoom', () => { this.renderMarkers(); });
        mapInstance.on('pitch', () => { this.renderMarkers(); });

        // 3. DATA FETCH
        mapInstance.on('moveend', () => { 
            this._isInteracting = false; 
            
            // [FIX ANIMASI] Jika moveend dipicu oleh easeTo (flying), jangan fetch dulu.
            // Biarkan callback easeTo yang menangani penyelesaiannya.
            if (this._isFlying) {
                return;
            }

            this.renderMarkers(); 
            this.triggerFetchData(); 
        });
        
        // Render ulang saat tile vector selesai dimuat (memastikan geometri tersedia)
        mapInstance.on('sourcedata', (e) => {
            if (e.sourceId === 'batas-wilayah-vector' && e.isSourceLoaded) {
                this.renderMarkers();
            }
        });

        // HOVER EFFECT LOGIC
        const fillLayers = ['batas-provinsi-fill', 'batas-kabupaten-fill', 'batas-kecamatan-fill'];

        mapInstance.on('mousemove', (e) => {
            // Jangan override hover jika mouse sedang di atas marker (Marker punya otoritas)
            if (this._isInteracting || this._isHoveringMarker) return;

            let features = mapInstance.queryRenderedFeatures(e.point, { layers: fillLayers });
            
            if (features.length > 0) {
                const feature = features[0];
                if (feature.id !== undefined) {
                    if (this._hoveredStateId !== feature.id) {
                        this._clearHoverState(); 
                        
                        this._hoveredStateId = feature.id;
                        this._hoveredSourceLayer = feature.sourceLayer;
                        
                        mapInstance.setFeatureState(
                            { source: 'batas-wilayah-vector', sourceLayer: this._hoveredSourceLayer, id: this._hoveredStateId },
                            { hover: true }
                        );
                    }
                }
            } else {
                this._clearHoverState();
            }
        });

        mapInstance.on('mouseleave', () => {
            if (!this._isHoveringMarker) {
                this._clearHoverState();
            }
        });

        // CLICK LISTENER KHUSUS GEMPA
        mapInstance.on('click', 'gempa-point-layer', (e) => {
            if (!this._isGempaLayerActive) return;
            
            const feature = e.features[0];
            if (feature) {
                // Hentikan propagasi klik ke layer di bawahnya (misal: wilayah)
                e.originalEvent.stopPropagation(); 
                this._handleGempaClick(feature);
            }
        });
        
        mapInstance.on('mouseenter', 'gempa-point-layer', () => {
            if(this._isGempaLayerActive) mapInstance.getCanvas().style.cursor = 'pointer';
        });
        mapInstance.on('mouseleave', 'gempa-point-layer', () => {
            if(this._isGempaLayerActive) mapInstance.getCanvas().style.cursor = '';
        });
    },

    _clearHoverState: function() {
        if (this._hoveredStateId !== null && this._hoveredSourceLayer !== null && this._map) {
            this._map.setFeatureState(
                { source: 'batas-wilayah-vector', sourceLayer: this._hoveredSourceLayer, id: this._hoveredStateId },
                { hover: false }
            );
        }
        this._hoveredStateId = null;
        this._hoveredSourceLayer = null;
    },

    // Menyalakan poligon berdasarkan ID Marker
    _highlightPolygon: function(id, tipadm) {
        if (!this._map) return;
        // Mapping TIPADM ke Source Layer di Vector Tile
        let sourceLayer = '';
        const tip = parseInt(tipadm, 10);
        if (tip === 1) sourceLayer = 'batas_provinsi';
        else if (tip === 2) sourceLayer = 'batas_kabupatenkota';
        else if (tip === 3) sourceLayer = 'batas_kecamatandistrik';
        else return; 

        // Bersihkan hover sebelumnya (misal dari poligon tetangga)
        this._clearHoverState();
        this._hoveredStateId = id;
        this._hoveredSourceLayer = sourceLayer;
        this._map.setFeatureState(
            { source: 'batas-wilayah-vector', sourceLayer: sourceLayer, id: id },
            { hover: true }
        );
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

    // [BARU] State Aktif Gempa (untuk fitur FlyTo)
    _activeGempaData: null,

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
        
        // [FIX ANIMASI] Jangan fetch jika sedang terbang (Flying)
        if (this._isFlying) {
            return;
        }

        this._fetchDebounceTimer = setTimeout(() => {
            // Jangan fetch jika user masih menahan mouse/layar!
            if (this._isInteracting) {
                console.log("Fetch dibatalkan: User masih berinteraksi.");
                return;
            }
            this.fetchDataForVisibleMarkers();
        }, 600); 
    },


    // =========================================================================
    // LOGIKA GEMPA (EARTHQUAKE LOGIC)
    // =========================================================================

    toggleGempaLayer: async function(isActive) {
        this._isGempaLayerActive = isActive;
        const map = this.getMap();
        if (!map) return;

        const visibility = isActive ? 'visible' : 'none';
        
        if (map.getLayer('gempa-point-layer')) map.setLayoutProperty('gempa-point-layer', 'visibility', visibility);
        if (map.getLayer('gempa-pulse-layer')) map.setLayoutProperty('gempa-pulse-layer', 'visibility', visibility);
        if (map.getLayer('gempa-label-layer')) map.setLayoutProperty('gempa-label-layer', 'visibility', visibility);

        if (isActive) {
            // Opsional: Jika data belum pernah diambil, fetch sekarang
            if (!this._gempaData) {
                await this._fetchAndRenderGempa();
            }
            // Redupkan marker cuaca dengan toggle class CSS
            this._toggleWeatherMarkersDimming(true);
        } else {
            // Kembalikan marker cuaca
            this._toggleWeatherMarkersDimming(false);
            popupManager.close(true); // Tutup popup gempa jika ada

            // [FITUR BARU] Paksa fetch ulang untuk 'membangunkan' marker skeleton
            // saat kembali ke mode normal (cuaca)
            console.log("Mode Gempa OFF: Memicu refresh data cuaca...");
            this.triggerFetchData();
        }
    },

    /**
     * [FIXED] Helper untuk mengatur opacity semua marker cuaca secara massal via Class CSS.
     * Menggunakan class 'marker-dimmed' yang punya !important di CSS.
     */
    _toggleWeatherMarkersDimming: function(shouldDim) {
        for (const id in this._markers) {
            const marker = this._markers[id];
            const el = marker.getElement();
            if (shouldDim) {
                el.classList.add('marker-dimmed');
            } else {
                el.classList.remove('marker-dimmed');
            }
        }
    },

    _fetchAndRenderGempa: async function() {
        const protocol = window.location.protocol; const hostname = window.location.hostname; const port = '5000'; const baseUrl = `${protocol}//${hostname}:${port}`;
        
        // [FIX ISSUE 1] Tampilkan Loading Spinner saat fetch gempa
        const loadingSpinner = document.getElementById('global-loading-spinner');
        this._isGempaLoading = true;
        if (loadingSpinner) loadingSpinner.style.display = 'block';

        try {
            const [bmkgRes, usgsRes] = await Promise.allSettled([
                fetch(`${baseUrl}/api/gempa/bmkg`),
                fetch(`${baseUrl}/api/gempa/usgs`)
            ]);

            let bmkgFeatures = [];
            let usgsFeatures = [];

            if (bmkgRes.status === 'fulfilled' && bmkgRes.value.ok) {
                const json = await bmkgRes.value.json();
                bmkgFeatures = json.features || [];
            }
            if (usgsRes.status === 'fulfilled' && usgsRes.value.ok) {
                const json = await usgsRes.value.json();
                usgsFeatures = json.features || [];
            }

            // De-duplikasi Logic (Prioritas BMKG)
            const finalFeatures = [...bmkgFeatures];
            
            usgsFeatures.forEach(usgs => {
                let isDuplicate = false;
                const uTime = new Date(usgs.properties.time).getTime();
                const uCoord = usgs.geometry.coordinates; 

                for (const bmkg of bmkgFeatures) {
                    const bTime = new Date(bmkg.properties.time).getTime();
                    const bCoord = bmkg.geometry.coordinates;

                    const timeDiff = Math.abs(uTime - bTime) / 1000; 
                    if (timeDiff > 120) continue; 

                    const dist = Math.sqrt(Math.pow(uCoord[0] - bCoord[0], 2) + Math.pow(uCoord[1] - bCoord[1], 2));
                    if (dist < 0.5) {
                        isDuplicate = true;
                        break;
                    }
                }

                if (!isDuplicate) {
                    finalFeatures.push(usgs);
                }
            });

            const map = this.getMap();
            if (map && map.getSource('gempa-source')) {
                map.getSource('gempa-source').setData({
                    type: 'FeatureCollection',
                    features: finalFeatures
                });
            }
            
            this._gempaData = finalFeatures;
            console.log(`Gempa Loaded: ${bmkgFeatures.length} BMKG + ${usgsFeatures.length} USGS (Unique)`);

        } catch (e) {
            console.error("Gagal memuat data gempa:", e);
        } finally {
            // [FIX ISSUE 1] Matikan spinner HANYA JIKA fetch cuaca tidak sedang berjalan
            this._isGempaLoading = false;
            if (loadingSpinner && !this._isLoading) {
                 loadingSpinner.style.display = 'none';
            }
        }
    },

    _handleGempaClick: function(feature) {
        const props = feature.properties;
        const coords = feature.geometry.coordinates;
        
        // [BARU] Simpan data gempa aktif ke memori agar bisa diakses fitur FlyTo
        this._activeGempaData = {
            ...props,
            geometry: { coordinates: coords }
        };

        // Tutup semua popup sebelumnya
        popupManager.close(true);
        
        // Data untuk popup
        const popupContent = popupManager.generateGempaPopupContent(props);
        popupManager.open(coords, popupContent);
        
        // Fitur Hot-Swap Sidebar
        if (sidebarManager.isOpen()) {
            sidebarManager.renderSidebarGempa(props);
        }

        // Jika sidebar tertutup, biarkan tertutup sampai user klik "Lihat Analisis" di popup.
    },

    // =========================================================================
    // END LOGIKA GEMPA
    // =========================================================================

    // =========================================================================
    // [BARU] LOGIKA NAVIGASI & ZOOM (CENTRALIZED)
    // =========================================================================
    
    /**
     * Memindahkan peta ke lokasi marker aktif (Weather atau Gempa)
     * dan menampilkan popup setelah transisi selesai.
     */
    flyToActiveLocation: function() {
        // 1. Tentukan Mode: Gempa atau Cuaca?
        if (this._isGempaLayerActive) {
            this._flyToActiveGempa();
        } else {
            this._flyToActiveWeather();
        }
    },

    _flyToActiveGempa: function() {
        if (!this._activeGempaData || !this._map) return;
        
        const coords = this._activeGempaData.geometry.coordinates;
        const currentZoom = this._map.getZoom();
        const targetZoom = Math.max(currentZoom, 11);

        console.log("FlyTo Gempa:", coords);
        
        // [FIX ANIMASI] Kunci fetch data selama animasi
        this._isFlying = true;
        this.triggerFetchData(); // Akan dibatalkan oleh flag _isFlying (untuk debounce sebelumnya)

        this._map.easeTo({
            center: coords,
            zoom: targetZoom,
            duration: 1200, 
            essential: true
        });

        // Tampilkan popup setelah bergerak (gunakan event 'moveend' sekali saja)
        this._map.once('moveend', () => {
             // [FIX ANIMASI] Buka kunci fetch data
             this._isFlying = false;

             // Pastikan masih di mode gempa
             if (this._isGempaLayerActive && this._activeGempaData) {
                 const popupContent = popupManager.generateGempaPopupContent(this._activeGempaData);
                 popupManager.open(coords, popupContent);
             }
        });
    },

    _flyToActiveWeather: function() {
        // Gunakan data dari memori (_activeLocationData)
        // Ini mengatasi masalah jika marker visual hilang dari cache
        const data = this._activeLocationData;
        if (!data || !this._map) return;
        
        // Dapatkan koordinat dari data, atau fallback ke marker jika ada
        let coords = [data.longitude, data.latitude];
        // Jika data longitude/latitude tidak ada di object utama (misal dari klik unclustered), cari di marker
        if ((!coords[0] || !coords[1]) && this._markers[data.id]) {
            coords = this._markers[data.id].getLngLat().toArray();
        }
        
        // [CRITICAL FIX] Cek validitas koordinat SEBELUM memulai animasi.
        if (!coords[0] || !coords[1]) {
            console.warn("Koordinat tidak ditemukan untuk FlyTo.");
            return; // Keluar segera, jangan kunci peta!
        }

        // Tentukan Level Zoom berdasarkan TIPADM
        const tipadm = parseInt(data.tipadm, 10);
        let targetZoom = 10; // Default
        
        if (tipadm === 1) targetZoom = 7;       // Provinsi
        else if (tipadm === 2) targetZoom = 9;  // Kab/Kota
        else if (tipadm === 3) targetZoom = 11; // Kecamatan
        else if (tipadm === 4) targetZoom = 14; // Desa/Kelurahan

        console.log(`FlyTo Weather: ${data.nama_simpel} (TIPADM: ${tipadm}) -> Zoom ${targetZoom}`);

        // [FIX ANIMASI] Kunci fetch data selama animasi
        this._isFlying = true;
        this.triggerFetchData(); // Batalkan debounce yang pending

        this._map.easeTo({
            center: coords,
            zoom: targetZoom,
            duration: 1200,
            essential: true
        });

        // Trigger Popup setelah selesai
        this._map.once('moveend', () => {
            // [FIX ANIMASI] Buka kunci dan trigger fetch manual karena moveend diblokir
            this._isFlying = false;
            
            // Kita paksa render ulang dan fetch di lokasi baru
            this.renderMarkers();
            this.triggerFetchData();

            // Pastikan tidak pindah mode saat animasi berjalan
            // [FIX] Strict String Comparison for ID & Check Data
            if (!this._isGempaLayerActive && data && String(this._activeLocationId) === String(data.id)) {
                // Panggil renderRichPopup langsung jika data ada di cache
                const cached = cacheManager.get(String(data.id)); // Fix String ID
                if (cached) {
                     this._renderRichPopup(cached, coords);
                } else if (data.type === 'provinsi') {
                     const content = popupManager.generateProvincePopupContent(data.nama_simpel, data.nama_label);
                     popupManager.open(coords, content);
                } else {
                     // Jika belum ada, tampilkan loading (Fetch akan berjalan otomatis via triggerFetchData)
                     const loadingContent = popupManager.generateLoadingPopupContent(data.nama_simpel);
                     popupManager.open(coords, loadingContent);
                }
            }
        });
    },
    
    /**
     * Helper publik untuk dipanggil dari SearchBar.
     * [FIX] Hapus referensi 'data' yang tidak ada di sini.
     */
    flyToLocation: function(lat, lon, tipadm) {
         if (!this._map) return;
         
         const tip = parseInt(tipadm, 10);
         let z = 10;
         if (tip === 1) z = 7;
         else if (tip === 2) z = 9;
         else if (tip === 3) z = 11;
         else if (tip === 4) z = 14;

         // [FIX ANIMASI] Set flying mode
         this._isFlying = true;

         this._map.easeTo({
             center: [lon, lat],
             zoom: z
         });

         // Release flying mode on moveend
         this._map.once('moveend', () => {
             this._isFlying = false;
             this.renderMarkers();
             this.triggerFetchData();
             // JANGAN ada logika popup atau 'data' di sini.
             // Biarkan searchbar.js yang memanggil handleUnclusteredClick via timeout.
         });
    },

    // =========================================================================


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
                        tipadm: p.tipadm,
                        // [DATA INTEGRITY FIX] Kirim Lat/Lon asli dari vector tile ke pembuat marker
                        lat: p.lngLat[1], 
                        lon: p.lngLat[0]
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

            // --- [MODIFIKASI FIX STATE MARKER GEMPA: CLASS BASED] ---
            // Menggunakan toggle class lebih robust daripada inline style
            const el = this._markers[markerId].getElement();
            if (this._isGempaLayerActive) {
                el.classList.add('marker-dimmed');
            } else {
                el.classList.remove('marker-dimmed');
            }
            // -------------------------------------------
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
     * Desain: Kapsul + Angka Gradien + Label "LOKASI"
     */
    _createClusterElement: function(members) {
        const count = members.length;
        const container = document.createElement('div');
        container.className = 'marker-container'; 
        
        // Focus Mode Cluster: Bersihkan hover state peta saat masuk cluster
        container.addEventListener('mouseenter', () => {
            this._isHoveringMarker = true;
            this._clearHoverState();
        });
        container.addEventListener('mouseleave', () => {
            this._isHoveringMarker = false;
        });

        let gradientClass = 'cluster-gradient-blue'; 
        if (count > 10) gradientClass = 'cluster-gradient-yellow'; 
        if (count > 50) gradientClass = 'cluster-gradient-red'; 

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
        // [FITUR BARU] Cegah fetch saat mode gempa aktif (Hemat API & Jaga Skeleton)
        if (this._isGempaLayerActive) {
            console.log("Fetch ditahan: Mode Gempa Aktif");
            return;
        }

        if (this._isInteracting) return; 

        const map = this.getMap();
        if (!map) return;
        const protocol = window.location.protocol; const hostname = window.location.hostname; const port = '5000'; const baseUrl = `${protocol}//${hostname}:${port}`;
        const loadingSpinner = document.getElementById('global-loading-spinner');
        
        if (this._isLoading) return;
        
        const renderedIds = Object.keys(this._markers);
        
        // Filter:
        // 1. Abaikan ID yang diawali 'cl-' (Cluster)
        // 2. Abaikan jika marker adalah PROVINSI (tidak perlu fetch API cuaca)
        // 3. Ambil yang belum ada cache & belum inflight
        const idsToFetch = renderedIds.filter(id => {
            if (id.startsWith('cl-')) return false; 
            
            // Cek apakah ini provinsi?
            const marker = this._markers[id];
            if (marker) {
                const el = marker.getElement();
                // Marker provinsi memiliki class 'marker-theme-province' di kapsulnya atau badge khusus
                if (el.querySelector('.marker-theme-province')) {
                    return false; 
                }
            }

            // [FIX] Pastikan cek cache menggunakan String ID
            return !cacheManager.get(String(id)) && !inflightIds.has(String(id));
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

             if (firstValidSingle && !inflightIds.has(String(firstValidSingle))) idsToFetch.push(firstValidSingle);
        } 
        
        if (!idsToFetch.length) { 
            this.updateAllMarkersForTime();
            return; 
        }
        
        // Tandai ID sedang diproses
        idsToFetch.forEach(id => inflightIds.add(String(id))); // [FIX] Add String
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
                // [FIX] Proses dengan String ID
                const didInitTime = this._processIncomingData(String(id), data);
                if (isFirstLoad && didInitTime) { isFirstLoad = false; }
                
                // Jika data yang baru diambil adalah lokasi yang sedang aktif (diklik user)
                const isActive = (String(id) === String(this._activeLocationId));
                if (isActive && this._isClickLoading) {
                    this._isClickLoading = false; 
                    this._activeLocationData = data;
                    if (sidebarManager.isOpen()) { sidebarManager.renderSidebarContent(); }

                    // [FIX INFINITE LOADING LOOP] Render Popup Explisit!
                    // Ini adalah missing link: background fetch selesai, tapi popup loading masih menunggu.
                    let coords = [data.longitude, data.latitude];
                    if(this._markers[id]) coords = this._markers[id].getLngLat().toArray();
                    this._renderRichPopup(data, coords);
                }
            }
        } catch (e) { 
            console.error("Gagal fetch data cuaca:", e); 
        } finally {
            idsToFetch.forEach(id => inflightIds.delete(String(id))); // [FIX] Delete String
            this._isLoading = false; 
            
            // [FIX ISSUE 1 CONFLICT] Matikan spinner HANYA JIKA gempa tidak sedang loading
            if (loadingSpinner && !this._isGempaLoading) {
                loadingSpinner.style.display = 'none';
            }
            this.updateAllMarkersForTime(); 
        }
    },

    handleClientClusterClick: async function(clusterData, coordinates) {
        const members = clusterData._directMembers; 
        if (!members) return;

        popupManager.close(true);
        const pointCount = members.length;
        
        const generateItems = () => {
            const idxDisplay = timeManager.getSelectedTimeIndex();
            const items = [];
            
            members.forEach(member => {
                const id = String(member.id); // [FIX] String ID
                let data = cacheManager.get(id);
                
                // Jika data belum ada di cache, buat item skeleton (isLoading: true)
                if (!data) {
                     items.push({
                         id: id, 
                         nama: member.name, 
                         isLoading: true, 
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
                this._processIncomingData(String(id), data); 
                this._updateMarkerContent(id);
            }
            return data;
        };

        // Setup Popup Manager
        popupManager.setClusterGenerator(generateItems);
        popupManager.setFetchCallback(singleFetcher); 
        popupManager._activePopupType = 'cluster'; 
        
        // Render Awal (Mungkin berisi skeleton)
        const initialData = generateItems();
        const popupContent = popupManager.generateClusterPopupContent(initialData.title, initialData.items);
        
        // Buka Popup & Pasang Observer
        popupManager.open(coordinates, popupContent);
        popupManager.attachClusterObserver(); 
    },

    // Helper untuk klik item klaster
    _triggerSingleClickFromCluster: function(id, memberFallback) {
        popupManager.close(true);
        // Cek data terbaru di cache
        let data = cacheManager.get(String(id)); 
        const clickProps = { 
            id: String(id), 
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
        // [FIX DOMException] Strict ID Sanitization
        // Ganti titik, spasi, slash, dan karakter aneh lainnya dengan dash
        const safeId = String(id).replace(/[^a-zA-Z0-9-_]/g, '-');
        
        const tipadm = parseInt(props.tipadm, 10);
        const isProvince = (tipadm === 1);
        const container = document.createElement('div');
        container.className = 'marker-container'; 
        container.id = `marker-${safeId}`;
        
        // [BARU] Sync Hover: Mouse di marker -> Nyalakan Poligon
        container.addEventListener('mouseenter', () => {
            this._isHoveringMarker = true;
            this._highlightPolygon(id, tipadm); // Nyalakan wilayah terkait
        });
        // [BARU] Sync Hover: Mouse keluar marker -> Matikan Poligon
        container.addEventListener('mouseleave', () => {
            this._isHoveringMarker = false;
            this._clearHoverState(); // Matikan
        });
        
        if (isProvince) {
            // [IMPLEMENTASI BARU] Ganti wi-stars dengan SVG Pin Lokasi
            // Agar seragam dengan sidebar dan search bar
            const svgPin = `
                <svg viewBox="0 0 24 24" width="22" height="22" fill="white">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
            `;
            
            container.innerHTML = `
                <div class="location-badge province-badge">${props.nama_simpel}</div>
                <div class="marker-capsule marker-theme-province" id="capsule-${safeId}">
                    <div class="main-icon-wrapper">${svgPin}</div>
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

        // [DATA INTEGRITY FIX] Gunakan props.lat dan props.lon yang dikirim dari renderMarkers
        container.addEventListener('click', (e) => {
            e.stopPropagation(); 
            this.handleUnclusteredClick({ 
                id: String(id), // [FIX] Ensure String
                nama_simpel: props.nama_simpel, 
                nama_label: props.nama_label, 
                lat: props.lat, // Ambil dari props, BUKAN null
                lon: props.lon, // Ambil dari props, BUKAN null
                tipadm: props.tipadm 
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

        // [FIX DOMException] Strict Sanitization agar match dengan _createMarkerElement
        const safeId = String(id).replace(/[^a-zA-Z0-9-_]/g, '-');
        
        // [FIX DOMException] Gunakan selector yang lebih aman jika memungkinkan
        let capsuleEl, weatherIconEl, thermoIconEl, rainIconEl;
        try {
            capsuleEl = el.querySelector(`#capsule-${safeId}`);
            weatherIconEl = el.querySelector(`#icon-weather-${safeId}`);
            thermoIconEl = el.querySelector(`#icon-thermo-${safeId}`);
            rainIconEl = el.querySelector(`#icon-rain-${safeId}`);
        } catch (e) {
            console.warn(`Query selector error for ID: ${safeId}`, e);
            return;
        }

        const cachedData = cacheManager.get(String(id)); // [FIX] Get as String
        const idx = timeManager.getSelectedTimeIndex();

        // --- [MODIFIKASI FIX STATE MARKER GEMPA: CLASS BASED] ---
        // Kita cek apakah harus dim atau tidak. 
        // Ini akan menjaga konsistensi jika update terjadi saat mode gempa aktif.
        if (this._isGempaLayerActive) {
             el.classList.add('marker-dimmed');
        } else {
             el.classList.remove('marker-dimmed');
        }
        // -------------------------------------------

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
            
            // [HAPUS] Jangan atur opacity inline di sini, biarkan class marker-dimmed yang menang
            // jika mode gempa aktif.
             if (!this._isGempaLayerActive) {
                // Reset inline style jika ada sisa
                el.style.opacity = ''; 
                el.style.pointerEvents = '';
             }
             
        } else { 
             // Default opacity untuk data tidak lengkap (tapi bukan dimmed)
             if (!this._isGempaLayerActive) {
                 el.style.opacity = 0.7; 
             }
        }
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
    
    setActiveMarkerHighlight: function(id) { this._applyHighlightStyle(String(id), true); },
    
    removeActiveMarkerHighlight: function(idToRemove = null, forceRemove = false) { 
        const targetId = idToRemove || this._previousActiveLocationId;
        if (!targetId) return;
        
        // Jika forceRemove = false, kita cek apakah sidebar terbuka.
        // Jika ya, jangan hapus highlight (karena sidebar menampilkan data marker ini).
        if (!forceRemove) {
            const isTargetActive = (String(targetId) === String(this._activeLocationId));
            if (isTargetActive && (sidebarManager.isOpen() || popupManager.isOpen())) { return; }
        }
        
        this._applyHighlightStyle(String(targetId), false);
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
        cacheManager.set(String(id), data); // [FIX] Set as String
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
        // [FIX] Force String for ID and Float for Coordinates
        const id = String(props.id); 
        const nama_simpel = props.nama_simpel;
        const nama_label = props.nama_label;
        const lat = parseFloat(props.lat);
        const lon = parseFloat(props.lon);
        const tipadm = props.tipadm;

        let coordinates = [lon, lat];
        if ((!coordinates || isNaN(coordinates[0])) && this._markers[id]) { 
            coordinates = this._markers[id].getLngLat().toArray(); 
        }
        if (!coordinates || isNaN(coordinates[0])) return; 
        
        console.log(`Handling Click: ${nama_simpel} (${id})`); 
        popupManager.close(true);

        // [IMPLEMENTASI BARU] Reset mode sidebar ke weather jika user klik marker wilayah
        sidebarManager.resetContentMode();

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
            this._activeLocationData = { id: id, nama_simpel: nama_simpel, nama_label: nama_label, tipadm: 1, type: 'provinsi', latitude: lat, longitude: lon }; // [BARU] Pastikan lat/lon masuk data aktif untuk FlyTo
            this._isClickLoading = false;
            if (sidebarManager.isOpen()) { sidebarManager.renderSidebarContent(); }
            const popupContent = popupManager.generateProvincePopupContent(nama_simpel, nama_label);
            popupManager.open(coordinates, popupContent); return; 
        }

        // CASE: Cuaca (Cek Cache -> Fetch)
        const cachedData = cacheManager.get(id); // [FIX] String ID
        if (inflightIds.has(id)) { // [FIX] String ID
            this._handleInflightState({ id, nama_simpel, tipadm }, coordinates); 
        } else if (cachedData) { 
            this._handleCacheHit({ id, nama_simpel, tipadm }, cachedData, coordinates); 
        } else { 
            this._handleCacheMiss({ id, nama_simpel, tipadm }, coordinates); 
        }
    },

    // --- [IMPLEMENTASI BARU] ---
    // Handler Navigasi Sidebar (Tanpa FlyTo Otomatis)
    handleSidebarNavigation: function(data) {
        if (!this._map || !data) return;

        console.log(`Sidebar Navigation to: ${data.nama_simpel} (${data.id})`);

        // 1. Handover Highlight (Matikan yang lama)
        if (this._activeLocationId && String(this._activeLocationId) !== String(data.id)) {
             this.removeActiveMarkerHighlight(this._activeLocationId, true); 
        }

        // 2. Set State Lokasi Aktif (tanpa reset penuh agar tidak kedip)
        this._activeLocationId = String(data.id);
        this._activeLocationSimpleName = data.nama_simpel;
        this._activeLocationLabel = data.nama_label || data.nama_simpel;
        this._activeLocationData = data;
        this._isClickLoading = false;

        // 3. Render Ulang Sidebar dengan Data Baru
        sidebarManager.renderSidebarContent();

        // 4. Logika Viewport & Popup
        const coords = [data.longitude, data.latitude];
        const bounds = this._map.getBounds();
        
        // Cek apakah koordinat target ada di dalam viewport saat ini
        if (bounds.contains(coords)) {
            // Jika dalam viewport:
            // a. Nyalakan Highlight Marker (jika marker ada)
            this.setActiveMarkerHighlight(data.id);
            
            // b. Buka Popup (Rich Popup karena data sudah ada)
            // Tutup popup lama dulu
            popupManager.close(true);
            this._renderRichPopup(data, coords);
        } else {
            // Jika TIDAK dalam viewport:
            // a. Jangan buka popup (sesuai instruksi)
            // b. Biarkan tombol FlyTo di sidebar yang menangani perpindahan jika user mau
            console.log("Lokasi di luar viewport, popup tidak dibuka otomatis.");
        }
    },
    // --- AKHIR IMPLEMENTASI BARU ---

    _handleInflightState: function(props, coordinates) {
        this._activeLocationData = null; this._isClickLoading = true;
        const loadingContent = popupManager.generateLoadingPopupContent(props.nama_simpel); popupManager.open(coordinates, loadingContent);
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
    },
    _handleCacheHit: function(props, data, coordinates) {
        this._activeLocationData = data; 
        // Update label jika data cache punya label lebih lengkap
        if (data.nama_label) this._activeLocationLabel = data.nama_label; 
        
        this._activeLocationData.tipadm = props.tipadm; this._isClickLoading = false;
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
        this._renderRichPopup(data, coordinates);
    },
    _handleCacheMiss: async function(props, coordinates) {
        const protocol = window.location.protocol; const hostname = window.location.hostname; const port = '5000'; const baseUrl = `${protocol}//${hostname}:${port}`;
        const { id, nama_simpel, tipadm } = props; 
        this._activeLocationData = null; this._isClickLoading = true; inflightIds.add(String(id)); // [FIX] String
        const loadingContent = popupManager.generateLoadingPopupContent(nama_simpel); const loadingPopupRef = popupManager.open(coordinates, loadingContent);
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent(); 
        try {
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${id}`);
            if (!resp.ok) throw new Error(`Network error ${resp.status}`);
            const dataMap = await resp.json();
            if (!dataMap?.[id]) throw new Error("Data lokasi tidak ditemukan");
            const data = dataMap[id];

            // [FIX RACE CONDITION] Simpan data aktif DULUAN sebelum proses inisialisasi waktu/UI global
            if (String(this._activeLocationId) === String(id)) {
                this._activeLocationData = data; 
                if (data.nama_label) this._activeLocationLabel = data.nama_label;
                this._activeLocationData.tipadm = tipadm; 
            }

            this._processIncomingData(String(id), data); // [FIX] String
            
            // [FIX] Render ulang popup jika ini masih lokasi aktif
            if (String(this._activeLocationId) === String(id)) {
                this._isClickLoading = false;
                this._updateMarkerContent(id);
                this._renderRichPopup(data, coordinates);
                if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
            }
        } catch (e) { 
            console.error(`Fetch failed for ${id}:`, e);
            if (String(this._activeLocationId) === String(id)) { 
                this._isClickLoading = false; this._activeLocationData = null;
                this.removeActiveMarkerHighlight(id, true); 
                
                // [IMPLEMENTASI BARU] Gunakan Styled Error Popup
                const errorContent = popupManager.generateErrorPopupContent(nama_simpel, `Gagal memuat: ${e.message}`);
                if (popupManager.getInstance() === loadingPopupRef) { 
                    popupManager.setDOMContent(errorContent); 
                }
                
                if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent(); 
            }
        } finally { inflightIds.delete(String(id)); } // [FIX] String
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
            // [PERBAIKAN] Typo dataPoint vs popupData sudah diperbaiki
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