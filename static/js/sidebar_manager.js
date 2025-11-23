import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { mapManager } from "./map_manager.js";
import { cacheManager } from "./cache_manager.js"; 

/** ➡️ SIDEBAR MANAGER: Mengelola logika buka/tutup dan render sidebar */
export const sidebarManager = { 
    _isSidebarOpen: false,
    _subRegionData: null, 
    _observer: null, 

    // [STATE MANAGEMENT]
    _activeContentMode: 'weather', // 'weather' | 'gempa'
    _lastGempaData: null,          // Cache data gempa terakhir

    elements: {},

    initDOM: function(domElements) {
        this.elements = domElements;
        console.log("Elemen DOM Sidebar telah di-set di sidebarManager.");
        this._initIntersectionObserver();
    },

    _initIntersectionObserver: function() {
        const options = {
            root: this.elements.sidebarContentEl, 
            rootMargin: '50px', 
            threshold: 0.1
        };

        this._observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const target = entry.target;
                    const id = target.dataset.id;
                    if (id && !target.dataset.loaded) {
                        this._fetchSingleSubRegionWeather(id, target);
                        observer.unobserve(target);
                    }
                }
            });
        }, options);
    },

    _timeEl: null, _iconEl: null, _tempEl: null, _descEl: null,
    _feelsLikeEl: null, _humidityEl: null, _precipEl: null, _windEl: null,
    _dailyListEl: null,

    initWeatherElements: function(weatherElements) {
        this._timeEl = weatherElements.timeEl;
        this._iconEl = weatherElements.iconEl;
        this._tempEl = weatherElements.tempEl;
        this._descEl = weatherElements.descEl;
        this._feelsLikeEl = weatherElements.feelsLikeEl;
        this._humidityEl = weatherElements.humidityEl;
        this._precipEl = weatherElements.precipEl;
        this._windEl = weatherElements.windEl;
        this._dailyListEl = weatherElements.dailyListEl;
        console.log("Elemen Cuaca Sidebar telah di-set di sidebarManager.");
    },

    isOpen: function() {
        return this._isSidebarOpen;
    },

    openSidebar: function() {
        const { sidebarEl, toggleBtnEl } = this.elements;
        if (!sidebarEl || !toggleBtnEl || this._isSidebarOpen) return;
        
        sidebarEl.classList.add('sidebar-open');
        this._isSidebarOpen = true;
        toggleBtnEl.innerHTML = '&lt;';
        toggleBtnEl.setAttribute('aria-label', 'Tutup detail lokasi');
        
        this.renderSidebarContent(); 
        
        // Jika mode cuaca, pastikan highlight marker aktif kembali
        if (this._activeContentMode === 'weather') {
            const activeId = mapManager.getActiveLocationId();
            if(activeId) mapManager.setActiveMarkerHighlight(activeId); 
        }
    },

    closeSidebar: function() {
        const { sidebarEl, toggleBtnEl } = this.elements;
        if (!sidebarEl || !toggleBtnEl || !this._isSidebarOpen) return;
        
        sidebarEl.classList.remove('sidebar-open');
        this._isSidebarOpen = false;
        toggleBtnEl.innerHTML = '&gt;';
        toggleBtnEl.setAttribute('aria-label', 'Buka detail lokasi');
        
        const activeId = mapManager.getActiveLocationId();
        if (!activeId) { return } 
        
        mapManager.removeActiveMarkerHighlight(activeId, false); 
    },

    toggleSidebar: function() { 
        if (this._isSidebarOpen) this.closeSidebar(); else this.openSidebar(); 
    },

    openSidebarFromPopup: function() {
        const { sidebarContentEl } = this.elements;
        if (!this._isSidebarOpen) { this.openSidebar(); } 
        else { if (sidebarContentEl) sidebarContentEl.scrollTop = 0; }
        popupManager.close(true); 
    },

    /**
     * [FITUR BARU] Explicit Mode Switching (Dipanggil oleh Tombol Gempa / Map Manager)
     * @param {string} mode - 'weather' atau 'gempa'
     */
    switchToMode: function(mode) {
        if (mode !== 'weather' && mode !== 'gempa') return;
        
        console.log(`Sidebar switching mode to: ${mode}`);
        this._activeContentMode = mode;

        // Jika sidebar terbuka, render ulang konten sesuai mode baru
        if (this.isOpen()) {
            this.renderSidebarContent();
        }
    },

    resetContentMode: function() {
        this.switchToMode('weather');
    },

    _hideAllSidebarSections: function() {
        const { sidebarPlaceholderEl, sidebarLoadingEl, sidebarWeatherDetailsEl, sidebarProvinceDetailsEl, subRegionContainerEl, subRegionListEl } = this.elements;
        if (sidebarPlaceholderEl) sidebarPlaceholderEl.style.display = 'none';
        if (sidebarLoadingEl) sidebarLoadingEl.style.display = 'none';
        if (sidebarWeatherDetailsEl) sidebarWeatherDetailsEl.style.display = 'none';
        if (sidebarProvinceDetailsEl) sidebarProvinceDetailsEl.style.display = 'none';
        if (subRegionContainerEl) subRegionContainerEl.style.display = 'none';
        if (subRegionListEl) subRegionListEl.innerHTML = '';
        
        const gempaContainer = document.getElementById('sidebar-gempa-container');
        if (gempaContainer) {
            gempaContainer.style.display = 'none';
        }
    },

    _renderSidebarLoadingState: function() {
        const { sidebarLoadingEl, sidebarLocationNameEl } = this.elements;
        if (sidebarLoadingEl) sidebarLoadingEl.style.display = 'block';
        if (sidebarLocationNameEl) sidebarLocationNameEl.textContent = `Memuat ${mapManager.getActiveLocationSimpleName() || 'lokasi'}...`;
    },

    _renderSidebarPlaceholderState: function(customMessage = null) {
        const { sidebarPlaceholderEl, sidebarLocationNameEl } = this.elements;
        if (sidebarPlaceholderEl) {
            sidebarPlaceholderEl.textContent = customMessage || 'Pilih satu wilayah di peta.';
            sidebarPlaceholderEl.style.display = 'block';
        }
        if (sidebarLocationNameEl) sidebarLocationNameEl.textContent = 'Detail Lokasi';
    },

    _renderSidebarErrorState: function(message) {
        const { sidebarPlaceholderEl, sidebarLocationNameEl } = this.elements;
        if (sidebarPlaceholderEl) {
            sidebarPlaceholderEl.textContent = message || `Data tidak tersedia.`;
            sidebarPlaceholderEl.style.display = 'block';
        }
        if (sidebarLocationNameEl) {
            sidebarLocationNameEl.textContent = mapManager.getActiveLocationSimpleName() || 'Info';
        }
    },

    _renderSidebarProvinceState: function() {
        const { sidebarProvinceDetailsEl, sidebarLocationNameEl } = this.elements;
        if (!sidebarProvinceDetailsEl || !sidebarLocationNameEl) return;

        // Pastikan mode sinkron
        this._activeContentMode = 'weather';

        const container = sidebarProvinceDetailsEl;
        container.innerHTML = ''; 
        
        sidebarLocationNameEl.textContent = mapManager.getActiveLocationSimpleName();

        const now = new Date();
        const formattedDate = now.toLocaleDateString('id-ID', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        const cardHTML = `
            <div class="location-label-subtitle">
                ${mapManager.getActiveLocationLabel()}
            </div>
            
            <div class="weather-card-main" style="background: linear-gradient(135deg, #455A64 0%, #263238 100%); margin-bottom: 24px;">
                <div class="weather-header-time">${formattedDate}</div>
                
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 0;">
                    <div style="width: 70px; height: 70px; border-radius: 50%; background: rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; margin-bottom: 10px;">
                        <i class="wi wi-stars" style="font-size: 2.5rem; color: white;"></i>
                    </div>
                    <div style="font-size: 1.3rem; font-weight: 700;">PROVINSI</div>
                    <div style="font-size: 0.85rem; opacity: 0.8; margin-top: 5px;">Wilayah Administratif Tingkat I</div>
                </div>

                <div style="margin-top: 15px; text-align: center; font-size: 0.75rem; opacity: 0.8; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.2);">
                    Data Batas Wilayah: <strong>BIG</strong><br>
                    Data Cuaca Sub-Wilayah: <strong>OPENMETEO</strong>
                </div>
            </div>
        `;
        
        container.innerHTML = cardHTML;
        container.style.display = 'block';

        const activeData = mapManager.getActiveLocationData();
        this._subRegionData = null;
        this._fetchAndRenderSubRegions(activeData);
    },

    _createDailyForecastItem: function(date, code, maxT, minT, timeZone) {
        const { deskripsi, ikon } = utils.getWeatherInfo(code, 1);
        const item = document.createElement('div');
        item.className = 'daily-forecast-item';
        const daySpan = document.createElement('span');
        daySpan.className = 'daily-day';
        daySpan.textContent = utils.formatDayOnly(date, timeZone);
        const iconEl = document.createElement('i');
        iconEl.className = `daily-icon ${ikon}`;
        const descSpan = document.createElement('span');
        descSpan.className = 'daily-desc';
        descSpan.textContent = deskripsi;
        const tempSpan = document.createElement('span');
        tempSpan.className = 'daily-temp';
        tempSpan.textContent = `${maxT.toFixed(1)}° / ${minT.toFixed(1)}°`;
        item.appendChild(daySpan);
        item.appendChild(iconEl);
        item.appendChild(descSpan);
        item.appendChild(tempSpan);
        return item;
    },

    _renderSidebarWeatherState: function() {
        const { sidebarWeatherDetailsEl, sidebarLocationNameEl, sidebarEl } = this.elements;
        if (!sidebarWeatherDetailsEl || !sidebarLocationNameEl || !sidebarEl) return;
        
        // Pastikan mode sinkron
        this._activeContentMode = 'weather';

        const activeData = mapManager.getActiveLocationData();
        if (!activeData) {
            this._renderSidebarErrorState("Data lokasi aktif tidak ditemukan.");
            return;
        }

        sidebarWeatherDetailsEl.style.display = 'block';
        sidebarLocationNameEl.textContent = mapManager.getActiveLocationSimpleName();
        
        const labelEl = sidebarEl.querySelector('#sidebar-location-label-weather');
        if (labelEl) labelEl.textContent = mapManager.getActiveLocationLabel();

        const isProvinsi = (activeData.tipadm === 1);
        const currentConditionsEl = sidebarEl.querySelector('#sidebar-current-conditions');
        const dailyForecastTitleEl = sidebarEl.querySelector('#sidebar-daily-forecast-title');
        const dailyForecastListEl = sidebarEl.querySelector('#sidebar-daily-forecast-list');

        if (isProvinsi) {
            if (currentConditionsEl) currentConditionsEl.style.display = 'none';
            if (dailyForecastTitleEl) dailyForecastTitleEl.style.display = 'none';
            if (dailyForecastListEl) dailyForecastListEl.style.display = 'none';
            
            this._subRegionData = null;
            this._fetchAndRenderSubRegions(activeData);
            return; 
        } 
        
        if (currentConditionsEl) currentConditionsEl.style.display = 'block'; 
        if (dailyForecastTitleEl) dailyForecastTitleEl.style.display = 'block';
        if (dailyForecastListEl) dailyForecastListEl.style.display = 'flex';

        const daily = activeData.daily;
        const timeZone = activeData.timezone;
        const listContainer = this._dailyListEl;
        
        if (listContainer) {
            listContainer.innerHTML = ''; 
            if (daily?.time) {
                 const endIndex = Math.min(7, daily.time.length);
                 const fragment = document.createDocumentFragment();
                 for (let i = 0; i < endIndex; i++) {
                     const date = daily.time[i], code = daily.weather_code?.[i], maxT = daily.temperature_2m_max?.[i], minT = daily.temperature_2m_min?.[i];
                     if (date === undefined) continue;
                     const itemEl = this._createDailyForecastItem(date, code, maxT, minT, timeZone);
                     fragment.appendChild(itemEl);
                 }
                 listContainer.appendChild(fragment);
            } else { 
                const p = document.createElement('p'); p.textContent = 'Data harian tidak tersedia.'; listContainer.appendChild(p);
            }
        }

        const idx = timeManager.getSelectedTimeIndex();
        const lookup = timeManager.getGlobalTimeLookup();
        
        if (idx >= 0 && idx < lookup.length) {
            const timeStr = lookup[idx];
            this.updateUIForTime(idx, timeStr, activeData);
        } else {
            this.updateCurrentConditions(null, null, null);
        }
        
        this._subRegionData = null; 
        this._fetchAndRenderSubRegions(activeData); 
    },

    _fetchAndRenderSubRegions: async function(activeData) {
        const { subRegionContainerEl, subRegionLoadingEl, subRegionListEl, subRegionTitleEl } = this.elements;
        
        if (!activeData || !activeData.id) {
            return; 
        }

        const tipadm = Number(activeData.tipadm);
        if (tipadm >= 4) {
            if (subRegionContainerEl) subRegionContainerEl.style.display = 'none';
            return; 
        }

        if (subRegionContainerEl) subRegionContainerEl.style.display = 'block';
        if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'block';
        if (subRegionListEl) subRegionListEl.innerHTML = '';

        const titles = { 1: "Kab/Kota", 2: "Kecamatan", 3: "Kel/Desa" };
        const titleKey = tipadm; 
        if (subRegionTitleEl) subRegionTitleEl.textContent = `Prakiraan per ${titles[titleKey] || 'Wilayah Bawahan'}`;

        try {
            const protocol = window.location.protocol;
            const hostname = window.location.hostname;
            const port = '5000';
            const baseUrl = `${protocol}//${hostname}:${port}`;
            
            const url = `${baseUrl}/api/sub-wilayah-cuaca?id=${encodeURIComponent(activeData.id)}&tipadm=${tipadm}&view=simple`;

            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
            
            const simpleData = await resp.json();
            this._subRegionData = simpleData; 

            if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'none';

            if (!simpleData || simpleData.length === 0) {
                if (subRegionTitleEl) subRegionTitleEl.textContent = `Tidak ada data ${titles[titleKey] || 'sub-wilayah'}`;
                if (subRegionListEl) subRegionListEl.innerHTML = '<div style="padding:10px; text-align:center; color:#777;">Data sub-wilayah tidak tersedia.</div>';
                return;
            }
            
            this._renderSubRegionListSkeleton(simpleData);

            if (timeManager.getGlobalTimeLookup().length === 0 && simpleData.length > 0) {
                const firstId = simpleData[0].id;
                const firstEl = document.getElementById(`sub-region-${firstId}`);
                if (firstEl) {
                    this._fetchSingleSubRegionWeather(firstId, firstEl);
                }
            }

        } catch (e) {
            console.error("Gagal fetch sub-wilayah:", e);
            if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'none';
            if (subRegionTitleEl) subRegionTitleEl.textContent = "Gagal memuat data";
            if (subRegionListEl) subRegionListEl.innerHTML = `<div style="padding:10px; text-align:center; color:red;">Error: ${e.message}</div>`;
        }
    },

    _renderSubRegionListSkeleton: function(simpleData) {
        const { subRegionListEl } = this.elements;
        if (!subRegionListEl) return;
        
        subRegionListEl.innerHTML = ''; 
        const fragment = document.createDocumentFragment();
        
        simpleData.forEach(item => {
            const div = document.createElement('div');
            div.className = 'sub-region-item skeleton-mode'; 
            div.id = `sub-region-${item.id}`;
            div.dataset.id = item.id; 
            
            const cached = cacheManager.get(item.id);
            if (cached) {
                this._fillSubRegionItem(div, cached);
                div.dataset.loaded = "true";
            } else {
                div.innerHTML = `
                    <div class="sub-region-info-col">
                        <span class="sub-region-item-name">${item.nama_simpel}</span>
                        <span class="sub-region-item-desc skeleton-loading"></span>
                    </div>
                    <i class="sub-region-item-icon skeleton-loading"></i>
                    <span class="sub-region-item-temp skeleton-loading"></span>
                `;
                if (this._observer) {
                    this._observer.observe(div);
                }
            }
            
            fragment.appendChild(div);
        });
        
        subRegionListEl.appendChild(fragment);
    },

    _fetchSingleSubRegionWeather: async function(id, element) {
        const cached = cacheManager.get(id);
        if (cached) {
            this._fillSubRegionItem(element, cached);
            element.dataset.loaded = "true";
            return;
        }

        try {
            const protocol = window.location.protocol;
            const hostname = window.location.hostname;
            const port = '5000';
            const baseUrl = `${protocol}//${hostname}:${port}`;
            
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${id}`);
            if (!resp.ok) throw new Error("Err");
            
            const dataMap = await resp.json();
            const data = dataMap[id];
            
            if (data) {
                cacheManager.set(id, data);
                if (timeManager.getGlobalTimeLookup().length === 0 && data.hourly?.time) {
                     timeManager.setGlobalTimeLookup(data.hourly.time);
                     timeManager.initializeOrSync(new Date(data.hourly.time[0]));
                }
                this._fillSubRegionItem(element, data);
                element.dataset.loaded = "true";
            }
        } catch (e) {
            console.warn(`Lazy load failed for ${id}`, e);
            const descEl = element.querySelector('.sub-region-item-desc');
            if (descEl) {
                descEl.classList.remove('skeleton-loading');
                descEl.textContent = "Gagal";
                descEl.style.color = "red";
            }
        }
    },

    _fillSubRegionItem: function(element, data) {
        const timeIndex = timeManager.getSelectedTimeIndex();
        if (!data.hourly || timeIndex < 0) return;

        element.classList.remove('skeleton-mode');
        
        const dataPoint = {
            is_day: data.hourly.is_day?.[timeIndex],
            weather_code: data.hourly.weather_code?.[timeIndex],
            suhu: data.hourly.temperature_2m?.[timeIndex],
        };
        const { deskripsi, ikon } = utils.getWeatherInfo(dataPoint.weather_code, dataPoint.is_day);

        element.innerHTML = `
            <div class="sub-region-info-col">
                <span class="sub-region-item-name">${data.nama_simpel || 'N/A'}</span>
                <span class="sub-region-item-desc">${deskripsi}</span>
            </div>
            <i class="sub-region-item-icon ${ikon}"></i>
            <span class="sub-region-item-temp">${dataPoint.suhu?.toFixed(1) ?? '-'}°C</span>
        `;
    },

    _renderSubRegionList: function(timeIndex) {
        const { subRegionListEl } = this.elements;
        if (!subRegionListEl) return;

        const items = subRegionListEl.querySelectorAll('.sub-region-item');
        items.forEach(item => {
            if (item.dataset.loaded === "true") {
                const id = item.dataset.id;
                const data = cacheManager.get(id);
                if (data) {
                    this._fillSubRegionItem(item, data);
                }
            }
        });
    },

    renderSidebarContent: function() {
        const { sidebarContentEl, sidebarLocationNameEl, sidebarEl } = this.elements;
        
        if (!this._isSidebarOpen || !sidebarContentEl) { return; }
        
        this._hideAllSidebarSections(); 

        // [LOGIKA BARU] Branching berdasarkan Mode
        
        // MODE GEMPA
        if (this._activeContentMode === 'gempa') {
            this.elements.sidebarLocationNameEl.textContent = 'Info Gempa';
            const lblWeather = sidebarEl.querySelector('#sidebar-location-label-weather');
            if (lblWeather) lblWeather.textContent = '';

            if (this._lastGempaData) {
                // Render data gempa terakhir
                this.renderSidebarGempa(this._lastGempaData);
            } else {
                // Placeholder Gempa
                this._renderSidebarPlaceholderState("Mode Gempa Aktif. Pilih titik gempa di peta untuk detail.");
            }
            return;
        }

        // MODE CUACA (Default)
        if (sidebarLocationNameEl) sidebarLocationNameEl.textContent = 'Detail Lokasi'; 
        const lblWeather = sidebarEl.querySelector('#sidebar-location-label-weather');
        const lblProvince = sidebarEl.querySelector('#sidebar-location-label-province');
        if (lblWeather) lblWeather.textContent = '';
        if (lblProvince) lblProvince.textContent = '';
        
        if (mapManager.getIsClickLoading()) { 
            this._renderSidebarLoadingState();
        } else if (!mapManager.getActiveLocationId()) { 
            this._renderSidebarPlaceholderState();
        } else if (mapManager.getActiveLocationData()?.type === 'provinsi') { 
            this._renderSidebarProvinceState();
        } else if (mapManager.getActiveLocationData()?.hourly && timeManager.getGlobalTimeLookup().length > 0) { 
            this._renderSidebarWeatherState();
        } else if (mapManager.getActiveLocationId()) { 
            const msg = (timeManager.getGlobalTimeLookup().length > 0) 
                ? `Data cuaca untuk ${mapManager.getActiveLocationLabel()} tidak lengkap atau rusak.`
                : `Data cuaca untuk ${mapManager.getActiveLocationLabel()} belum dimuat.`; 
            this._renderSidebarErrorState(msg);
        } else { 
            this._renderSidebarErrorState('Terjadi kesalahan.');
        }
    },

    updateCurrentConditions: function(dataPoint, formattedTime, weatherInfo) {
        if (dataPoint && formattedTime && weatherInfo) {
            if (this._timeEl) this._timeEl.textContent = formattedTime;
            if (this._iconEl) this._iconEl.className = weatherInfo.ikon;
            if (this._tempEl) this._tempEl.textContent = `${dataPoint.suhu?.toFixed(1) ?? '-'}°C`;
            if (this._descEl) this._descEl.textContent = weatherInfo.deskripsi;
            if (this._feelsLikeEl) this._feelsLikeEl.textContent = `Terasa ${dataPoint.terasa?.toFixed(1) ?? '-'}°C`;
            if (this._humidityEl) this._humidityEl.textContent = `Kelembapan: ${dataPoint.kelembapan ?? '-'}%`;
            if (this._precipEl) this._precipEl.textContent = `Presipitasi: ${dataPoint.prob_presipitasi ?? '-'}%`;
            if (this._windEl) this._windEl.textContent = `Angin: ${dataPoint.kecepatan_angin_10m ?? '-'} m/s dari arah ${dataPoint.arah_angin_10m ?? '-'}°`;
        } else {
            if (this._timeEl) this._timeEl.textContent = '...';
            if (this._iconEl) this._iconEl.className = 'wi wi-na';
            if (this._tempEl) this._tempEl.textContent = '-°C';
            if (this._descEl) this._descEl.textContent = '...';
            if (this._feelsLikeEl) this._feelsLikeEl.textContent = 'Terasa ...°C';
            if (this._humidityEl) this._humidityEl.textContent = 'Kelembapan: ...%';
            if (this._precipEl) this._precipEl.textContent = 'Presipitasi: ...%';
            if (this._windEl) this._windEl.textContent = 'Angin: ... m/s';
        }
    },

    updateUIForTime: function(idxGlobal, localTimeString, activeData) {
        if (!this._isSidebarOpen) {
            return;
        }
        
        // Jangan update UI jika sedang di mode gempa
        if (this._activeContentMode === 'gempa') return;

        if (activeData && activeData.hourly?.time) {
            try {
                const hourly = activeData.hourly;
                if (idxGlobal >= hourly.time.length) {
                    this._renderSubRegionList(idxGlobal);
                    return;
                }
                const formattedTime = utils.formatLocalTimestampString(localTimeString); 
                const dataPoint = utils.extractHourlyDataPoint(hourly, idxGlobal);
                const { deskripsi, ikon } = utils.getWeatherInfo(dataPoint.weather_code, dataPoint.is_day); 
                this.updateCurrentConditions(dataPoint, formattedTime, { deskripsi, ikon });
            } catch (e) { 
                console.warn("Error updating sidebar DOM:", e); 
            }
        }

        this._renderSubRegionList(idxGlobal);
    },

    renderSidebarGempa: function(gempaData) {
        if (!this.elements.sidebarContentEl) return;
        
        // Update State Internal
        this._activeContentMode = 'gempa';
        this._lastGempaData = gempaData;

        this._hideAllSidebarSections();
        this.elements.sidebarLocationNameEl.textContent = 'Detail Gempa Bumi';
        this.elements.sidebarEl.querySelector('#sidebar-location-label-weather').textContent = '';
        
        let gempaContainer = document.getElementById('sidebar-gempa-container');
        if (!gempaContainer) {
            gempaContainer = document.createElement('div');
            gempaContainer.id = 'sidebar-gempa-container';
            this.elements.sidebarContentEl.appendChild(gempaContainer);
        }
        gempaContainer.style.display = 'block';
        
        const dateObj = new Date(gempaData.time);
        const formattedTime = dateObj.toLocaleDateString('id-ID', { 
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', 
            hour: '2-digit', minute: '2-digit' 
        }) + ' WIB';

        let themeClass = 'gempa-card-safe'; 
        const color = gempaData.status_color || '';
        
        if (color.toLowerCase().includes('d32f2f') || color.toLowerCase().includes('e53935') || gempaData.tsunami) {
            themeClass = 'gempa-card-danger'; 
        } else if (color.toLowerCase().includes('ffc107') || color.toLowerCase().includes('orange')) {
            themeClass = 'gempa-card-warning'; 
        }

        const isTsunami = gempaData.tsunami;
        const statusLabel = gempaData.status_label || (isTsunami ? "POTENSI TSUNAMI" : "INFO GEMPA");
        const sourceName = gempaData.source ? gempaData.source.toUpperCase() : 'BMKG';

        gempaContainer.innerHTML = `
            <!-- Kartu Informasi Gempa -->
            <div class="weather-card-main ${themeClass}" style="margin-bottom: 24px;">
                
                <div class="weather-header-time">${formattedTime}</div>
                
                <div style="font-size: 1.2rem; font-weight: 700; line-height: 1.3; margin-bottom: 15px; opacity: 0.95;">
                    ${gempaData.place}
                </div>

                ${isTsunami ? `
                <div style="background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.5); padding:8px; border-radius:8px; margin-bottom:15px; text-align:center; font-weight:800; color:#fff; display:flex; align-items:center; justify-content:center; gap:8px;">
                    <i class="wi wi-tsunami" style="font-size:1.4rem;"></i> BERPOTENSI TSUNAMI
                </div>` : ''}
                
                <div class="weather-main-row">
                    <div class="weather-temp-big">
                        ${gempaData.mag.toFixed(1)}<span style="font-size:0.5em; opacity:0.8; font-weight:600; margin-left:5px;">M</span>
                    </div>
                    <div class="weather-icon-container">
                        <i class="wi wi-earthquake weather-icon-big"></i>
                    </div>
                </div>
                
                <div class="weather-desc-main" style="margin-bottom:20px; font-size:1.2rem;">
                    ${statusLabel}
                </div>

                <div class="weather-details-grid">
                    <div class="detail-item">
                        <i class="wi wi-direction-down detail-icon"></i>
                        <span>${gempaData.depth}</span>
                    </div>
                    <div class="detail-item">
                        <i class="wi wi-alien detail-icon"></i> 
                        <span>MMI ${gempaData.mmi || '-'}</span>
                    </div>
                    <div class="detail-item" style="grid-column: span 2; display: flex; align-items: flex-start;">
                        <i class="wi wi-info detail-icon" style="margin-top:2px;"></i>
                        <span style="font-size:0.9rem; line-height:1.4;">${gempaData.status_desc || 'Tidak ada data dampak.'}</span>
                    </div>
                </div>

                <div style="margin-top: 20px; text-align: center; font-size: 0.8rem; opacity: 0.8; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2);">
                    Data bersumber dari <strong>${sourceName}</strong>.<br>
                    Selalu pantau informasi resmi dari otoritas setempat.
                </div>
            </div>
        `;
    }
};