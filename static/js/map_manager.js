import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
// [REFACTOR] Import Modul
import { MarkerRenderer } from "./marker_renderer.js";
import { GempaManager } from "./gempa_manager.js";
import { MapInteraction } from "./map_interaction.js";
import { WeatherService } from "./weather_service.js"; // <-- Modul Baru

/** * 🗺️ MAP MANAGER (FACADE / COORDINATOR) */
export const mapManager = { 
    _map: null, 
    _markers: {}, 
    _fetchDebounceTimer: null,
    
    _isInteracting: false,
    _isHoveringMarker: false,
    
    _sidebarManager: null,
    _isFlying: false,
    
    _isGempaLayerActive: false, 
    _isGempaLoading: false,
    
    _activeLocationId: null, 
    _activeLocationSimpleName: null, 
    _activeLocationLabel: null, 
    _activeLocationData: null, 
    _previousActiveLocationId: null,
    _activeGempaData: null,

    _isClickLoading: false, // State lokal untuk loading klik spesifik

    setSidebarManager: function(managerInstance) {
        this._sidebarManager = managerInstance;
        console.log("MapManager: SidebarManager berhasil disuntikkan.");
    },

    setMap: function(mapInstance) {
        this._map = mapInstance;
        console.log("Map instance telah di-set di mapManager.");
        
        MapInteraction.init(mapInstance, {
            onInteractStart: () => { this._isInteracting = true; },
            onInteractEnd: () => { 
                if (this._isInteracting) {
                    this._isInteracting = false;
                    if (!mapInstance.isMoving() && !this._isFlying) this.triggerFetchData();
                }
            },
            onGempaClick: (feature) => { if (this._isGempaLayerActive) this._handleGempaClick(feature); },
            shouldSkipHover: () => { return this._isInteracting || this._isHoveringMarker; },
            isGempaMode: () => { return this._isGempaLayerActive; }
        });

        mapInstance.on('move', () => { this.renderMarkers(); });
        mapInstance.on('zoom', () => { this.renderMarkers(); });
        mapInstance.on('pitch', () => { this.renderMarkers(); });

        mapInstance.on('moveend', () => { 
            this._isInteracting = false; 
            if (this._isFlying) return;
            this.renderMarkers(); 
            this.triggerFetchData(); 
        });
        
        mapInstance.on('sourcedata', (e) => {
            if (e.sourceId === 'batas-wilayah-vector' && e.isSourceLoaded) {
                this.renderMarkers();
            }
        });
    },

    getMap: function() { return this._map; },

    // Getters
    getIsLoading: function() { return WeatherService.isLoading(); }, // Delegasi ke Service
    getIsClickLoading: function() { return this._isClickLoading; }, 
    getActiveLocationId: function() { return this._activeLocationId; }, 
    getActiveLocationSimpleName: function() { return this._activeLocationSimpleName; }, 
    getActiveLocationLabel: function() { return this._activeLocationLabel; }, 
    getActiveLocationData: function() { return this._activeLocationData; },
    
    triggerFetchData: function() {
        if (this._fetchDebounceTimer) clearTimeout(this._fetchDebounceTimer);
        if (this._isFlying) return;

        this._fetchDebounceTimer = setTimeout(() => {
            if (this._isInteracting) return;
            this.fetchDataForVisibleMarkers();
        }, 600); 
    },

    // =========================================================================
    // DATA FETCHING (REFACTORED VIA SERVICE)
    // =========================================================================

    fetchDataForVisibleMarkers: async function() {
        if (this._isGempaLayerActive) return;
        if (this._isInteracting) return; 

        const map = this.getMap(); if (!map) return;
        const loadingSpinner = document.getElementById('global-loading-spinner');
        
        const renderedIds = Object.keys(this._markers);
        
        // 1. Identifikasi ID Kandidat (Single Marker & Non-Provinsi)
        const potentialIds = renderedIds.filter(id => {
            if (id.startsWith('cl-')) return false; 
            const marker = this._markers[id];
            // Cek marker provinsi via DOM class (warisan logic lama)
            if (marker && marker.getElement().querySelector('.marker-theme-province')) return false; 
            return true;
        });

        // 2. Update Visual Skeleton (Feedback Cepat)
        potentialIds.forEach(id => {
            // Jika belum ada di cache, update marker agar terlihat loading (skeleton)
            if (!cacheManager.get(String(id))) this._updateMarkerContent(id);
        });

        // Tampilkan Global Spinner jika perlu
        // (Misal: Fetch Service sedang bekerja)
        // Logika spinner ini opsional, bisa diserahkan ke WeatherService jika mau lebih strict
        
        // 3. Delegasi ke WeatherService
        const result = await WeatherService.fetchMissingData(potentialIds);

        // 4. Update UI setelah data masuk
        if (result.success) {
            // Cek apakah ID aktif saat ini termasuk dalam data yang baru diambil
            if (this._isClickLoading && this._activeLocationId && result.dataMap[String(this._activeLocationId)]) {
                this._finalizeActiveLocationLoad(result.dataMap[String(this._activeLocationId)]);
            }
        }

        // 5. Refresh semua marker (Skeleton -> Real Data)
        this.updateAllMarkersForTime();
    },

    /**
     * Logika khusus saat data untuk lokasi yang DIKLIK user baru saja tiba.
     */
    _finalizeActiveLocationLoad: function(data) {
        this._isClickLoading = false; 
        this._activeLocationData = data;
        
        // Update Sidebar
        if (this._sidebarManager && this._sidebarManager.isOpen()) { 
            this._sidebarManager.renderSidebarContent(); 
        }
        
        // Update Popup (Rich)
        let coords = [data.longitude, data.latitude];
        if(this._markers[data.id]) coords = this._markers[data.id].getLngLat().toArray();
        this._renderRichPopup(data, coords);
    },

    // =========================================================================
    // EVENT HANDLERS (REFACTORED FETCH SINGLE)
    // =========================================================================

    handleUnclusteredClick: async function(props) {
        const id = String(props.id);
        
        // Setup Koordinat
        let coordinates = [parseFloat(props.lon), parseFloat(props.lat)];
        if ((!coordinates[0] || isNaN(coordinates[0])) && this._markers[id]) { 
            coordinates = this._markers[id].getLngLat().toArray(); 
        }
        if (!coordinates[0]) return;

        popupManager.close(true);
        if (this._sidebarManager) this._sidebarManager.resetContentMode();

        // Handover State
        if (this._activeLocationId && String(this._activeLocationId) !== String(id)) {
             this.removeActiveMarkerHighlight(this._activeLocationId, true); 
        }
        this.resetActiveLocationState(); 
        this._activeLocationId = id; 
        this._activeLocationSimpleName = props.nama_simpel; 
        this._activeLocationLabel = props.nama_label;
        this.setActiveMarkerHighlight(id);

        // CASE 1: Provinsi (Tanpa Fetch)
        if (parseInt(props.tipadm, 10) === 1) {
            this._activeLocationData = { ...props, type: 'provinsi', latitude: coordinates[1], longitude: coordinates[0] };
            this._isClickLoading = false;
            if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent();
            const popupContent = popupManager.generateProvincePopupContent(props.nama_simpel, props.nama_label);
            popupManager.open(coordinates, popupContent);
            return;
        }

        // CASE 2: Cuaca (Cek Cache / Fetch)
        const cachedData = cacheManager.get(id);
        if (cachedData) {
            this._activeLocationData = cachedData;
            this._activeLocationData.tipadm = props.tipadm;
            this._isClickLoading = false;
            if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent();
            this._renderRichPopup(cachedData, coordinates);
        } else {
            // Cache Miss -> Fetch Single via Service
            this._handleCacheMiss(props, coordinates);
        }
    },

    _handleCacheMiss: async function(props, coordinates) {
        const { id, nama_simpel, tipadm } = props;
        
        // Set UI Loading State
        this._activeLocationData = null; 
        this._isClickLoading = true; 
        
        // Tampilkan Popup Loading
        const loadingContent = popupManager.generateLoadingPopupContent(nama_simpel); 
        const loadingPopupRef = popupManager.open(coordinates, loadingContent);
        
        // Tampilkan Sidebar Loading
        if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent();

        try {
            // [REFACTOR] Panggil Service
            const data = await WeatherService.fetchSingle(id);
            
            if (data) {
                // Validasi: Masih lokasi aktif kah? (User mungkin sudah klik tempat lain)
                if (String(this._activeLocationId) === String(id)) {
                    // Tambahkan properti lokal yang mungkin hilang dari API
                    data.tipadm = tipadm; 
                    if (props.nama_label) data.nama_label = props.nama_label;
                    
                    this._finalizeActiveLocationLoad(data);
                    this._updateMarkerContent(id); // Update marker visual (hilangkan skeleton)
                }
            } else {
                throw new Error("Data kosong.");
            }
        } catch (e) {
            console.error(`Fetch failed for ${id}:`, e);
            // Error Handling
            if (String(this._activeLocationId) === String(id)) {
                this._isClickLoading = false; 
                this._activeLocationData = null;
                this.removeActiveMarkerHighlight(id, true);
                
                const errorContent = popupManager.generateErrorPopupContent(nama_simpel, `Gagal memuat: ${e.message}`);
                if (popupManager.getInstance() === loadingPopupRef) {
                    popupManager.setDOMContent(errorContent);
                }
                if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent();
            }
        }
    },

    // =========================================================================
    // LOGIKA GEMPA (DELEGASI KE GEMPA MANAGER)
    // =========================================================================

    toggleGempaLayer: async function(isActive) {
        this._isGempaLayerActive = isActive;
        const map = this.getMap(); if (!map) return;

        const visibility = isActive ? 'visible' : 'none';
        if (map.getLayer('gempa-point-layer')) map.setLayoutProperty('gempa-point-layer', 'visibility', visibility);
        if (map.getLayer('gempa-pulse-layer')) map.setLayoutProperty('gempa-pulse-layer', 'visibility', visibility);
        if (map.getLayer('gempa-label-layer')) map.setLayoutProperty('gempa-label-layer', 'visibility', visibility);

        if (isActive) {
            await this._loadGempaData();
            this.updateAllMarkersForTime(); 
        } else {
            this.updateAllMarkersForTime(); 
            popupManager.close(true);
            console.log("Mode Gempa OFF: Memicu refresh data cuaca...");
            this.triggerFetchData();
        }
    },

    _loadGempaData: async function() {
        const loadingSpinner = document.getElementById('global-loading-spinner');
        this._isGempaLoading = true;
        if (loadingSpinner) loadingSpinner.style.display = 'block';

        try {
            const features = await GempaManager.fetchAndProcess();
            const map = this.getMap();
            if (map && map.getSource('gempa-source')) {
                map.getSource('gempa-source').setData({ type: 'FeatureCollection', features: features });
            }
        } catch (e) {
            console.error("MapManager: Gagal sinkronisasi data gempa.", e);
        } finally {
            this._isGempaLoading = false;
            if (loadingSpinner && !this.getIsLoading()) { loadingSpinner.style.display = 'none'; }
        }
    },

    _handleGempaClick: function(feature) {
        const props = feature.properties;
        const coords = feature.geometry.coordinates;
        this._activeGempaData = { ...props, geometry: { coordinates: coords } };

        popupManager.close(true);
        const popupContent = popupManager.generateGempaPopupContent(props);
        popupManager.open(coords, popupContent);
        
        if (this._sidebarManager && this._sidebarManager.isOpen()) {
            this._sidebarManager.renderSidebarGempa(props);
        }
    },

    // =========================================================================
    // LOGIKA NAVIGASI & ZOOM
    // =========================================================================
    
    flyToActiveLocation: function() {
        if (this._isGempaLayerActive) this._flyToActiveGempa();
        else this._flyToActiveWeather();
    },

    _flyToActiveGempa: function() {
        if (!this._activeGempaData || !this._map) return;
        const coords = this._activeGempaData.geometry.coordinates;
        const currentZoom = this._map.getZoom();
        const targetZoom = Math.max(currentZoom, 11);

        this._isFlying = true;
        this.triggerFetchData(); 

        this._map.easeTo({
            center: coords, zoom: targetZoom, duration: 1200, essential: true
        });

        this._map.once('moveend', () => {
             this._isFlying = false;
             if (this._isGempaLayerActive && this._activeGempaData) {
                 const popupContent = popupManager.generateGempaPopupContent(this._activeGempaData);
                 popupManager.open(coords, popupContent);
             }
        });
    },

    _flyToActiveWeather: function() {
        const data = this._activeLocationData;
        if (!data || !this._map) return;
        
        let coords = [data.longitude, data.latitude];
        if ((!coords[0] || !coords[1]) && this._markers[data.id]) {
            coords = this._markers[data.id].getLngLat().toArray();
        }
        if (!coords[0] || !coords[1]) return;

        const tipadm = parseInt(data.tipadm, 10);
        let targetZoom = 10; 
        if (tipadm === 1) targetZoom = 7; else if (tipadm === 2) targetZoom = 9; else if (tipadm === 3) targetZoom = 11; else if (tipadm === 4) targetZoom = 14;

        this._isFlying = true;
        this.triggerFetchData();

        this._map.easeTo({
            center: coords, zoom: targetZoom, duration: 1200, essential: true
        });

        this._map.once('moveend', () => {
            this._isFlying = false;
            this.renderMarkers();
            this.triggerFetchData(); // Trigger ulang fetch data di lokasi baru

            if (!this._isGempaLayerActive && data && String(this._activeLocationId) === String(data.id)) {
                const cached = cacheManager.get(String(data.id));
                if (cached) {
                     this._renderRichPopup(cached, coords);
                } else if (data.type === 'provinsi') {
                     const content = popupManager.generateProvincePopupContent(data.nama_simpel, data.nama_label);
                     popupManager.open(coords, content);
                } else {
                     const loadingContent = popupManager.generateLoadingPopupContent(data.nama_simpel);
                     popupManager.open(coords, loadingContent);
                }
            }
        });
    },
    
    flyToLocation: function(lat, lon, tipadm) {
         if (!this._map) return;
         const tip = parseInt(tipadm, 10);
         let z = 10;
         if (tip === 1) z = 7; else if (tip === 2) z = 9; else if (tip === 3) z = 11; else if (tip === 4) z = 14;

         this._isFlying = true;
         this._map.easeTo({ center: [lon, lat], zoom: z });
         this._map.once('moveend', () => {
             this._isFlying = false;
             this.renderMarkers();
             this.triggerFetchData();
         });
    },

    // =========================================================================
    // RENDER SYSTEM
    // =========================================================================

    renderMarkers: function() {
        const map = this.getMap();
        if (!map) return;

        const zoom = map.getZoom();
        let targetLayer = '';
        let idKey = '';
        let nameKey = '';
        let tipadmVal = 0;

        if (zoom <= 7.99) { targetLayer = 'batas-provinsi-layer'; idKey = 'KDPPUM'; nameKey = 'WADMPR'; tipadmVal = 1; } 
        else if (zoom <= 10.99) { targetLayer = 'batas-kabupaten-layer'; idKey = 'KDPKAB'; nameKey = 'WADMKK'; tipadmVal = 2; } 
        else if (zoom <= 14) { targetLayer = 'batas-kecamatan-layer'; idKey = 'KDCPUM'; nameKey = 'WADMKC'; tipadmVal = 3; } 
        else { this._clearMarkers(new Set()); return; }
        
        if (!map.getLayer(targetLayer)) return;

        const features = map.queryRenderedFeatures({ layers: [targetLayer] });
        const bounds = map.getBounds();
        const validPoints = [];
        const processedIds = new Set();

        features.forEach(feature => {
            const props = feature.properties;
            const id = String(props[idKey]);
            const lat = parseFloat(props.latitude);
            const lon = parseFloat(props.longitude);

            if (!id || isNaN(lat) || isNaN(lon) || processedIds.has(id)) return;
            if (!bounds.contains([lon, lat])) return; 

            processedIds.add(id);
            validPoints.push({
                screenPoint: map.project([lon, lat]),
                lngLat: [lon, lat],
                id: id, props: props, tipadm: tipadmVal, name: props[nameKey], label: props.label || props[nameKey]
            });
        });

        // Klasterisasi
        const clusters = []; 
        const CLUSTER_RADIUS = 90; 
        validPoints.sort((a, b) => b.lngLat[1] - a.lngLat[1]);
        const usedPoints = new Set();

        validPoints.forEach((point, index) => {
            if (usedPoints.has(index)) return;
            const currentCluster = { isCluster: false, centerPoint: point, members: [point] };
            usedPoints.add(index);

            for (let j = index + 1; j < validPoints.length; j++) {
                if (usedPoints.has(j)) continue;
                const neighbor = validPoints[j];
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

        // Render via MarkerRenderer
        const activeMarkerIds = new Set();

        clusters.forEach(cluster => {
            const primaryId = cluster.centerPoint.id; 
            const markerId = cluster.isCluster ? `cl-${primaryId}` : primaryId;
            activeMarkerIds.add(markerId);
            const zIndexBase = Math.round((90 - cluster.centerPoint.lngLat[1]) * 100);

            if (!this._markers[markerId]) {
                let markerEl;
                
                if (cluster.isCluster) {
                    markerEl = MarkerRenderer.createClusterElement(
                        cluster.members,
                        {
                            onHover: () => { 
                                this._isHoveringMarker = true; 
                                MapInteraction.clearHoverState(); 
                            },
                            onLeave: () => { 
                                this._isHoveringMarker = false; 
                            },
                            onClick: (members) => {
                                const clusterData = { properties: { cluster_id: 'client-side', point_count: members.length }, _directMembers: members };
                                this.handleClientClusterClick(clusterData, cluster.centerPoint.lngLat);
                            }
                        }
                    );
                } else {
                    const p = cluster.centerPoint;
                    const props = { nama_simpel: p.name, nama_label: p.label, tipadm: p.tipadm, lat: p.lngLat[1], lon: p.lngLat[0] };
                    
                    markerEl = MarkerRenderer.createMarkerElement(
                        p.id, 
                        props,
                        {
                            onHover: (id, tip) => { 
                                this._isHoveringMarker = true; 
                                MapInteraction.highlightPolygon(id, tip); 
                            },
                            onLeave: () => { 
                                this._isHoveringMarker = false; 
                                MapInteraction.clearHoverState(); 
                            },
                            onClick: (clickProps) => {
                                this.handleUnclusteredClick({ ...clickProps, id: String(p.id) });
                            }
                        }
                    );
                }
                
                markerEl.classList.add('marker-entrance');
                markerEl.style.zIndex = zIndexBase;

                const newMarker = new maplibregl.Marker({ element: markerEl, anchor: 'bottom' })
                    .setLngLat(cluster.centerPoint.lngLat)
                    .addTo(map);

                this._markers[markerId] = newMarker;

                if (!cluster.isCluster) {
                    this._updateMarkerContent(primaryId);
                    if (primaryId === String(this._activeLocationId)) {
                         this._applyHighlightStyle(primaryId, true);
                    }
                }

            } else {
                this._markers[markerId].setLngLat(cluster.centerPoint.lngLat);
                this._markers[markerId].getElement().style.zIndex = zIndexBase;
            }

            const el = this._markers[markerId].getElement();
            if (this._isGempaLayerActive) el.classList.add('marker-dimmed');
            else el.classList.remove('marker-dimmed');
        });

        this._clearMarkers(activeMarkerIds);
    },

    _clearMarkers: function(activeIds) {
        for (const id in this._markers) {
            if (!activeIds.has(id)) {
                this._markers[id].remove();
                delete this._markers[id];
            }
        }
    },

    _updateMarkerContent: function(id) {
        const markerInstance = this._markers[id];
        MarkerRenderer.updateMarkerContent(markerInstance, id, this._isGempaLayerActive);
    },
    
    updateAllMarkersForTime: function() {
        for (const id in this._markers) { 
            if (!id.startsWith('cl-')) this._updateMarkerContent(id); 
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
                const id = String(member.id); 
                let data = cacheManager.get(id);
                if (!data) {
                     // [REFACTOR] Gunakan logic simple, data akan di-fetch oleh singleFetcher saat discroll/dibuka
                     items.push({ id: id, nama: member.name, isLoading: true, onClick: () => this._triggerSingleClickFromCluster(id, member) });
                } else {
                    let suhuStr = '-'; let descStr = '...'; let iconStr = 'wi wi-na';
                    if (data.hourly) {
                        const extractedData = utils.extractHourlyDataPoint(data.hourly, idxDisplay);
                        const info = utils.getWeatherInfo(extractedData.weather_code, extractedData.is_day);
                        suhuStr = `${extractedData.suhu?.toFixed(1) ?? '-'}°C`; descStr = info.deskripsi; iconStr = info.ikon;
                    }
                    items.push({ id: id, nama: data.nama_simpel, suhu: suhuStr, desc: descStr, icon: iconStr, isLoading: false, onClick: () => this._triggerSingleClickFromCluster(id, member) });
                }
            });
            return { title: pointCount > 100 ? `Menampilkan 100+ Lokasi:` : `${pointCount} Lokasi di area ini:`, items: items };
        };

        // [REFACTOR] Gunakan WeatherService untuk fetch single
        const singleFetcher = async (id) => {
            try {
                // Panggil Service (ini akan cache data otomatis)
                const data = await WeatherService.fetchSingle(id);
                if (data) {
                    this._updateMarkerContent(id);
                }
                return data;
            } catch(e) { return null; }
        };

        popupManager.setClusterGenerator(generateItems);
        popupManager.setFetchCallback(singleFetcher); 
        popupManager._activePopupType = 'cluster'; 
        
        const initialData = generateItems();
        const popupContent = popupManager.generateClusterPopupContent(initialData.title, initialData.items);
        popupManager.open(coordinates, popupContent);
        popupManager.attachClusterObserver(); 
    },

    _triggerSingleClickFromCluster: function(id, memberFallback) {
        popupManager.close(true);
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
            if (isActive) { container.classList.add('active-marker'); container.style.zIndex = 10000; } 
            else { container.classList.remove('active-marker'); }
        }
    },
    
    setActiveMarkerHighlight: function(id) { this._applyHighlightStyle(String(id), true); },
    
    removeActiveMarkerHighlight: function(idToRemove = null, forceRemove = false) { 
        const targetId = idToRemove || this._previousActiveLocationId;
        if (!targetId) return;
        if (!forceRemove) {
            const isTargetActive = (String(targetId) === String(this._activeLocationId));
            if (isTargetActive && (this._sidebarManager && this._sidebarManager.isOpen() || popupManager.isOpen())) { return; }
        }
        this._applyHighlightStyle(String(targetId), false);
        if (!idToRemove) { this._previousActiveLocationId = null; }
    },
    
    resetActiveLocationState: function() {
        const idToReset = this._activeLocationId;
        if (this._sidebarManager && this._sidebarManager.isOpen()) { 
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
    
    // ... handleSidebarNavigation sudah ada di atas, logic ini untuk tombol flyTo yang lain
    
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