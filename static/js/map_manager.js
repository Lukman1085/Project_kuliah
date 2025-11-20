import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { sidebarManager } from "./sidebar_manager.js";

export const inflightIds = new Set();

/** 🗺️ MAP MANAGER: Mengelola semua logika terkait peta, layer, dan interaksi */
export const mapManager = { 
    _map: null, 

    setMap: function(mapInstance) {
        this._map = mapInstance;
        console.log("Map instance telah di-set di mapManager.");
        
        // --- [TAHAP A] TRIGGER PRELOAD ASET ---
        if (mapInstance.loaded()) {
            utils.preloadMarkerAssets(mapInstance);
        } else {
            mapInstance.once('load', () => {
                utils.preloadMarkerAssets(mapInstance);
            });
        }
    },

    getMap: function() {
        if (!this._map) {
            console.error("mapManager.getMap() dipanggil sebelum map di-set!");
            return null;
        }
        return this._map;
    },

    _isLoading: false, 
    _isClickLoading: false, 
    _activeLocationId: null,
    _activeLocationSimpleName: null, 
    _activeLocationLabel: null, 
    _activeLocationData: null,
    _previousActiveLocationId: null, 
    
    getIsLoading: function() { return this._isLoading; },
    getIsClickLoading: function() { return this._isClickLoading; },
    getActiveLocationId: function() { return this._activeLocationId; },
    getActiveLocationSimpleName: function() { return this._activeLocationSimpleName; },
    getActiveLocationLabel: function() { return this._activeLocationLabel; },
    getActiveLocationData: function() { return this._activeLocationData; },
    
    _sanitizeStateValue: function(val, fallback) {
        if (val === null || val === undefined || isNaN(Number(val))) {
            return fallback;
        }
        return Number(val);
    },

    setActiveMarkerHighlight: function(id) {
        const map = this.getMap(); 
        if (!id || !map || !map.getSource('data-cuaca-source')) return;
        
        try {
            const currentState = map.getFeatureState({ source: 'data-cuaca-source', id: id }) || {};
            if (currentState.active) return; 

            // Note: Kita tidak mereset warna di sini, hanya flag active.
            // Warna akan diurus oleh siklus update timeManager/mapManager
            const newState = { ...currentState, active: true };
            map.setFeatureState({ source: 'data-cuaca-source', id: id }, newState); 
            console.log(`Highlight ON: ${id}`);
        } catch (e) { console.error("Error setting active highlight:", e); }
    },

    removeActiveMarkerHighlight: function(idToRemove = null, forceRemove = false) { 
        const map = this.getMap(); 
        const targetId = idToRemove || this._previousActiveLocationId;

        if (!targetId || !map || !map.getSource('data-cuaca-source')) return;

        if (!forceRemove) {
            const isTargetActive = (String(targetId) === String(this._activeLocationId));
            const isSidebarOpen = sidebarManager.isOpen();
            const isPopupOpen = popupManager.isOpen();

            if (isTargetActive && (isSidebarOpen || isPopupOpen)) {
                return; 
            }
        }

        console.log(`Highlight OFF: ${targetId} (Force: ${forceRemove})`);
        try {
            const currentState = map.getFeatureState({ source: 'data-cuaca-source', id: targetId });
            if (currentState?.active) {
                const newState = { ...currentState, active: false };
                map.setFeatureState({ source: 'data-cuaca-source', id: targetId }, newState);
            }
        } catch (e) { console.error("Error removing highlight:", e); }

        if (!idToRemove) {
            this._previousActiveLocationId = null;
        }
    },

    resetActiveLocationState: function() {
        console.log("Resetting active location state...");
        const idToReset = this._activeLocationId;
        
        if (sidebarManager.isOpen()) {
             this.removeActiveMarkerHighlight(idToReset, false);
        } else {
            this._activeLocationId = null; 
            if (idToReset) { 
                this.removeActiveMarkerHighlight(idToReset, false); 
            }
            this._activeLocationSimpleName = null; 
            this._activeLocationLabel = null; 
            this._activeLocationData = null;
            this._isClickLoading = false;
            this._previousActiveLocationId = null;
            
            if (timeManager.getGlobalTimeLookup().length > 0) {
                timeManager.updateUIWithRealData(); 
            } else {
                timeManager.updateTimePickerDisplayOnly(); 
            }
        }
    },

    dataController: null, 
    perbaruiPetaGeo: async function() {
            const map = this.getMap(); 
            if (!map) return; 

            const protocol = window.location.protocol;
            const hostname = window.location.hostname;
            const port = '5000';
            const baseUrl = `${protocol}//${hostname}:${port}`;

            if (this.dataController) this.dataController.abort();
            this.dataController = new AbortController();
            const signal = this.dataController.signal;
            cacheManager.cleanExpired();
            const zoom = map.getZoom();
            const cuacaSource = () => map.getSource('data-cuaca-source');
            const provinsiSource = () => map.getSource('provinsi-source');
            if (zoom <= 7.99) { 
                if (cuacaSource()) cuacaSource().setData({ type: 'FeatureCollection', features: [] });
                try {
                    const resp = await fetch(`${baseUrl}/api/provinsi-info`, { signal });
                    if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
                    const provinsiData = await resp.json();
                    const features = provinsiData.map(p => ({ 
                        type: 'Feature', 
                        geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, 
                        properties: { 
                            id: p.id, 
                            nama_simpel: p.nama_simpel, 
                            nama_label: p.nama_label, 
                            tipadm: 1,
                            type: 'provinsi' 
                        } 
                    }));
                    if (provinsiSource()) provinsiSource().setData({ type: 'FeatureCollection', features: features });
                } catch (e) { if (e.name !== 'AbortError') console.error('Gagal ambil data provinsi:', e); }
            } else { 
                if (provinsiSource()) provinsiSource().setData({ type: 'FeatureCollection', features: [] });
                const bounds = map.getBounds();
                const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
                try {
                const resp = await fetch(`${baseUrl}/api/data-cuaca?bbox=${bbox}&zoom=${zoom}`, { signal });
                if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
                const geoOnly = await resp.json();
                if (!geoOnly || geoOnly.error) { console.error("API Error (geo only):", geoOnly); return; }
                const features = geoOnly.map(g => ({ 
                    type: 'Feature', 
                    id: g.id, 
                    geometry: { type: 'Point', coordinates: [g.lon, g.lat] }, 
                    properties: { 
                        id: g.id, 
                        nama_simpel: g.nama_simpel || 'N/A', 
                        nama_label: g.nama_label || 'N/A', 
                        type: 'kabkec',
                        tipadm: g.tipadm 
                    } 
                }));
                if (cuacaSource()) cuacaSource().setData({ type: 'FeatureCollection', features: features });
                } catch (e) { if (e.name !== 'AbortError') console.error('Gagal ambil geo only data:', e); }
            }
    }, 
    fetchDataForVisibleMarkers: async function() {
        const map = this.getMap();
        if (!map) return;

        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = '5000';
        const baseUrl = `${protocol}//${hostname}:${port}`;
        const loadingSpinner = document.getElementById('global-loading-spinner');

        const zoom = map.getZoom();
        if (zoom <= 7.99 || this._isLoading) return;
        const visibleFeatures = map.queryRenderedFeatures({ layers: ['unclustered-point-temp-circle'] });
        const idsToFetch = visibleFeatures.map(f => f.id).filter(id => id && !cacheManager.get(id) && !inflightIds.has(id));
        let isFirstLoad = (timeManager.getGlobalTimeLookup().length === 0); 
        if (isFirstLoad && !idsToFetch.length && visibleFeatures.length > 0) {
            const firstVisibleId = visibleFeatures[0].id;
            if (firstVisibleId && !inflightIds.has(firstVisibleId)) {
                    idsToFetch.push(firstVisibleId);
            }
        } else if (!idsToFetch.length) {
            return; 
        }
        idsToFetch.forEach(id => inflightIds.add(id));
        this._isLoading = true; 
        if (!isFirstLoad && loadingSpinner) {
            loadingSpinner.style.display = 'block';
        }
        const featuresInSource = map.querySourceFeatures('data-cuaca-source');
        const currentSourceIds = new Set(featuresInSource.map(f => String(f.id))); 
        try {
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${idsToFetch.join(',')}`);
            if (!resp.ok) throw new Error(`Network error ${resp.status}`);
            const dataMap = await resp.json();
            for (const id in dataMap) {
                const data = dataMap[id];
                if (!currentSourceIds.has(String(id))) { 
                    this._processIncomingData(id, data); 
                    continue;
                }
                const didInitTime = this._processIncomingData(id, data); 
                if (isFirstLoad && didInitTime) {
                    isFirstLoad = false; 
                }
                const isActive = (String(id) === String(this._activeLocationId)); 
                this._updateMapStateForFeature(id, data, isActive); 
                if (isActive && this._isClickLoading) {
                    this._isClickLoading = false;
                    this._activeLocationData = data;
                    if (sidebarManager.isOpen()) {
                        sidebarManager.renderSidebarContent();
                    }
                }
            }
        } catch (e) { console.error("Gagal BBOX fetch:", e); }
        finally {
            idsToFetch.forEach(id => inflightIds.delete(id));
            this._isLoading = false; 
            if (loadingSpinner) loadingSpinner.style.display = 'none';
            if (!isFirstLoad) { 
                timeManager.updateMapFeaturesForTime(timeManager.getSelectedTimeIndex());
            }
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
    
    /** * [TAHAP B] Update Map State saat data baru masuk.
     * Disinkronkan dengan logika di time_manager agar properti visual (warna/ikon) langsung tersedia.
     */
    _updateMapStateForFeature: function(id, data, isActive) {
        const map = this.getMap(); 
        if (!map) return;

        const idxSaatIni = timeManager.getSelectedTimeIndex();
        if (data?.hourly?.time && idxSaatIni >= 0 && idxSaatIni < data.hourly.time.length) {
            
            // 1. Ambil data mentah
            const suhu = data.hourly.temperature_2m?.[idxSaatIni];
            const precip = data.hourly.precipitation_probability?.[idxSaatIni];
            const code = data.hourly.weather_code?.[idxSaatIni];
            const isDay = data.hourly.is_day?.[idxSaatIni];

            // 2. Hitung properti visual (sama seperti time_manager)
            const weatherInfo = utils.getWeatherInfo(code, isDay);
            const tempColor = utils.getTempColor(suhu);
            const precipColor = utils.getPrecipColor(precip);

            try {
                map.setFeatureState(
                    { source: 'data-cuaca-source', id: id },
                    {
                        hasData: true,
                        suhu: this._sanitizeStateValue(suhu, -999),
                        precip: this._sanitizeStateValue(precip, -1),
                        
                        // [TAHAP B] Inject Properti Visual
                        icon_name: weatherInfo.raw_icon_name,
                        temp_color: tempColor,
                        precip_color: precipColor,

                        active: isActive 
                    }
                );
            } catch (e) { }
        } else {
            try {
                map.setFeatureState({ source: 'data-cuaca-source', id: id }, { hasData: false, active: isActive });
            } catch (e) { }
        }
    },

    handleClusterClick: async function(feature, coordinates) { 
        const map = this.getMap(); 
        if (!map) return;

        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = '5000';
        const baseUrl = `${protocol}//${hostname}:${port}`;

        popupManager.close(true);
        const clusterId = feature.properties.cluster_id;
        const source = map.getSource('data-cuaca-source'); 
        if (!source || typeof source.getClusterLeaves !== 'function') return; 
        
        const pointCount = feature.properties.point_count;

        const loadingContent = popupManager.generateLoadingPopupContent('Memuat Klaster...');
        const loadingPopupRef = popupManager.open(coordinates, loadingContent);

        try {
            const leaves = await source.getClusterLeaves(clusterId, 100, 0); 
            
            if (!loadingPopupRef) return;
            const idsToFetch = leaves.map(leaf => leaf.id || leaf.properties.id).filter(Boolean);

            const response = await fetch(`${baseUrl}/api/data-by-ids?ids=${idsToFetch.join(',')}`);
            const dataDetailCuaca = await response.json();
            
            if (popupManager.getInstance() !== loadingPopupRef) { return; } 
            
            const idxDisplay = timeManager.getSelectedTimeIndex();
            const items = [];

            for (const id in dataDetailCuaca) {
                const data = dataDetailCuaca[id];
                if (!data) continue; 
                
                if (!cacheManager.get(id)) this._processIncomingData(id, data);
                this._updateMapStateForFeature(id, data, false);

                const extractedData = utils.extractHourlyDataPoint(data.hourly, idxDisplay);
                const { deskripsi } = utils.getWeatherInfo(extractedData.weather_code, extractedData.is_day); 
                
                items.push({
                    nama: data.nama_simpel,
                    suhu: `${extractedData.suhu?.toFixed(1) ?? '-'}°C`,
                    desc: deskripsi,
                    onClick: () => {
                        if (popupManager.getInstance() === loadingPopupRef) popupManager.close(true); 
                        const clickProps = {
                            id: data.id,
                            nama_simpel: data.nama_simpel,
                            nama_label: data.nama_label,
                            lat: data.latitude,
                            lon: data.longitude,
                            tipadm: data.tipadm
                        };
                        this.handleUnclusteredClick(clickProps); 
                    }
                });
            }

            const titleText = pointCount > 100 ? `Menampilkan 100 dari ${pointCount} Lokasi:` : `${pointCount} Lokasi:`;
            const popupContent = popupManager.generateClusterPopupContent(titleText, items);
            popupManager.setDOMContent(popupContent);
            
        } catch (error) {
            console.error('Gagal memuat data klaster:', error);
            if (loadingPopupRef && popupManager.getInstance() === loadingPopupRef) { 
                popupManager.setHTML('Gagal memuat data klaster.'); 
            }
        }
    }, 

    handleProvinceClick: function(props, coordinates) {
        const provinceProps = {
            id: props.id,
            nama_simpel: props.nama_simpel,
            nama_label: props.nama_label,
            lat: coordinates[1],
            lon: coordinates[0],
            tipadm: 1 
        };
        this.handleUnclusteredClick(provinceProps);
    }, 

    handleUnclusteredClick: function(props) {
        const { id, nama_simpel, nama_label, lat, lon, tipadm } = props; 
        const coordinates = [lon, lat];
        if (!coordinates || isNaN(coordinates[0]) || isNaN(coordinates[1])) { return; }
        
        console.log(`Handling Click: ${nama_simpel} (${id}, TIPADM: ${tipadm})`); 
        
        popupManager.close(true);

        const previousId = this._activeLocationId;
        if (previousId && previousId !== id) { 
             this.removeActiveMarkerHighlight(previousId, true); 
        }

        this._activeLocationId = id;
        this._activeLocationSimpleName = nama_simpel; 
        this._activeLocationLabel = nama_label; 
        this._previousActiveLocationId = previousId;

        this.setActiveMarkerHighlight(id); 

        const tipadmInt = parseInt(tipadm, 10);

        if (tipadmInt === 1) {
            this._activeLocationData = {
                id: id,
                nama_simpel: nama_simpel,
                nama_label: nama_label,
                tipadm: 1,
                type: 'provinsi'
            };
            
            this._isClickLoading = false;

            if (sidebarManager.isOpen()) {
                sidebarManager.renderSidebarContent(); 
            }

            const popupContent = popupManager.generateProvincePopupContent(nama_simpel, nama_label);
            popupManager.open(coordinates, popupContent);
            return; 
        }

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
        this._activeLocationData = null; 
        this._isClickLoading = true;
        
        const loadingContent = popupManager.generateLoadingPopupContent(props.nama_simpel);
        popupManager.open(coordinates, loadingContent);
        
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
    },

    _handleCacheHit: function(props, data, coordinates) {
        console.log(`Cache hit for ${props.id}.`);
        if (!data.nama_simpel) data.nama_simpel = props.nama_simpel;
        if (!data.nama_label) data.nama_label = props.nama_label;
        
        this._activeLocationData = data; 
        this._activeLocationData.tipadm = props.tipadm; 
        this._isClickLoading = false;
        
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
        
        this._renderRichPopup(data, coordinates);
    },

    _handleCacheMiss: async function(props, coordinates) {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = '5000';
        const baseUrl = `${protocol}//${hostname}:${port}`;
        
        const { id, nama_simpel, tipadm } = props; 
        
        this._activeLocationData = null;
        this._isClickLoading = true; 
        inflightIds.add(id);
        
        const loadingContent = popupManager.generateLoadingPopupContent(nama_simpel);
        const loadingPopupRef = popupManager.open(coordinates, loadingContent);
        
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
                this._activeLocationData.tipadm = tipadm;
                this._isClickLoading = false;
                this._updateMapStateForFeature(id, data, true); 
                
                this._renderRichPopup(data, coordinates);

                if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
            } else {
                this._updateMapStateForFeature(id, data, false); 
            }
        } catch (e) { 
            console.error(`Fetch failed for ${id}:`, e);
            if (this._activeLocationId === id) { 
                this._isClickLoading = false; 
                this._activeLocationData = null;
                
                this.removeActiveMarkerHighlight(id, true); 

                if (popupManager.getInstance() === loadingPopupRef) { 
                    popupManager.setHTML(`<b>${nama_simpel}</b><br>Gagal: ${e.message}`); 
                }
                if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent(); 
            }
        } finally { 
            inflightIds.delete(id);
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