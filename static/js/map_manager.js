import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { sidebarManager } from "./sidebar_manager.js";

export const inflightIds = new Set();

/** 🗺️ MAP MANAGER */
export const mapManager = { 
    _map: null, 
    _markers: {}, 
    _lastClusterFeature: null,

    setMap: function(mapInstance) {
        this._map = mapInstance;
        console.log("Map instance telah di-set di mapManager.");
        mapInstance.on('move', () => { this.renderMarkers(); });
        mapInstance.on('moveend', () => { this.renderMarkers(); });
    },

    getMap: function() {
        if (!this._map) { console.error("mapManager.getMap() dipanggil sebelum map di-set!"); return null; }
        return this._map;
    },

    _isLoading: false, _isClickLoading: false, _activeLocationId: null, _activeLocationSimpleName: null, _activeLocationLabel: null, _activeLocationData: null, _previousActiveLocationId: null,
    getIsLoading: function() { return this._isLoading; }, getIsClickLoading: function() { return this._isClickLoading; }, getActiveLocationId: function() { return this._activeLocationId; }, getActiveLocationSimpleName: function() { return this._activeLocationSimpleName; }, getActiveLocationLabel: function() { return this._activeLocationLabel; }, getActiveLocationData: function() { return this._activeLocationData; },
    
    renderMarkers: function() {
        const map = this.getMap();
        if (!map) return;

        // Query kedua layer hit target
        const features = map.queryRenderedFeatures({ 
            layers: ['unclustered-point-hit-target', 'provinsi-point-hit-target'] 
        });
        
        const currentIds = new Set();

        features.forEach(feature => {
            const id = feature.id; 
            // [SAFETY] Pastikan ID valid sebelum lanjut
            if (id === undefined || id === null) return;

            const coords = feature.geometry.coordinates;
            const props = feature.properties;
            const lat = coords[1];
            
            currentIds.add(String(id));

            const zIndexBase = Math.round((90 - lat) * 100);

            if (!this._markers[id]) {
                const markerEl = this._createMarkerElement(id, props);
                markerEl.style.zIndex = zIndexBase;

                const newMarker = new maplibregl.Marker({
                    element: markerEl,
                    anchor: 'bottom', 
                    offset: [0, 0]    
                })
                .setLngLat(coords)
                .addTo(map);

                this._markers[id] = newMarker;
                this._updateMarkerContent(id); 
                
                if (String(id) === String(this._activeLocationId)) {
                     this._applyHighlightStyle(id, true);
                }
            } else {
                // Update Z-Index agar sorting tetap benar saat panning
                this._markers[id].getElement().style.zIndex = zIndexBase;
            }
        });

        for (const id in this._markers) {
            if (!currentIds.has(id)) {
                this._markers[id].remove();
                delete this._markers[id];
            }
        }
    },

    _createMarkerElement: function(id, props) {
        const safeId = String(id).replace(/\./g, '-');
        const tipadm = parseInt(props.tipadm, 10);
        const isProvince = (tipadm === 1);

        const container = document.createElement('div');
        container.className = 'marker-container'; 
        container.id = `marker-${safeId}`;
        
        if (isProvince) {
            // Marker Provinsi
            container.innerHTML = `
                <div class="location-badge province-badge">${props.nama_simpel}</div>
                <div class="marker-capsule marker-theme-province" id="capsule-${safeId}">
                    <div class="main-icon-wrapper">
                        <i class="wi wi-stars" style="font-size: 16px;"></i>
                    </div>
                    <div class="status-stack-province">
                        <span style="font-size:10px; font-weight:bold; color:#555;">PROV</span>
                    </div>
                </div>
                <div class="marker-anchor"></div>
            `;
        } else {
            // Marker Cuaca
            container.innerHTML = `
                <div class="location-badge">${props.nama_simpel}</div>
                <div class="marker-capsule" id="capsule-${safeId}">
                    <div class="main-icon-wrapper"><i id="icon-weather-${safeId}" class="wi wi-na"></i></div>
                    <div class="status-stack">
                        <div class="thermo-stack">
                            <i class="wi wi-thermometer-internal thermo-liquid" id="icon-thermo-${safeId}"></i>
                            <i class="wi wi-thermometer-exterior thermo-frame"></i>
                        </div>
                        <div class="rain-icon-box"><i class="wi wi-raindrop" id="icon-rain-${safeId}"></i></div>
                    </div>
                </div>
                <div class="marker-anchor"></div><div class="marker-pulse"></div>
            `;
        }

        container.addEventListener('click', (e) => {
            e.stopPropagation(); 
            if (isProvince) {
                // Ambil koordinat dari marker instance karena props mungkin tidak akurat
                let coords = [null, null];
                if (this._markers[id]) coords = this._markers[id].getLngLat().toArray();
                
                const provProps = { id: id, nama_simpel: props.nama_simpel, nama_label: props.nama_label, lat: coords[1], lon: coords[0], tipadm: 1 };
                this.handleUnclusteredClick(provProps);
            } else {
                this.handleUnclusteredClick({ id: id, nama_simpel: props.nama_simpel, nama_label: props.nama_label, lat: null, lon: null, tipadm: props.tipadm });
            }
        });
        return container;
    },

    _updateMarkerContent: function(id) {
        const markerInstance = this._markers[id];
        if (!markerInstance) return;
        
        const el = markerInstance.getElement();
        // Skip update untuk provinsi (efisiensi)
        if (el.querySelector('.marker-theme-province')) return; 

        const safeId = String(id).replace(/\./g, '-');
        
        const capsuleEl = el.querySelector(`#capsule-${safeId}`);
        const weatherIconEl = el.querySelector(`#icon-weather-${safeId}`);
        const thermoIconEl = el.querySelector(`#icon-thermo-${safeId}`);
        const rainIconEl = el.querySelector(`#icon-rain-${safeId}`);

        const cachedData = cacheManager.get(id);
        const idx = timeManager.getSelectedTimeIndex();

        if (cachedData && cachedData.hourly?.time && idx < cachedData.hourly.time.length) {
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
        } else {
            if (capsuleEl) capsuleEl.className = 'marker-capsule marker-theme-cloudy'; 
            if (weatherIconEl) weatherIconEl.className = 'wi wi-na';
            if (thermoIconEl) thermoIconEl.style.color = '#ccc';
            if (rainIconEl) rainIconEl.style.color = '#ccc';
            el.style.opacity = 0.7;
        }
    },

    updateAllMarkersForTime: function() {
        for (const id in this._markers) { this._updateMarkerContent(id); }
    },
    
    _applyHighlightStyle: function(id, isActive) {
        if (this._markers[id]) {
            const safeId = String(id).replace(/\./g, '-');
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
                // Z-Index akan direset oleh renderMarkers pada move berikutnya
            }
        }
    },

    setActiveMarkerHighlight: function(id) { this._applyHighlightStyle(id, true); },
    removeActiveMarkerHighlight: function(idToRemove = null, forceRemove = false) { 
        const targetId = idToRemove || this._previousActiveLocationId;
        if (!targetId) return;
        if (!forceRemove) {
            const isTargetActive = (String(targetId) === String(this._activeLocationId));
            if (isTargetActive && (sidebarManager.isOpen() || popupManager.isOpen())) { return; }
        }
        this._applyHighlightStyle(targetId, false);
        if (!idToRemove) { this._previousActiveLocationId = null; }
    },
    resetActiveLocationState: function() {
        const idToReset = this._activeLocationId;
        if (sidebarManager.isOpen()) { this.removeActiveMarkerHighlight(idToReset, false); } 
        else {
            this._activeLocationId = null; 
            if (idToReset) { this.removeActiveMarkerHighlight(idToReset, false); }
            this._activeLocationSimpleName = null; this._activeLocationLabel = null; 
            this._activeLocationData = null; this._isClickLoading = false; this._previousActiveLocationId = null;
            if (timeManager.getGlobalTimeLookup().length > 0) { timeManager.updateUIWithRealData(); } 
            else { timeManager.updateTimePickerDisplayOnly(); }
        }
    },

    dataController: null, 
    perbaruiPetaGeo: async function() {
            const map = this.getMap(); 
            if (!map) return; 
            const protocol = window.location.protocol; const hostname = window.location.hostname; const port = '5000'; const baseUrl = `${protocol}//${hostname}:${port}`;
            if (this.dataController) this.dataController.abort();
            this.dataController = new AbortController();
            const signal = this.dataController.signal;
            cacheManager.cleanExpired();
            const zoom = map.getZoom();
            const cuacaSource = () => map.getSource('data-cuaca-source');
            const provinsiSource = () => map.getSource('provinsi-source');
            if (zoom <= 7.99) { 
                for (const id in this._markers) { this._markers[id].remove(); }
                this._markers = {};
                if (cuacaSource()) cuacaSource().setData({ type: 'FeatureCollection', features: [] });
                try {
                    const resp = await fetch(`${baseUrl}/api/provinsi-info`, { signal });
                    if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
                    const provinsiData = await resp.json();
                    
                    // [PERBAIKAN FATAL] Tambahkan ID di level root feature
                    const features = provinsiData.map(p => ({ 
                        type: 'Feature', 
                        id: p.id, // <--- PENTING: ID harus ada di sini!
                        geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, 
                        properties: { id: p.id, nama_simpel: p.nama_simpel, nama_label: p.nama_label, tipadm: 1, type: 'provinsi' } 
                    }));
                    
                    if (provinsiSource()) provinsiSource().setData({ type: 'FeatureCollection', features: features });
                    
                    // Trigger render marker untuk provinsi
                    this.renderMarkers();

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
                    const features = geoOnly.map(g => ({ type: 'Feature', id: g.id, geometry: { type: 'Point', coordinates: [g.lon, g.lat] }, properties: { id: g.id, nama_simpel: g.nama_simpel || 'N/A', nama_label: g.nama_label || 'N/A', type: 'kabkec', tipadm: g.tipadm } }));
                    if (cuacaSource()) cuacaSource().setData({ type: 'FeatureCollection', features: features });
                    this.renderMarkers();
                } catch (e) { if (e.name !== 'AbortError') console.error('Gagal ambil geo only data:', e); }
            }
    },
    fetchDataForVisibleMarkers: async function() {
        const map = this.getMap();
        if (!map) return;
        const protocol = window.location.protocol; const hostname = window.location.hostname; const port = '5000'; const baseUrl = `${protocol}//${hostname}:${port}`;
        const loadingSpinner = document.getElementById('global-loading-spinner');
        const zoom = map.getZoom();
        if (zoom <= 7.99 || this._isLoading) return;
        const visibleFeatures = map.queryRenderedFeatures({ layers: ['unclustered-point-hit-target'] });
        const idsToFetch = visibleFeatures.map(f => f.id).filter(id => id && !cacheManager.get(id) && !inflightIds.has(id));
        let isFirstLoad = (timeManager.getGlobalTimeLookup().length === 0); 
        if (isFirstLoad && !idsToFetch.length && visibleFeatures.length > 0) {
            const firstVisibleId = visibleFeatures[0].id;
            if (firstVisibleId && !inflightIds.has(firstVisibleId)) { idsToFetch.push(firstVisibleId); }
        } else if (!idsToFetch.length) { return; }
        idsToFetch.forEach(id => inflightIds.add(id));
        this._isLoading = true; 
        if (!isFirstLoad && loadingSpinner) { loadingSpinner.style.display = 'block'; }
        try {
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${idsToFetch.join(',')}`);
            if (!resp.ok) throw new Error(`Network error ${resp.status}`);
            const dataMap = await resp.json();
            for (const id in dataMap) {
                const data = dataMap[id];
                const didInitTime = this._processIncomingData(id, data);
                if (isFirstLoad && didInitTime) { isFirstLoad = false; }
                const isActive = (String(id) === String(this._activeLocationId));
                if (isActive && this._isClickLoading) {
                    this._isClickLoading = false; this._activeLocationData = data;
                    if (sidebarManager.isOpen()) { sidebarManager.renderSidebarContent(); }
                }
            }
        } catch (e) { console.error("Gagal BBOX fetch:", e); }
        finally {
            idsToFetch.forEach(id => inflightIds.delete(id));
            this._isLoading = false; 
            if (loadingSpinner) loadingSpinner.style.display = 'none';
            this.updateAllMarkersForTime(); 
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

    handleClusterClick: async function(feature, coordinates) { 
        const map = this.getMap(); if (!map) return;
        const protocol = window.location.protocol; const hostname = window.location.hostname; const port = '5000'; const baseUrl = `${protocol}//${hostname}:${port}`;
        popupManager.close(true); 
        this._lastClusterFeature = { feature, coordinates };
        const clusterId = feature.properties.cluster_id; const source = map.getSource('data-cuaca-source'); 
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
            
            const generateItems = () => {
                const idxDisplay = timeManager.getSelectedTimeIndex();
                const items = [];
                for (const id in dataDetailCuaca) {
                    const data = dataDetailCuaca[id];
                    if (!data) continue; 
                    if (!cacheManager.get(id)) this._processIncomingData(id, data);
                    const extractedData = utils.extractHourlyDataPoint(data.hourly, idxDisplay);
                    const { deskripsi, ikon } = utils.getWeatherInfo(extractedData.weather_code, extractedData.is_day); 
                    items.push({
                        nama: data.nama_simpel,
                        suhu: `${extractedData.suhu?.toFixed(1) ?? '-'}°C`,
                        desc: deskripsi,
                        icon: ikon, 
                        onClick: () => {
                            if (popupManager.getInstance() === loadingPopupRef) popupManager.close(true); 
                            const clickProps = { id: data.id, nama_simpel: data.nama_simpel, nama_label: data.nama_label, lat: data.latitude, lon: data.longitude, tipadm: data.tipadm };
                            this.handleUnclusteredClick(clickProps); 
                        }
                    });
                }
                return {
                    title: pointCount > 100 ? `Menampilkan 100 dari ${pointCount} Lokasi:` : `${pointCount} Lokasi:`,
                    items: items
                };
            };
            popupManager.setClusterGenerator(generateItems);
            
            // [PERBAIKAN] Set tipe popup secara eksplisit agar updateUIForTime bekerja
            popupManager._activePopupType = 'cluster';

            const initialData = generateItems();
            const popupContent = popupManager.generateClusterPopupContent(initialData.title, initialData.items);
            popupManager.setDOMContent(popupContent);
            this.updateAllMarkersForTime();
        } catch (error) { console.error('Gagal memuat data klaster:', error); if (loadingPopupRef && popupManager.getInstance() === loadingPopupRef) { popupManager.setHTML('Gagal memuat data klaster.'); } }
    }, 
    
    handleProvinceClick: function(props, coordinates) { 
        let finalCoords = coordinates;
        // Jika koordinat null (dari klik marker), ambil dari instance
        if ((!finalCoords || !finalCoords[0]) && this._markers[props.id]) {
            finalCoords = this._markers[props.id].getLngLat().toArray();
        }
        const provinceProps = { id: props.id, nama_simpel: props.nama_simpel, nama_label: props.nama_label, lat: finalCoords[1], lon: finalCoords[0], tipadm: 1 }; 
        this.handleUnclusteredClick(provinceProps); 
    }, 
    
    handleUnclusteredClick: function(props) {
        const { id, nama_simpel, nama_label, lat, lon, tipadm } = props;
        
        // Safety check jika koordinat masih null
        let coordinates = [lon, lat];
        if (this._markers[id]) { coordinates = this._markers[id].getLngLat().toArray(); }
        if (!coordinates || isNaN(coordinates[0])) return;

        console.log(`Handling Click: ${nama_simpel} (${id})`); 
        popupManager.close(true);
        this.resetActiveLocationState(); 
        this._activeLocationId = id; this._activeLocationSimpleName = nama_simpel; this._activeLocationLabel = nama_label;
        this.setActiveMarkerHighlight(id); 
        const tipadmInt = parseInt(tipadm, 10);
        if (tipadmInt === 1) {
            this._activeLocationData = { id: id, nama_simpel: nama_simpel, nama_label: nama_label, tipadm: 1, type: 'provinsi' };
            this._isClickLoading = false;
            if (sidebarManager.isOpen()) { sidebarManager.renderSidebarContent(); }
            const popupContent = popupManager.generateProvincePopupContent(nama_simpel, nama_label);
            popupManager.open(coordinates, popupContent); return; 
        }
        const cachedData = cacheManager.get(id);
        if (inflightIds.has(id)) { this._handleInflightState(props, coordinates); } else if (cachedData) { this._handleCacheHit(props, cachedData, coordinates); } else { this._handleCacheMiss(props, coordinates); }
    },
    _handleInflightState: function(props, coordinates) {
        this._activeLocationData = null; this._isClickLoading = true;
        const loadingContent = popupManager.generateLoadingPopupContent(props.nama_simpel); popupManager.open(coordinates, loadingContent);
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
    },
    _handleCacheHit: function(props, data, coordinates) {
        this._activeLocationData = data; this._activeLocationData.tipadm = props.tipadm; this._isClickLoading = false;
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
                this._activeLocationData = data; this._activeLocationData.tipadm = tipadm; this._isClickLoading = false;
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