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
    
    /** * FUNGSI BARU: Sanitasi Nilai State 
     * Mencegah crash 'Expected value to be of type number, but found null'
     */
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
            // Jika sudah aktif, jangan set ulang (optimasi)
            if (currentState.active) return; 

            const newState = {
                hasData: currentState.hasData || false,
                // Sanitasi data agar tidak null
                suhu: this._sanitizeStateValue(currentState.suhu, -999), 
                precip: this._sanitizeStateValue(currentState.precip, -1),
                active: true
            };
            map.setFeatureState({ source: 'data-cuaca-source', id: id }, newState); 
            console.log(`Highlight ON: ${id}`);
        } catch (e) { console.error("Error setting active highlight:", e); }
    },

    /**
     * LOGIKA BARU: Kill-Switch Highlight
     * @param {string|null} idToRemove - ID yang akan dimatikan
     * @param {boolean} forceRemove - JIKA TRUE, abaikan status sidebar/popup (Wajib mati)
     */
    removeActiveMarkerHighlight: function(idToRemove = null, forceRemove = false) { 
        const map = this.getMap(); 
        const targetId = idToRemove || this._previousActiveLocationId;

        if (!targetId || !map || !map.getSource('data-cuaca-source')) return;

        // Cek logika persisten (Hanya jika TIDAK dipaksa mati)
        if (!forceRemove) {
            const isTargetActive = (String(targetId) === String(this._activeLocationId));
            const isSidebarOpen = sidebarManager.isOpen();
            const isPopupOpen = popupManager.isOpen();

            // Jika target masih menjadi lokasi aktif DAN UI masih terbuka, pertahankan highlight
            if (isTargetActive && (isSidebarOpen || isPopupOpen)) {
                console.log(`Menahan highlight untuk ${targetId} (Sidebar: ${isSidebarOpen}, Popup: ${isPopupOpen})`);
                return; 
            }
        }

        console.log(`Highlight OFF: ${targetId} (Force: ${forceRemove})`);
        try {
            const currentState = map.getFeatureState({ source: 'data-cuaca-source', id: targetId });
            // Hanya update jika statusnya aktif
            if (currentState?.active) {
                const newState = {
                    hasData: currentState.hasData || false,
                    suhu: this._sanitizeStateValue(currentState.suhu, -999),
                    precip: this._sanitizeStateValue(currentState.precip, -1),
                    active: false
                };
                map.setFeatureState({ source: 'data-cuaca-source', id: targetId }, newState);
            }
        } catch (e) { console.error("Error removing highlight:", e); }

        if (!idToRemove) {
            this._previousActiveLocationId = null;
        }
    },

    resetActiveLocationState: function() {
        // Dipanggil saat Popup ditutup atau klik area kosong
        console.log("Resetting active location state...");
        
        const idToReset = this._activeLocationId;
        
        // Cek apakah sidebar masih terbuka? Jika ya, jangan reset ID global, hanya coba remove highlight via logic persisten
        // TAPI, instruksi Tuan: "Terhapus HANYA saat Sidebar tertutup DAN popup ditutup"
        
        if (sidebarManager.isOpen()) {
             // Jika sidebar buka, jangan null-kan _activeLocationId, karena sidebar butuh referensi
             // Coba remove highlight, tapi logic removeActiveMarkerHighlight(force=false) akan menahannya
             this.removeActiveMarkerHighlight(idToReset, false);
        } else {
            // Jika sidebar tutup dan popup tutup (karena fungsi ini dipanggil popup close), maka reset total
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
                            tipadm: 1, // PENTING: Marker provinsi
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
    
    _updateMapStateForFeature: function(id, data, isActive) {
        const map = this.getMap(); 
        if (!map) return;

        const idxSaatIni = timeManager.getSelectedTimeIndex();
        if (data?.hourly?.time && idxSaatIni >= 0 && idxSaatIni < data.hourly.time.length) {
            const suhu = data.hourly.temperature_2m?.[idxSaatIni];
            const precip = data.hourly.precipitation_probability?.[idxSaatIni];
            try {
                map.setFeatureState(
                    { source: 'data-cuaca-source', id: id },
                    {
                        hasData: true,
                        // PENTING: Gunakan sanitasi agar tidak crash
                        suhu: this._sanitizeStateValue(suhu, -999),
                        precip: this._sanitizeStateValue(precip, -1),
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

    // --- FUNGSI-FUNGSI HANDLE KLIK ---

    handleClusterClick: function(feature, coordinates) {
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
        
        source.getClusterLeaves(clusterId, 100, 0, (err, leaves) => { 
            if (err) { return; }
            const loadingPopupRef = popupManager.open(coordinates, 'Memuat data klaster...');
            if (!loadingPopupRef) return;
            const idsToFetch = leaves.map(leaf => leaf.id || leaf.properties.id).filter(Boolean);

            fetch(`${baseUrl}/api/data-by-ids?ids=${idsToFetch.join(',')}`)
            .then(response => response.json())
            .then(dataDetailCuaca => {
                if (popupManager.getInstance() !== loadingPopupRef) { return; } 
                
                const popupContent = document.createElement('div');
                popupContent.className = 'cluster-popup-content'; 
                
                const title = document.createElement('b');
                title.textContent = pointCount > 100 ? `Menampilkan 100 dari ${pointCount} Lokasi:` : `${pointCount} Lokasi:`;
                
                popupContent.appendChild(title);
                popupContent.appendChild(document.createElement('hr'));
                
                const idxDisplay = timeManager.getSelectedTimeIndex();

                for (const id in dataDetailCuaca) {
                        const data = dataDetailCuaca[id];
                        if (!data) continue; 
                        
                        if (!cacheManager.get(id)) this._processIncomingData(id, data);
                        this._updateMapStateForFeature(id, data, false);

                        const extractedData = utils.extractHourlyDataPoint(data.hourly, idxDisplay);
                        const displayData = { 
                            nama_simpel: data.nama_simpel, 
                            suhu: extractedData.suhu, 
                            code: extractedData.weather_code, 
                            is_day: extractedData.is_day 
                        };
                        const { deskripsi } = utils.getWeatherInfo(displayData.code, displayData.is_day); 
                        const item = document.createElement('div');
                        item.className = 'cluster-item'; 
                        
                        const textContent = `${displayData.nama_simpel} (${displayData.suhu?.toFixed(1) ?? '-'}°C, ${deskripsi})`;
                        item.textContent = textContent;
                        
                        item.addEventListener('click', (event) => {
                            event.stopPropagation();
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
                        });
                        popupContent.appendChild(item);
                }
                popupManager.setDOMContent(popupContent);
            })
            .catch(error => {
                    if (popupManager.getInstance() === loadingPopupRef) { popupManager.setHTML('Gagal memuat data klaster.'); }
            });
        });
    }, 

    handleProvinceClick: function(props, coordinates) {
        // Reroute ke handleUnclusteredClick agar logika terpusat
        const provinceProps = {
            id: props.id,
            nama_simpel: props.nama_simpel,
            nama_label: props.nama_label,
            lat: coordinates[1],
            lon: coordinates[0],
            tipadm: 1 // Paksa 1
        };
        this.handleUnclusteredClick(provinceProps);
    }, 

    handleUnclusteredClick: function(props) {
        const { id, nama_simpel, nama_label, lat, lon, tipadm } = props; 
        const coordinates = [lon, lat];
        if (!coordinates || isNaN(coordinates[0]) || isNaN(coordinates[1])) { return; }
        
        console.log(`Handling Click: ${nama_simpel} (${id}, TIPADM: ${tipadm})`); 
        
        // 1. Tutup popup LAMA (Internal Action)
        popupManager.close(true);

        // 2. FORCE REMOVE Highlight lama (Kill-Switch)
        // Ini menjamin hanya 1 marker yang aktif
        const previousId = this._activeLocationId;
        if (previousId && previousId !== id) { 
             this.removeActiveMarkerHighlight(previousId, true); // FORCE = true
        }

        // 3. Set ID Aktif BARU
        this._activeLocationId = id;
        this._activeLocationSimpleName = nama_simpel; 
        this._activeLocationLabel = nama_label; 
        this._previousActiveLocationId = previousId;

        // 4. Set highlight BARU
        this.setActiveMarkerHighlight(id); 

        const tipadmInt = parseInt(tipadm, 10);

        // KASUS A: PROVINSI (TIPADM 1)
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

        // KASUS B: NON-PROVINSI (TIPADM > 1)
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
        popupManager.open(coordinates, `<b>${props.nama_simpel}</b><br>Memuat data...`);
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
        
        // [AUDIT FIX 1] Langsung render popup (renderRichPopup akan melakukan .open())
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
        
        // Buka popup loading dulu
        const loadingPopupRef = popupManager.open(coordinates, `<b>${nama_simpel}</b><br>Memuat data...`);
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent(); 
        
        try {
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${id}`);
            if (!resp.ok) throw new Error(`Network error ${resp.status}`);
            const dataMap = await resp.json();
            
            if (!dataMap?.[id]) throw new Error("Data lokasi tidak ditemukan");
            const data = dataMap[id];
            
            this._processIncomingData(id, data);
            
            // Pastikan ID masih aktif (user belum klik tempat lain saat loading)
            if (this._activeLocationId === id) {
                this._activeLocationData = data;
                this._activeLocationData.tipadm = tipadm;
                this._isClickLoading = false;
                this._updateMapStateForFeature(id, data, true); 
                
                // [AUDIT FIX 1] Panggil renderRichPopup yang sekarang aman
                this._renderRichPopup(data, coordinates);

                if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
            } else {
                // Jika user sudah pindah, jangan highlight, tapi simpan data di map state (non-aktif)
                this._updateMapStateForFeature(id, data, false); 
            }
        } catch (e) { 
            console.error(`Fetch failed for ${id}:`, e);
            if (this._activeLocationId === id) { 
                this._isClickLoading = false; 
                this._activeLocationData = null;
                
                // [AUDIT FIX 2] Matikan Highlight jika fetch gagal untuk mencegah error WebGL "Zombie State"
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

        // [AUDIT FIX 1] Logika Popup yang benar: Buka popup baru, jangan hanya setContent
        if (hasGlobalTimeDataNow && localTimeStringNow && data.hourly?.time && idxLocal < data.hourly.time.length) {
            const popupData = utils.extractHourlyDataPoint(data.hourly, idxLocal);
            const { deskripsi, ikon } = utils.getWeatherInfo(popupData.weather_code, popupData.is_day);
            const formattedTime = utils.formatLocalTimestampString(localTimeStringNow); 
            
            const popupContentElement = popupManager.generatePopupContent(data.nama_simpel, popupData, deskripsi, ikon, formattedTime);
            
            // GANTI INI: popupManager.setDOMContent(popupElement); 
            // MENJADI INI: Buka paksa popupnya
            popupManager.open(coordinates, popupContentElement);
            
        } else {
            // Fallback text
            const content = `<b>${data.nama_simpel}</b><br>${hasGlobalTimeDataNow ? 'Data cuaca tidak valid.' : 'Data waktu belum siap.'}`;
            popupManager.open(coordinates, content);
        }
    }
};