import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { MarkerRenderer } from "./marker_renderer.js";
import { GempaManager } from "./gempa_manager.js";
import { MapInteraction } from "./map_interaction.js";
import { WeatherService } from "./weather_service.js";
import { DOM_IDS, CSS_CLASSES, MAP_LAYERS, MAP_SOURCES, MAP_KEYS } from "./constants.js";

export const inflightIds = new Set();

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

    _isClickLoading: false,

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
            if (e.sourceId === MAP_SOURCES.WILAYAH_VECTOR && e.isSourceLoaded) {
                this.renderMarkers();
            }
        });
    },

    getMap: function() { return this._map; },

    getIsLoading: function() { return WeatherService.isLoading(); },
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
    // DATA FETCHING
    // =========================================================================

    fetchDataForVisibleMarkers: async function() {
        if (this._isGempaLayerActive) return;
        if (this._isInteracting) return; 

        const map = this.getMap(); if (!map) return;
        
        // [PERBAIKAN BUG VISUAL FEEDBACK]
        // Kembalikan kontrol loading spinner ke Map Manager
        const loadingSpinner = document.getElementById(DOM_IDS.GLOBAL_SPINNER);
        
        const renderedIds = Object.keys(this._markers);
        
        const potentialIds = renderedIds.filter(id => {
            if (id.startsWith('cl-')) return false; 
            const marker = this._markers[id];
            if (marker && marker.getElement().querySelector(`.${CSS_CLASSES.MARKER_PROVINCE}`)) return false; 
            return true;
        });

        // Feedback Cepat (Skeleton)
        potentialIds.forEach(id => {
            if (!cacheManager.get(String(id))) this._updateMarkerContent(id);
        });

        // Cek apakah kita perlu fetch (ada ID yang belum di-cache)
        // Jika ada, nyalakan spinner. Logic filter detail ada di Service.
        if (potentialIds.length > 0 && loadingSpinner) {
             // Kita nyalakan dulu, nanti Service akan matikan jika ternyata semua sudah ada di cache
             // atau biarkan menyala sampai fetch selesai
             // Optimasi: Cek sederhana di sini agar spinner tidak kedip
             const needsFetch = potentialIds.some(id => !cacheManager.get(String(id)));
             if (needsFetch) loadingSpinner.style.display = 'block';
        }

        const result = await WeatherService.fetchMissingData(potentialIds);

        if (result.success) {
            if (this._isClickLoading && this._activeLocationId && result.dataMap[String(this._activeLocationId)]) {
                this._finalizeActiveLocationLoad(result.dataMap[String(this._activeLocationId)]);
            }
        }

        // Matikan spinner setelah selesai
        if (loadingSpinner && !this._isGempaLoading) {
            loadingSpinner.style.display = 'none';
        }

        this.updateAllMarkersForTime();
    },

    _finalizeActiveLocationLoad: function(data) {
        this._isClickLoading = false; 
        this._activeLocationData = data;
        
        if (this._sidebarManager && this._sidebarManager.isOpen()) { 
            this._sidebarManager.renderSidebarContent(); 
        }
        
        let coords = [data.longitude, data.latitude];
        if(this._markers[data.id]) coords = this._markers[data.id].getLngLat().toArray();
        this._renderRichPopup(data, coords);
    },

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    handleUnclusteredClick: async function(props) {
        const id = String(props.id);
        
        let coordinates = [parseFloat(props.lon), parseFloat(props.lat)];
        // Fallback ke posisi marker jika koordinat dari props tidak valid
        if ((!coordinates[0] || isNaN(coordinates[0])) && this._markers[id]) { 
            coordinates = this._markers[id].getLngLat().toArray(); 
        }
        // [FIX TYPO / LOGIC] Pastikan koordinat valid sebelum lanjut
        if (!coordinates || coordinates.length < 2 || isNaN(coordinates[0]) || isNaN(coordinates[1])) {
            console.warn("Koordinat tidak valid untuk marker ini.");
            return;
        }

        popupManager.close(true);
        if (this._sidebarManager) this._sidebarManager.resetContentMode();

        if (this._activeLocationId && String(this._activeLocationId) !== String(id)) {
             this.removeActiveMarkerHighlight(this._activeLocationId, true); 
        }
        this.resetActiveLocationState(); 
        this._activeLocationId = id; 
        this._activeLocationSimpleName = props.nama_simpel; 
        this._activeLocationLabel = props.nama_label;
        this.setActiveMarkerHighlight(id);

        if (parseInt(props.tipadm, 10) === 1) {
            this._activeLocationData = { ...props, type: 'provinsi', latitude: coordinates[1], longitude: coordinates[0] };
            this._isClickLoading = false;
            if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent();
            const popupContent = popupManager.generateProvincePopupContent(props.nama_simpel, props.nama_label);
            popupManager.open(coordinates, popupContent);
            return;
        }

        const cachedData = cacheManager.get(id);
        if (cachedData) {
            this._activeLocationData = cachedData;
            this._activeLocationData.tipadm = props.tipadm;
            this._isClickLoading = false;
            if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent();
            this._renderRichPopup(cachedData, coordinates);
        } else {
            this._handleCacheMiss(props, coordinates);
        }
    },

    _handleCacheMiss: async function(props, coordinates) {
        const { id, nama_simpel, tipadm } = props;
        
        this._activeLocationData = null; 
        this._isClickLoading = true; 
        
        const loadingContent = popupManager.generateLoadingPopupContent(nama_simpel); 
        const loadingPopupRef = popupManager.open(coordinates, loadingContent);
        
        if (this._sidebarManager && this._sidebarManager.isOpen()) this._sidebarManager.renderSidebarContent();

        try {
            const data = await WeatherService.fetchSingle(id);
            
            if (data) {
                if (String(this._activeLocationId) === String(id)) {
                    data.tipadm = tipadm; 
                    if (props.nama_label) data.nama_label = props.nama_label;
                    this._finalizeActiveLocationLoad(data);
                    this._updateMarkerContent(id);
                }
            } else {
                throw new Error("Data kosong.");
            }
        } catch (e) {
            console.error(`Fetch failed for ${id}:`, e);
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
    // LOGIKA GEMPA
    // =========================================================================

    toggleGempaLayer: async function(isActive) {
        this._isGempaLayerActive = isActive;
        const map = this.getMap(); if (!map) return;

        const visibility = isActive ? 'visible' : 'none';
        if (map.getLayer(MAP_LAYERS.GEMPA_POINT)) map.setLayoutProperty(MAP_LAYERS.GEMPA_POINT, 'visibility', visibility);
        if (map.getLayer(MAP_LAYERS.GEMPA_PULSE)) map.setLayoutProperty(MAP_LAYERS.GEMPA_PULSE, 'visibility', visibility);
        if (map.getLayer(MAP_LAYERS.GEMPA_LABEL)) map.setLayoutProperty(MAP_LAYERS.GEMPA_LABEL, 'visibility', visibility);

        for (const id in this._markers) {
            const marker = this._markers[id];
            MarkerRenderer.updateVisualStateOnly(marker, isActive);
        }

        if (isActive) {
            await this._loadGempaData();
        } else {
            popupManager.close(true);
            console.log("Mode Gempa OFF: Memicu refresh data cuaca...");
            this.triggerFetchData();
        }
    },

    _loadGempaData: async function() {
        const loadingSpinner = document.getElementById(DOM_IDS.GLOBAL_SPINNER);
        this._isGempaLoading = true;
        if (loadingSpinner) loadingSpinner.style.display = 'block';

        try {
            const features = await GempaManager.fetchAndProcess();
            const map = this.getMap();
            if (map && map.getSource(MAP_SOURCES.GEMPA)) {
                map.getSource(MAP_SOURCES.GEMPA).setData({ type: 'FeatureCollection', features: features });
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

        if (zoom <= 7.99) { targetLayer = MAP_LAYERS.PROVINSI_LINE; idKey = MAP_KEYS.ID_PROV; nameKey = MAP_KEYS.NAME_PROV; tipadmVal = 1; } 
        else if (zoom <= 10.99) { targetLayer = MAP_LAYERS.KABUPATEN_LINE; idKey = MAP_KEYS.ID_KAB; nameKey = MAP_KEYS.NAME_KAB; tipadmVal = 2; } 
        else if (zoom <= 14) { targetLayer = MAP_LAYERS.KECAMATAN_LINE; idKey = MAP_KEYS.ID_KEC; nameKey = MAP_KEYS.NAME_KEC; tipadmVal = 3; } 
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
                
                markerEl.classList.add(CSS_CLASSES.MARKER_ENTRANCE);
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

            const marker = this._markers[markerId];
            MarkerRenderer.updateVisualStateOnly(marker, this._isGempaLayerActive);
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
            try {
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
            if (isActive) { container.classList.add(CSS_CLASSES.MARKER_ACTIVE); container.style.zIndex = 10000; } 
            else { container.classList.remove(CSS_CLASSES.MARKER_ACTIVE); }
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