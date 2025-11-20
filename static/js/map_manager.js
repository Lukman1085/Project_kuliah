import { cacheManager } from "./cache_manager.js";
import { utils, WMO_CODE_MAP } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { sidebarManager } from "./sidebar_manager.js";

export const inflightIds = new Set();

/** 🗺️ MAP MANAGER: Mengelola peta, layer, dan interaksi */
export const mapManager = { 
    _map: null, 
    _loadedImages: new Set(), 

    setMap: function(mapInstance) {
        this._map = mapInstance;
        console.log("Map instance telah di-set di mapManager.");
        
        if (mapInstance.loaded()) {
            this._loadMarkerImages();
        } else {
            mapInstance.once('style.load', () => this._loadMarkerImages());
        }
    },

    getMap: function() { return this._map; },

    // Fungsi untuk memuat sprite SVG ke MapLibre
    _loadMarkerImages: function() {
        const map = this.getMap();
        if (!map) return;

        // Pastikan path relatif benar
        const basePath = 'static/images/icons/';
        
        const imageList = [
            { name: 'icon-thermometer', url: basePath + 'wi-thermometer-internal.svg', sdf: true },
            { name: 'icon-raindrop', url: basePath + 'wi-raindrop.svg', sdf: true },
            { name: 'wi-na', url: basePath + 'wi-na.svg', sdf: false } // Fallback icon
        ];

        Object.values(WMO_CODE_MAP).forEach(val => {
            if (val[1]) imageList.push({ name: val[1], url: basePath + val[1] + '.svg', sdf: false });
            if (val[2]) imageList.push({ name: val[2], url: basePath + val[2] + '.svg', sdf: false });
        });

        console.log(`Memulai pemuatan ${imageList.length} ikon...`);
        
        imageList.forEach(img => {
            if (!map.hasImage(img.name) && !this._loadedImages.has(img.name)) {
                this._loadedImages.add(img.name);
                map.loadImage(img.url, (error, image) => {
                    if (error) {
                        // Fallback: Jika gagal muat (misal file kosong), jangan lakukan apa-apa
                        // MapLibre akan merender kosong, tapi tidak crash.
                        // Opsi: Load 'wi-na' sebagai gantinya jika perlu, tapi hati-hati infinite loop
                        this._loadedImages.delete(img.name);
                        return;
                    }
                    if (map && !map.hasImage(img.name)) {
                         map.addImage(img.name, image, { sdf: img.sdf });
                    }
                });
            }
        });
    },

    _isLoading: false, 
    _isClickLoading: false, 
    _activeLocationId: null,
    _activeLocationData: null,
    _previousActiveLocationId: null, 
    
    getIsLoading: function() { return this._isLoading; },
    getIsClickLoading: function() { return this._isClickLoading; },
    getActiveLocationId: function() { return this._activeLocationId; },
    getActiveLocationSimpleName: function() { return this._activeLocationData?.nama_simpel; },
    getActiveLocationLabel: function() { return this._activeLocationData?.nama_label; },
    getActiveLocationData: function() { return this._activeLocationData; },
    
    _sanitizeStateValue: function(val, fallback) {
        return (val === null || val === undefined || isNaN(Number(val))) ? fallback : Number(val);
    },

    setActiveMarkerHighlight: function(id) {
        const map = this.getMap(); 
        if (!id || !map || !map.getSource('data-cuaca-source')) return;
        try {
            map.setFeatureState({ source: 'data-cuaca-source', id: id }, { active: true }); 
        } catch (e) { }
    },

    removeActiveMarkerHighlight: function(idToRemove = null, forceRemove = false) { 
        const map = this.getMap(); 
        const targetId = idToRemove || this._previousActiveLocationId;
        if (!targetId || !map) return;

        if (!forceRemove && String(targetId) === String(this._activeLocationId) && (sidebarManager.isOpen() || popupManager.isOpen())) {
            return; 
        }
        try {
            map.setFeatureState({ source: 'data-cuaca-source', id: targetId }, { active: false });
        } catch (e) { }
        if (!idToRemove) this._previousActiveLocationId = null;
    },

    resetActiveLocationState: function() {
        const idToReset = this._activeLocationId;
        if (sidebarManager.isOpen()) {
             this.removeActiveMarkerHighlight(idToReset, false);
        } else {
            this._activeLocationId = null; 
            if (idToReset) this.removeActiveMarkerHighlight(idToReset, false); 
            this._activeLocationData = null;
            this._isClickLoading = false;
            this._previousActiveLocationId = null;
        }
    },

    // --- UPDATE LOGIC (IKON DINAMIS) ---
    updateMapFeaturesForTime: function(idxGlobal) {
        const map = this.getMap();
        if (!map || !map.getSource('data-cuaca-source')) return;

        const source = map.getSource('data-cuaca-source');
        const currentFeatures = source._data?.features || []; 
        
        if (currentFeatures.length === 0) return;

        const newFeatures = currentFeatures.map(f => {
            const id = f.id;
            const data = cacheManager.get(id);
            
            if (data && data.hourly?.time && idxGlobal < data.hourly.time.length) {
                const point = utils.extractHourlyDataPoint(data.hourly, idxGlobal);
                const { ikon } = utils.getWeatherInfo(point.weather_code, point.is_day);
                
                // Bersihkan nama kelas
                const cleanIconName = ikon.replace('wi ', '').trim();
                f.properties.weather_icon = cleanIconName; 
                
                map.setFeatureState(
                    { source: 'data-cuaca-source', id: id },
                    {
                        hasData: true,
                        suhu: this._sanitizeStateValue(point.suhu, -999),
                        precip: this._sanitizeStateValue(point.prob_presipitasi, -1),
                        active: (String(id) === String(this._activeLocationId))
                    }
                );
            } else {
                 f.properties.weather_icon = 'wi-na';
                 map.setFeatureState({ source: 'data-cuaca-source', id: id }, { hasData: false });
            }
            return f;
        });

        source.setData({ type: 'FeatureCollection', features: newFeatures });
    },

    dataController: null, 
    perbaruiPetaGeo: async function() {
        const map = this.getMap(); 
        if (!map) return; 
        
        const zoom = map.getZoom();
        const provinsiSource = map.getSource('provinsi-source');
        const cuacaSource = map.getSource('data-cuaca-source');

        if (zoom <= 7.99) {
             try {
                const protocol = window.location.protocol;
                const hostname = window.location.hostname;
                const port = '5000';
                const baseUrl = `${protocol}//${hostname}:${port}`;
                
                if(cuacaSource) cuacaSource.setData({ type: 'FeatureCollection', features: [] });

                const resp = await fetch(`${baseUrl}/api/provinsi-info`);
                if (resp.ok) {
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
                    if (provinsiSource) provinsiSource.setData({ type: 'FeatureCollection', features: features });
                }
             } catch (e) { console.error('Gagal ambil data provinsi:', e); }
             
        } else {
            if(provinsiSource) provinsiSource.setData({ type: 'FeatureCollection', features: [] });
            
            if (this.dataController) this.dataController.abort();
            this.dataController = new AbortController();
            const signal = this.dataController.signal;
            
            try {
                const bounds = map.getBounds();
                const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
                const port = '5000'; 
                const baseUrl = `${window.location.protocol}//${window.location.hostname}:${port}`;
                
                const resp = await fetch(`${baseUrl}/api/data-cuaca?bbox=${bbox}&zoom=${zoom}`, { signal });
                if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
                const geoOnly = await resp.json();
                
                const features = geoOnly.map(g => ({ 
                    type: 'Feature', 
                    id: g.id, 
                    geometry: { type: 'Point', coordinates: [g.lon, g.lat] }, 
                    properties: { 
                        id: g.id, 
                        nama_simpel: g.nama_simpel, 
                        nama_label: g.nama_label, 
                        tipadm: g.tipadm,
                        weather_icon: 'wi-na' 
                    } 
                }));
                
                if (cuacaSource) {
                    cuacaSource.setData({ type: 'FeatureCollection', features: features });
                    this.fetchDataForVisibleMarkers();
                }
            } catch (e) { if (e.name !== 'AbortError') console.error('Gagal update peta geo:', e); }
        }
    },

    fetchDataForVisibleMarkers: async function() {
        const map = this.getMap();
        if (!map) return;
        const zoom = map.getZoom();
        if (zoom <= 7.99 || this._isLoading) return;
        
        const visibleFeatures = map.queryRenderedFeatures({ layers: ['marker-anchor-circle'] }); 
        const idsToFetch = visibleFeatures.map(f => f.id).filter(id => id && !cacheManager.get(id) && !inflightIds.has(id));
        
        if (idsToFetch.length === 0) return;

        idsToFetch.forEach(id => inflightIds.add(id));
        this._isLoading = true;
        const spinner = document.getElementById('global-loading-spinner');
        if(spinner) spinner.style.display = 'block';

        const baseUrl = `${window.location.protocol}//${window.location.hostname}:5000`;
        try {
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${idsToFetch.join(',')}`);
            if (resp.ok) {
                const dataMap = await resp.json();
                let hasNewData = false;
                for (const id in dataMap) {
                    this._processIncomingData(id, dataMap[id]);
                    hasNewData = true;
                }
                if (hasNewData) {
                    this.updateMapFeaturesForTime(timeManager.getSelectedTimeIndex());
                }
            }
        } catch(e) { console.error("Fetch detail error:", e); }
        finally {
            idsToFetch.forEach(id => inflightIds.delete(id));
            this._isLoading = false;
            if(spinner) spinner.style.display = 'none';
        }
    },

    _processIncomingData: function(id, data) {
        if (!data) return;
        cacheManager.set(id, data);
        if (timeManager.getGlobalTimeLookup().length === 0 && data.hourly?.time) {
             timeManager.setGlobalTimeLookup(data.hourly.time);
             const startDate = new Date(data.hourly.time[0]);
             timeManager.initializeOrSync(startDate);
        }
    },

    handleUnclusteredClick: function(props) {
        const { id, nama_simpel, nama_label, lat, lon, tipadm } = props;
        const coordinates = [lon, lat];
        
        popupManager.close(true);
        
        const prevId = this._activeLocationId;
        if (prevId && prevId !== id) this.removeActiveMarkerHighlight(prevId, true);

        this._activeLocationId = id;
        this._activeLocationData = cacheManager.get(id); 
        
        if (!this._activeLocationData) {
             this._activeLocationData = { id, nama_simpel, nama_label, tipadm };
        }

        this.setActiveMarkerHighlight(id);
        
        if (!cacheManager.get(id)) {
             this._handleCacheMiss(props, coordinates);
        } else {
             this._renderRichPopup(this._activeLocationData, coordinates);
             if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
        }
    },

    _handleCacheMiss: async function(props, coordinates) {
        const { id, nama_simpel, tipadm } = props; 
        this._activeLocationData = null;
        this._isClickLoading = true; 
        inflightIds.add(id);
        
        const loadingContent = popupManager.generateLoadingPopupContent(nama_simpel);
        const loadingPopupRef = popupManager.open(coordinates, loadingContent);
        
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent(); 
        
        const baseUrl = `${window.location.protocol}//${window.location.hostname}:5000`;

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
                
                this.updateMapFeaturesForTime(timeManager.getSelectedTimeIndex());
                this._renderRichPopup(data, coordinates);

                if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
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
            
            this.updateMapFeaturesForTime(idxDisplay);

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
    }
};