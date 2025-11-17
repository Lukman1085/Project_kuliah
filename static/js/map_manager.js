import { cacheManager } from "./cache_manager";
import { utils } from "./utilities";
import { popupManager } from "./popup_manager";
import { timeManager } from "./time_manager";
import { sidebarManager } from "./sidebar_manager";

export const inflightIds = new Set();
/** 🗺️ MAP MANAGER: Mengelola semua logika terkait peta, layer, dan interaksi */
export const mapManager = { 
    // (Tidak ada perubahan di getter, highlight, reset)
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
    setActiveMarkerHighlight: function(id) {
            if (!id || !map || !map.getSource('data-cuaca-source')) return;
            console.log("Highlighting:", id);
            try {
            const currentState = map.getFeatureState({ source: 'data-cuaca-source', id: id }) || {};
            const newState = {
                hasData: currentState.hasData || false,
                suhu: currentState.suhu ?? -999,
                precip: currentState.precip ?? -1,
                active: true
            };
            if (!currentState.active) { 
                map.setFeatureState({ source: 'data-cuaca-source', id: id }, newState); 
            }
            } catch (e) { console.error("Error setting active highlight:", e); }
    },
    removeActiveMarkerHighlight: function(idToRemove = null) { 
        const targetId = idToRemove || this._previousActiveLocationId;
        if (targetId && map && map.getSource('data-cuaca-source')) {
            console.log("Removing highlight from:", targetId);
            try {
                const currentState = map.getFeatureState({ source: 'data-cuaca-source', id: targetId });
                if (currentState?.active) {
                    const newState = {
                        hasData: currentState.hasData || false,
                        suhu: currentState.suhu ?? -999,
                        precip: currentState.precip ?? -1,
                        active: false
                    };
                    map.setFeatureState({ source: 'data-cuaca-source', id: targetId }, newState);
                }
            } catch (e) { console.error("Error removing highlight:", e); }
        }
            if (!idToRemove) {
            this._previousActiveLocationId = null;
            }
    },
    resetActiveLocationState: function() {
        console.log("Resetting active location state...");
        const idToReset = this._activeLocationId;
        if (idToReset) { this.removeActiveMarkerHighlight(idToReset); } 
        this._activeLocationId = null;
        this._activeLocationSimpleName = null; 
        this._activeLocationLabel = null; 
        this._activeLocationData = null;
        this._isClickLoading = false;
        this._previousActiveLocationId = null;
        if (sidebarManager.isOpen()) { sidebarManager.renderSidebarContent(); } 
        if (timeManager.getGlobalTimeLookup().length > 0) {
                timeManager.updateUIWithRealData(); 
        } else {
                timeManager.updateTimePickerDisplayOnly(); 
        }
    },
    dataController: null, 
    perbaruiPetaGeo: async function() {
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
                        type: 'kabkec' 
                    } 
                }));
                if (cuacaSource()) cuacaSource().setData({ type: 'FeatureCollection', features: features });
                } catch (e) { if (e.name !== 'AbortError') console.error('Gagal ambil geo only data:', e); }
            }
    }, 
    fetchDataForVisibleMarkers: async function() {
        const zoom = map.getZoom();
        if (zoom <= 7.99 || this._isLoading) return;
        const visibleFeatures = map.queryRenderedFeatures({ layers: ['unclustered-point-temp-circle'] });
        const idsToFetch = visibleFeatures.map(f => f.id).filter(id => id && !cacheManager.get(id) && !inflightIds.has(id));
        let isFirstLoad = (timeManager.getGlobalTimeLookup().length === 0); 
        if (isFirstLoad && !idsToFetch.length && visibleFeatures.length > 0) {
            const firstVisibleId = visibleFeatures[0].id;
            if (firstVisibleId && !inflightIds.has(firstVisibleId)) {
                    console.log("Waktu belum di-init. Memaksa fetch 1 marker:", firstVisibleId);
                    idsToFetch.push(firstVisibleId);
            }
        } else if (!idsToFetch.length) {
            return; 
        }
        idsToFetch.forEach(id => inflightIds.add(id));
        this._isLoading = true; 
        if (!isFirstLoad) {
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
                    console.warn(`Feature ${id} data returned, but feature no longer in source. Skipping map state.`);
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
                    console.log(`Data for clicked inflight item ${id} has arrived via background fetch.`);
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
            loadingSpinner.style.display = 'none';
            if (!isFirstLoad) { 
                timeManager.updateMapFeaturesForTime(timeManager.getSelectedTimeIndex());
            }
        }
    }, 
    
    /** Memproses data yang masuk, menyimpan ke cache, dan menginisialisasi waktu jika perlu */
    _processIncomingData: function(id, data) {
        if (!data) {
            console.warn(`Data kosong diterima untuk ${id}`);
            return false; 
        }
        cacheManager.set(id, data);
        const isFirstLoad = (timeManager.getGlobalTimeLookup().length === 0);
        let didInitTime = false;
        
        // --- REFAKTOR (Proyek 2.1) ---
        // Logika inisialisasi dipindahkan ke timeManager
        if (isFirstLoad && data.hourly?.time?.length > 0) {
            timeManager.setGlobalTimeLookup(data.hourly.time);
            const realStartDate = new Date(data.hourly.time[0]);
            timeManager.initializeOrSync(realStartDate); // Memanggil fungsi terpusat
            didInitTime = true;
        }
        // --- Akhir Refaktor ---
        
        return didInitTime; 
    },
    
    _updateMapStateForFeature: function(id, data, isActive) {
        const idxSaatIni = timeManager.getSelectedTimeIndex();
        if (data?.hourly?.time && idxSaatIni >= 0 && idxSaatIni < data.hourly.time.length) {
            const suhu = data.hourly.temperature_2m?.[idxSaatIni];
            const precip = data.hourly.precipitation_probability?.[idxSaatIni];
            try {
                map.setFeatureState(
                    { source: 'data-cuaca-source', id: id },
                    {
                        hasData: true,
                        suhu: (suhu === null || suhu === undefined) ? -999 : suhu,
                        precip: (precip === null || precip === undefined) ? -1 : precip,
                        active: isActive 
                    }
                );
            } catch (e) {
                console.warn(`Gagal set state untuk feature ${id} (mungkin hilang dari peta):`, e.message);
            }
        } else {
            try {
                map.setFeatureState({ source: 'data-cuaca-source', id: id }, { hasData: false, active: isActive });
            } catch (e) {
                    console.warn(`Gagal set state 'noData' untuk feature ${id}:`, e.message);
            }
        }
    },

    // --- FUNGSI-FUNGSI HANDLE KLIK ---

    /** Menangani klik pada klaster */
    handleClusterClick: function(feature, coordinates) {
            console.log("Handling Cluster Click");
            popupManager.close(true);
            const clusterId = feature.properties.cluster_id;
            const source = map.getSource('data-cuaca-source'); 
            const pointCount = feature.properties.point_count;
            
            source.getClusterLeaves(clusterId, 100, 0, (err, leaves) => { // (Sudah direfaktor di Proyek 1)
                if (err) { console.error("Error getting cluster leaves:", err); return; }
                const loadingPopupRef = popupManager.open(coordinates, 'Memuat data klaster...');
                if (!loadingPopupRef) return;
                const idsToFetch = leaves.map(leaf => leaf.id || leaf.properties.id).filter(Boolean);
                if (!idsToFetch.length) { popupManager.setHTML("Tidak ada lokasi valid."); return; }
                
                fetch(`${baseUrl}/api/data-by-ids?ids=${idsToFetch.join(',')}`)
                .then(response => response.json())
                .then(dataDetailCuaca => {
                    if (popupManager.getInstance() !== loadingPopupRef) { return; } 
                    
                    const popupContent = document.createElement('div');
                    popupContent.className = 'cluster-popup-content'; 
                    popupContent.id = `cluster-popup-${clusterId}`;
                    
                    const title = document.createElement('b');
                    if (pointCount > 100) {
                        title.textContent = `Menampilkan 100 dari ${pointCount} Lokasi:`;
                    } else {
                        title.textContent = `${pointCount} Lokasi:`;
                    }
                    
                    popupContent.appendChild(title);
                    popupContent.appendChild(document.createElement('hr'));
                    
                    let itemsAdded = 0;
                    const idxDisplay = timeManager.getSelectedTimeIndex();
                    
                    // --- REFAKTOR (Proyek 2.1) ---
                    // Logika inisialisasi disentralisasi
                    if (timeManager.getGlobalTimeLookup().length === 0) { 
                            const firstId = Object.keys(dataDetailCuaca)[0];
                            if (firstId && dataDetailCuaca[firstId]) {
                                const data = dataDetailCuaca[firstId];
                                if (data.hourly?.time?.length > 0) {
                                    timeManager.setGlobalTimeLookup(data.hourly.time);
                                    const realStartDate = new Date(data.hourly.time[0]);
                                    timeManager.initializeOrSync(realStartDate); // PANGGILAN BARU
                                }
                            } else {
                                popupManager.setHTML("Data waktu belum siap."); 
                                return; 
                            }
                    }
                    // --- Akhir Refaktor ---

                    for (const id in dataDetailCuaca) {
                            const data = dataDetailCuaca[id];
                            if (!data) continue; 
                            
                            if (!cacheManager.get(id)) {
                                this._processIncomingData(id, data);
                            }
                            if (!data.hourly?.time || idxDisplay >= data.hourly.time.length) {
                                this._updateMapStateForFeature(id, data, false); 
                                continue; 
                            }
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
                            item.dataset.id = id; 
                            const namaSpan = document.createElement('span');
                            namaSpan.className = 'item-nama';
                            namaSpan.textContent = displayData.nama_simpel;
                            const suhuSpan = document.createElement('span');
                            suhuSpan.className = 'item-suhu';
                            suhuSpan.textContent = `${displayData.suhu?.toFixed(1) ?? '-'}°C`;
                            const descSpan = document.createElement('span');
                            descSpan.className = 'item-desc';
                            descSpan.textContent = deskripsi;
                            item.appendChild(namaSpan);
                            item.appendChild(document.createTextNode(' ('));
                            item.appendChild(suhuSpan);
                            item.appendChild(document.createTextNode(', '));
                            item.appendChild(descSpan);
                            item.appendChild(document.createTextNode(')'));
                            
                            item.addEventListener('click', (event) => {
                                event.stopPropagation();
                                if (popupManager.getInstance() === loadingPopupRef) {
                                    popupManager.close(true); 
                                }
                                const clickProps = {
                                    id: data.id,
                                    nama_simpel: data.nama_simpel,
                                    nama_label: data.nama_label,
                                    lat: data.latitude,
                                    lon: data.longitude
                                };
                                this.handleUnclusteredClick(clickProps); 
                            });
                            popupContent.appendChild(item);
                            itemsAdded++;
                    }
                    if (itemsAdded > 0) popupManager.setDOMContent(popupContent);
                    else popupManager.setHTML("Gagal memuat detail klaster.");
                })
                .catch(error => {
                        console.error('Error fetching/processing cluster data:', error);
                        if (popupManager.getInstance() === loadingPopupRef) { popupManager.setHTML('Gagal memuat data klaster.'); }
                    });
            });
    }, 

    /** Menangani klik pada marker provinsi. */
    handleProvinceClick: function(props, coordinates) {
        // (Tidak ada perubahan)
        console.log("Handling Province Click:", props.nama_label); 
        popupManager.close(true);
        const previousId = this._activeLocationId;
        this._activeLocationId = props.id;
        this._activeLocationSimpleName = props.nama_simpel; 
        this._activeLocationLabel = props.nama_label; 
        this._activeLocationData = { type: 'provinsi' }; 
        this._previousActiveLocationId = previousId;
        if (previousId && cacheManager.get(previousId)) { 
            this.removeActiveMarkerHighlight(previousId); 
        }
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent(); 
        const popupContent = document.createElement('div');
        const title = document.createElement('b');
        title.textContent = 'Provinsi:';
        popupContent.appendChild(title);
        popupContent.appendChild(document.createElement('br'));
        popupContent.appendChild(document.createTextNode(props.nama_simpel));
        popupContent.appendChild(document.createElement('br'));
        const zoomButton = document.createElement('button');
        zoomButton.textContent = 'Zoom ke Provinsi';
        zoomButton.addEventListener('click', () => {
            if (map) {
                map.easeTo({ center: coordinates, zoom: 8 });
            }
        });
        popupContent.appendChild(zoomButton);
        popupManager.open(coordinates, popupContent);
    }, 

    /** FASE 2: Menangani klik pada marker unclustered (Fungsi Kontroler Utama) */
    handleUnclusteredClick: function(props) {
        // (Tidak ada perubahan)
        const { id, nama_simpel, nama_label, lat, lon } = props; 
        const coordinates = [lon, lat];
        if (!coordinates || isNaN(coordinates[0]) || isNaN(coordinates[1])) { return; }
        console.log("Handling Unclustered Click:", nama_label, id); 
        popupManager.close(true);
        const previousId = this._activeLocationId;
        this._activeLocationId = id;
        this._activeLocationSimpleName = nama_simpel; 
        this._activeLocationLabel = nama_label; 
        this._previousActiveLocationId = previousId;
        if (previousId) { this.removeActiveMarkerHighlight(previousId); } 
        this.setActiveMarkerHighlight(id); 
        const cachedData = cacheManager.get(id);
        if (inflightIds.has(id)) {
            this._handleInflightState(props, coordinates);
        } else if (cachedData) { 
            this._handleCacheHit(props, cachedData, coordinates);
        } else {
            this._handleCacheMiss(props, coordinates);
        }
    },

    /** FASE 2: Helper untuk kasus data sedang di-fetch */
    _handleInflightState: function(props, coordinates) {
        // (Tidak ada perubahan)
        console.log(`Data for ${props.id} is inflight. Setting loading state.`);
        this._activeLocationData = null; 
        this._isClickLoading = true;
        popupManager.open(coordinates, `<b>${props.nama_simpel}</b><br>Memuat data...`);
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
    },

    /** FASE 2: Helper untuk kasus cache hit */
    _handleCacheHit: function(props, data, coordinates) {
        // (Tidak ada perubahan)
        console.log(`Cache hit for ${props.id}.`);
        if (!data.nama_simpel || !data.nama_label) {
            data.nama_simpel = props.nama_simpel;
            data.nama_label = props.nama_label;
            cacheManager.set(props.id, data);
        }
        this._activeLocationData = data;                    
        this._isClickLoading = false;
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
        const idxLocal = timeManager.getSelectedTimeIndex();
        const hasGlobalTimeData = timeManager.getGlobalTimeLookup().length > 0; 
        const localTimeString = hasGlobalTimeData ? timeManager.getGlobalTimeLookup()[idxLocal] : null;
        if (hasGlobalTimeData && localTimeString && data.hourly?.time && idxLocal < data.hourly.time.length) {
            const hourly = data.hourly;
            const popupData = utils.extractHourlyDataPoint(hourly, idxLocal);
            const { deskripsi, ikon } = utils.getWeatherInfo(popupData.weather_code, popupData.is_day);
            const formattedTime = utils.formatLocalTimestampString(localTimeString); 
            const popupElement = popupManager.generatePopupContent(this._activeLocationSimpleName, popupData, deskripsi, ikon, formattedTime);
            popupManager.open(coordinates, popupElement);
        } else {
                popupManager.open(coordinates, `<b>${this._activeLocationSimpleName}</b><br>${hasGlobalTimeData ? 'Data cuaca tidak valid.' : 'Data waktu belum siap.'}`);
        }
    },

    /** FASE 2: Helper untuk kasus cache miss (fetch baru). */
    _handleCacheMiss: async function(props, coordinates) {
        // (Tidak ada perubahan)
        const { id, nama_simpel, nama_label } = props; 
        console.log(`Cache miss for ${id}. Fetching...`);
        this._activeLocationData = null; 
        this._isClickLoading = true; 
        inflightIds.add(id);
        const loadingPopupRef = popupManager.open(coordinates, `<b>${nama_simpel}</b><br>Memuat...`);
        if (!loadingPopupRef) { 
            inflightIds.delete(id); 
            this._isClickLoading = false; 
            return; 
        }
        if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent(); 
        try {
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${id}`);
            if (!resp.ok) throw new Error(`Network error ${resp.status}`);
            const dataMap = await resp.json();
            if (!dataMap?.[id]) throw new Error("Data lokasi tidak ditemukan");
            const data = dataMap[id];
            console.log(`Fetch success for ${id}.`);
            this._processIncomingData(id, data);
            if (this._activeLocationId === id) {
                this._activeLocationData = data;
                this._isClickLoading = false;
                this._updateMapStateForFeature(id, data, true); 
                const idxLocal = timeManager.getSelectedTimeIndex();
                const hasGlobalTimeDataNow = timeManager.getGlobalTimeLookup().length > 0;
                const localTimeStringNow = hasGlobalTimeDataNow ? timeManager.getGlobalTimeLookup()[idxLocal] : null;
                if (hasGlobalTimeDataNow && localTimeStringNow && data.hourly?.time && idxLocal < data.hourly.time.length) {
                        if (popupManager.getInstance() === loadingPopupRef) {
                        const popupData = utils.extractHourlyDataPoint(data.hourly, idxLocal);
                        const { deskripsi, ikon } = utils.getWeatherInfo(popupData.weather_code, popupData.is_day);
                        const formattedTime = utils.formatLocalTimestampString(localTimeStringNow); 
                        const popupElement = popupManager.generatePopupContent(data.nama_simpel, popupData, deskripsi, ikon, formattedTime);
                        popupManager.setDOMContent(popupElement);
                        }
                } else if (popupManager.getInstance() === loadingPopupRef) {
                        popupManager.setHTML(`<b>${data.nama_simpel}</b><br>${hasGlobalTimeDataNow ? 'Data cuaca tidak valid.' : 'Data waktu belum siap.'}`);
                }
                if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent();
            } else {
                    this._updateMapStateForFeature(id, data, false); 
            }
        } catch (e) { 
            console.error(`Fetch failed for ${id}:`, e);
            if (this._activeLocationId === id) { 
                this._isClickLoading = false; 
                this._activeLocationData = null;
                if (popupManager.getInstance() === loadingPopupRef) { 
                    popupManager.setHTML(`<b>${nama_simpel}</b><br>Gagal: ${e.message}`); 
                }
                if (sidebarManager.isOpen()) sidebarManager.renderSidebarContent(); 
            }
        } finally { 
            inflightIds.delete(id);
        }
    } 
};