import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
// [REFACTOR] Import Modul Baru
import { MarkerRenderer } from "./marker_renderer.js";
import { GempaManager } from "./gempa_manager.js";

// Set untuk melacak ID yang sedang dalam proses fetch agar tidak double-request
export const inflightIds = new Set();

/** * 🗺️ MAP MANAGER (FACADE / COORDINATOR)
 * Mengoordinasikan Peta, Data, dan UI Marker.
 * Logic rendering didistribusikan ke MarkerRenderer.
 * Logic data gempa didistribusikan ke GempaManager.
 */
export const mapManager = { 
    _map: null, 
    _markers: {}, 
    _fetchDebounceTimer: null,
    _isInteracting: false,
    
    // [DI] Variabel penampung untuk Sidebar Manager
    _sidebarManager: null,

    // [FIX ANIMASI] Flag untuk menandai apakah peta sedang dalam animasi programatik (FlyTo)
    _isFlying: false,
    
    // State untuk Hover Poligon
    _hoveredStateId: null,
    _hoveredSourceLayer: null,
    _isHoveringMarker: false,

    _isGempaLayerActive: false, 
    
    // [BARU] State loading khusus gempa
    _isGempaLoading: false,

    // [DI] Setter untuk menyuntikkan Sidebar Manager dari Main.js
    setSidebarManager: function(managerInstance) {
        this._sidebarManager = managerInstance;
        console.log("MapManager: SidebarManager berhasil disuntikkan.");
    },

    setMap: function(mapInstance) {
        this._map = mapInstance;
        console.log("Map instance telah di-set di mapManager.");
        
        const container = mapInstance.getContainer();

        // 1. INTERACTION GUARDS
        container.addEventListener('mousedown', () => { this._isInteracting = true; });
        container.addEventListener('touchstart', () => { this._isInteracting = true; }, { passive: true });

        // Deteksi saat user melepas klik/sentuh
        window.addEventListener('mouseup', () => { 
            if (this._isInteracting) {
                this._isInteracting = false;
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
            if (this._isFlying) return; // Skip jika sedang animasi FlyTo
            this.renderMarkers(); 
            this.triggerFetchData(); 
        });
        
        // Render ulang saat tile vector selesai dimuat
        mapInstance.on('sourcedata', (e) => {
            if (e.sourceId === 'batas-wilayah-vector' && e.isSourceLoaded) {
                this.renderMarkers();
            }
        });

        // HOVER EFFECT LOGIC (Tetap di sini karena erat dengan MapLibre API)
        this._initHoverLogic(mapInstance);

        // CLICK LISTENER KHUSUS GEMPA
        mapInstance.on('click', 'gempa-point-layer', (e) => {
            if (!this._isGempaLayerActive) return;
            const feature = e.features[0];
            if (feature) {
                e.originalEvent.stopPropagation(); 
                this._handleGempaClick(feature);
            }
        });
        
        mapInstance.on('mouseenter', 'gempa-point-layer', () => { if(this._isGempaLayerActive) mapInstance.getCanvas().style.cursor = 'pointer'; });
        mapInstance.on('mouseleave', 'gempa-point-layer', () => { if(this._isGempaLayerActive) mapInstance.getCanvas().style.cursor = ''; });
    },

    // Helper private untuk inisialisasi logic hover (Membersihkan setMap)
    _initHoverLogic: function(mapInstance) {
        const fillLayers = ['batas-provinsi-fill', 'batas-kabupaten-fill', 'batas-kecamatan-fill'];
        mapInstance.on('mousemove', (e) => {
            if (this._isInteracting || this._isHoveringMarker) return;
            let features = mapInstance.queryRenderedFeatures(e.point, { layers: fillLayers });
            if (features.length > 0) {
                const feature = features[0];
                if (feature.id !== undefined) {
                    if (this._hoveredStateId !== feature.id) {
                        this._clearHoverState(); 
                        this._hoveredStateId = feature.id;
                        this._hoveredSourceLayer = feature.sourceLayer;
                        mapInstance.setFeatureState({ source: 'batas-wilayah-vector', sourceLayer: this._hoveredSourceLayer, id: this._hoveredStateId }, { hover: true });
                    }
                }
            } else {
                this._clearHoverState();
            }
        });
        mapInstance.on('mouseleave', () => { if (!this._isHoveringMarker) this._clearHoverState(); });
    },

    _clearHoverState: function() {
        if (this._hoveredStateId !== null && this._hoveredSourceLayer !== null && this._map) {
            this._map.setFeatureState({ source: 'batas-wilayah-vector', sourceLayer: this._hoveredSourceLayer, id: this._hoveredStateId }, { hover: false });
        }
        this._hoveredStateId = null;
        this._hoveredSourceLayer = null;
    },

    _highlightPolygon: function(id, tipadm) {
        if (!this._map) return;
        let sourceLayer = '';
        const tip = parseInt(tipadm, 10);
        if (tip === 1) sourceLayer = 'batas_provinsi';
        else if (tip === 2) sourceLayer = 'batas_kabupatenkota';
        else if (tip === 3) sourceLayer = 'batas_kecamatandistrik';
        else return; 

        this._clearHoverState();
        this._hoveredStateId = id;
        this._hoveredSourceLayer = sourceLayer;
        this._map.setFeatureState({ source: 'batas-wilayah-vector', sourceLayer: sourceLayer, id: id }, { hover: true });
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
    _activeGempaData: null,

    // Getters
    getIsLoading: function() { return this._isLoading; }, 
    getIsClickLoading: function() { return this._isClickLoading; }, 
    getActiveLocationId: function() { return this._activeLocationId; }, 
    getActiveLocationSimpleName: function() { return this._activeLocationSimpleName; }, 
    getActiveLocationLabel: function() { return this._activeLocationLabel; }, 
    getActiveLocationData: function() { return this._activeLocationData; },
    
    triggerFetchData: function() {
        if (this._fetchDebounceTimer) clearTimeout(this._fetchDebounceTimer);
        if (this._isFlying) return;

        this._fetchDebounceTimer = setTimeout(() => {
            if (this._isInteracting) {
                console.log("Fetch dibatalkan: User masih berinteraksi.");
                return;
            }
            this.fetchDataForVisibleMarkers();
        }, 600); 
    },

    // =========================================================================
    // LOGIKA GEMPA (DIBERSIHKAN)
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
            // [REFACTOR] Delegasi ke GempaManager
            await this._loadGempaData();
            this.updateAllMarkersForTime(); // Redupkan marker cuaca
        } else {
            this.updateAllMarkersForTime(); // Kembalikan marker cuaca
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
            // [REFACTOR] Panggil GempaManager
            const features = await GempaManager.fetchAndProcess();
            
            const map = this.getMap();
            if (map && map.getSource('gempa-source')) {
                map.getSource('gempa-source').setData({
                    type: 'FeatureCollection',
                    features: features
                });
            }
        } catch (e) {
            console.error("MapManager: Gagal sinkronisasi data gempa.", e);
        } finally {
            this._isGempaLoading = false;
            if (loadingSpinner && !this._isLoading) {
                 loadingSpinner.style.display = 'none';
            }
        }
    },

    _handleGempaClick: function(feature) {
        const props = feature.properties;
        const coords = feature.geometry.coordinates;
        this._activeGempaData = { ...props, geometry: { coordinates: coords } };

        popupManager.close(true);
        const popupContent = popupManager.generateGempaPopupContent(props);
        popupManager.open(coords, popupContent);
        
        // [DI] Gunakan this._sidebarManager
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
        this.triggerFetchData(); // Batalkan pending fetch

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
            this.triggerFetchData();

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
    // RENDER SYSTEM (REFACTORED)
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

        // 3. Algoritma Klasterisasi (Tetap di sini karena butuh logic posisi)
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

        // 4. Render ke DOM (Delegasi ke MarkerRenderer)
        const activeMarkerIds = new Set();

        clusters.forEach(cluster => {
            const primaryId = cluster.centerPoint.id; 
            const markerId = cluster.isCluster ? `cl-${primaryId}` : primaryId;
            activeMarkerIds.add(markerId);
            const zIndexBase = Math.round((90 - cluster.centerPoint.lngLat[1]) * 100);

            if (!this._markers[markerId]) {
                let markerEl;
                
                if (cluster.isCluster) {
                    // [REFACTOR] Gunakan MarkerRenderer untuk membuat elemen Cluster
                    markerEl = MarkerRenderer.createClusterElement(
                        cluster.members,
                        {
                            onHover: () => { this._isHoveringMarker = true; this._clearHoverState(); },
                            onLeave: () => { this._isHoveringMarker = false; },
                            onClick: (members) => {
                                const clusterData = { properties: { cluster_id: 'client-side', point_count: members.length }, _directMembers: members };
                                this.handleClientClusterClick(clusterData, cluster.centerPoint.lngLat);
                            }
                        }
                    );
                } else {
                    const p = cluster.centerPoint;
                    const props = { nama_simpel: p.name, nama_label: p.label, tipadm: p.tipadm, lat: p.lngLat[1], lon: p.lngLat[0] };
                    
                    // [REFACTOR] Gunakan MarkerRenderer untuk membuat elemen Marker Biasa
                    markerEl = MarkerRenderer.createMarkerElement(
                        p.id, 
                        props,
                        {
                            onHover: (id, tip) => { this._isHoveringMarker = true; this._highlightPolygon(id, tip); },
                            onLeave: () => { this._isHoveringMarker = false; this._clearHoverState(); },
                            onClick: (clickProps) => {
                                // Reconstruct props dengan ID yang benar
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

            // [REFACTOR] Update State (Dimmed/Normal) juga bisa didelegasikan sebagian,
            // tapi toggle class sederhana bisa tetap di sini atau via MarkerRenderer.updateMarkerContent
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

    /**
     * Memperbarui konten visual marker (Delegasi ke MarkerRenderer)
     */
    _updateMarkerContent: function(id) {
        const markerInstance = this._markers[id];
        // [REFACTOR] Panggil MarkerRenderer
        MarkerRenderer.updateMarkerContent(markerInstance, id, this._isGempaLayerActive);
    },
    
    updateAllMarkersForTime: function() {
        for (const id in this._markers) { 
            if (!id.startsWith('cl-')) this._updateMarkerContent(id); 
        }
    },

    // ... (Sisa fungsi handleUnclusteredClick, handleClientClusterClick, dll. TETAP SAMA, hanya menyesuaikan struktur)
    
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
            // [DI]
            if (isTargetActive && (this._sidebarManager && this._sidebarManager.isOpen() || popupManager.isOpen())) { return; }
        }
        this._applyHighlightStyle(String(targetId), false);
        if (!idToRemove) { this._previousActiveLocationId = null; }
    },
    
    resetActiveLocationState: function() {
        const idToReset = this._activeLocationId;
        // [DI]
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
    
    _processIncomingData: function(id, data) {
        if (!data) return false; 
        cacheManager.set(String(id), data); 
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

    handleClusterClick: function(f, c) { console.warn("Deprecated handleClusterClick called"); },

    handleUnclusteredClick: function(props) {
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
        
        popupManager.close(true);
        // [DI]
        if (this._sidebarManager) this._sidebarManager.resetContentMode();

        if (this._activeLocationId && String(this._activeLocationId) !== String(id)) {
             this.removeActiveMarkerHighlight(this._activeLocationId, true); 
        }

        this.resetActiveLocationState(); 
        this._activeLocationId = id; this._activeLocationSimpleName = nama_simpel; this._activeLocationLabel = nama_label;
        this.setActiveMarkerHighlight(id); 
        
        const tipadmInt = parseInt(tipadm, 10);
        if (tipadmInt === 1) {
            this._activeLocationData = { id: id, nama_simpel: nama_simpel, nama_label: nama_label, tipadm: 1, type: 'provinsi', latitude: lat, longitude: lon }; 
            this._isClickLoading = false;
            // [DI]
            if (this._sidebarManager && this._sidebarManager.isOpen()) { this._sidebarManager.renderSidebarContent(); }
            const popupContent = popupManager.generateProvincePopupContent(nama_simpel, nama_label);
            popupManager.open(coordinates, popupContent); return; 
        }

        const cachedData = cacheManager.get(id); 
        if (inflightIds.has(id)) { 
            this._handleInflightState({ id, nama_simpel, tipadm }, coordinates); 
        } else if (cachedData) { 
            this._handleCacheHit({ id, nama_simpel, tipadm }, cachedData, coordinates); 
        } else { 
            this._handleCacheMiss({ id, nama_simpel, tipadm }, coordinates); 
        }
    },

    // Handler Navigasi Sidebar (Tanpa FlyTo Otomatis)
    handleSidebarNavigation: function(data) {
        if (!this._map || !data) return;
        if (this._activeLocationId && String(this._activeLocationId) !== String(data.id)) {
             this.removeActiveMarkerHighlight(this._activeLocationId, true); 
        }
        this._activeLocationId = String(data.id);
        this._activeLocationSimpleName = data.nama_simpel;
        this._activeLocationLabel = data.nama_label || data.nama_simpel;
        this._activeLocationData = data;
        this._isClickLoading = false;

        // [DI]
        if (this._sidebarManager) this._sidebarManager.renderSidebarContent();

        const coords = [data.longitude, data.latitude];
        const bounds = this._map.getBounds();
        if (bounds.contains(coords)) {
            this.setActiveMarkerHighlight(data.id);
            popupManager.close(true);
            this._renderRichPopup(data, coords);
        } else {
            console.log("Lokasi di luar viewport, popup tidak dibuka otomatis.");
        }
    },

    _handleInflightState: function(props, coordinates) {
        this._activeLocationData = null; this._isClickLoading = true;
        const loadingContent = popupManager.generateLoadingPopupContent(props.nama_simpel); popupManager.open(coordinates, loadingContent);
        // [DI]
        if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent();
    },
    _handleCacheHit: function(props, data, coordinates) {
        this._activeLocationData = data; 
        if (data.nama_label) this._activeLocationLabel = data.nama_label; 
        this._activeLocationData.tipadm = props.tipadm; this._isClickLoading = false;
        // [DI]
        if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent();
        this._renderRichPopup(data, coordinates);
    },
    _handleCacheMiss: async function(props, coordinates) {
        const protocol = window.location.protocol; const hostname = window.location.hostname; const port = '5000'; const baseUrl = `${protocol}//${hostname}:${port}`;
        const { id, nama_simpel, tipadm } = props; 
        this._activeLocationData = null; this._isClickLoading = true; inflightIds.add(String(id)); 
        const loadingContent = popupManager.generateLoadingPopupContent(nama_simpel); const loadingPopupRef = popupManager.open(coordinates, loadingContent);
        // [DI]
        if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent(); 
        try {
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${id}`);
            if (!resp.ok) throw new Error(`Network error ${resp.status}`);
            const dataMap = await resp.json();
            if (!dataMap?.[id]) throw new Error("Data lokasi tidak ditemukan");
            const data = dataMap[id];

            if (String(this._activeLocationId) === String(id)) {
                this._activeLocationData = data; 
                if (data.nama_label) this._activeLocationLabel = data.nama_label;
                this._activeLocationData.tipadm = tipadm; 
            }

            this._processIncomingData(String(id), data); 
            
            if (String(this._activeLocationId) === String(id)) {
                this._isClickLoading = false;
                this._updateMarkerContent(id);
                this._renderRichPopup(data, coordinates);
                // [DI]
                if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent();
            }
        } catch (e) { 
            console.error(`Fetch failed for ${id}:`, e);
            if (String(this._activeLocationId) === String(id)) { 
                this._isClickLoading = false; this._activeLocationData = null;
                this.removeActiveMarkerHighlight(id, true); 
                const errorContent = popupManager.generateErrorPopupContent(nama_simpel, `Gagal memuat: ${e.message}`);
                if (popupManager.getInstance() === loadingPopupRef) { 
                    popupManager.setDOMContent(errorContent); 
                }
                // [DI]
                if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent(); 
            }
        } finally { inflightIds.delete(String(id)); } 
    },

    fetchDataForVisibleMarkers: async function() {
        if (this._isGempaLayerActive) { console.log("Fetch ditahan: Mode Gempa Aktif"); return; }
        if (this._isInteracting) return; 

        const map = this.getMap(); if (!map) return;
        const protocol = window.location.protocol; const hostname = window.location.hostname; const port = '5000'; const baseUrl = `${protocol}//${hostname}:${port}`;
        const loadingSpinner = document.getElementById('global-loading-spinner');
        
        if (this._isLoading) return;
        const renderedIds = Object.keys(this._markers);
        const idsToFetch = renderedIds.filter(id => {
            if (id.startsWith('cl-')) return false; 
            const marker = this._markers[id];
            if (marker && marker.getElement().querySelector('.marker-theme-province')) return false; 
            return !cacheManager.get(String(id)) && !inflightIds.has(String(id));
        });
        
        let isFirstLoad = (timeManager.getGlobalTimeLookup().length === 0); 
        if (isFirstLoad && !idsToFetch.length && renderedIds.length > 0) {
             const firstValidSingle = renderedIds.find(id => {
                 if (id.startsWith('cl-')) return false;
                 const m = this._markers[id];
                 if (m && m.getElement().querySelector('.marker-theme-province')) return false;
                 return true;
             });
             if (firstValidSingle && !inflightIds.has(String(firstValidSingle))) idsToFetch.push(firstValidSingle);
        } 
        
        if (!idsToFetch.length) { this.updateAllMarkersForTime(); return; }
        
        idsToFetch.forEach(id => inflightIds.add(String(id))); 
        this._isLoading = true; 
        if (!isFirstLoad && loadingSpinner) { loadingSpinner.style.display = 'block'; }
        idsToFetch.forEach(id => this._updateMarkerContent(id));

        try {
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${idsToFetch.join(',')}`);
            if (!resp.ok) throw new Error(`Network error ${resp.status}`);
            const dataMap = await resp.json();
            for (const id in dataMap) {
                const data = dataMap[id];
                const didInitTime = this._processIncomingData(String(id), data);
                if (isFirstLoad && didInitTime) { isFirstLoad = false; }
                const isActive = (String(id) === String(this._activeLocationId));
                if (isActive && this._isClickLoading) {
                    this._isClickLoading = false; 
                    this._activeLocationData = data;
                    // [DI]
                    if (this._sidebarManager && this._sidebarManager.isOpen()) { this._sidebarManager.renderSidebarContent(); }
                    let coords = [data.longitude, data.latitude];
                    if(this._markers[id]) coords = this._markers[id].getLngLat().toArray();
                    this._renderRichPopup(data, coords);
                }
            }
        } catch (e) { 
            console.error("Gagal fetch data cuaca:", e); 
        } finally {
            idsToFetch.forEach(id => inflightIds.delete(String(id))); 
            this._isLoading = false; 
            if (loadingSpinner && !this._isGempaLoading) { loadingSpinner.style.display = 'none'; }
            this.updateAllMarkersForTime(); 
        }
    },

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