import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { mapManager } from "./map_manager.js";

/** ➡️ SIDEBAR MANAGER: Mengelola logika buka/tutup dan render sidebar */
export const sidebarManager = { 
    _isSidebarOpen: false,
    _subRegionData: null, 

    elements: {},

    initDOM: function(domElements) {
        this.elements = domElements;
        console.log("Elemen DOM Sidebar telah di-set di sidebarManager.");
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
        
        mapManager.removeActiveMarkerHighlight(null, true); 
        sidebarEl.classList.add('sidebar-open');
        this._isSidebarOpen = true;
        toggleBtnEl.innerHTML = '&lt;';
        toggleBtnEl.setAttribute('aria-label', 'Tutup detail lokasi');
        this.renderSidebarContent(); 
        
        const activeId = mapManager.getActiveLocationId();
        if(activeId) mapManager.setActiveMarkerHighlight(activeId); 
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

    _hideAllSidebarSections: function() {
        const { sidebarPlaceholderEl, sidebarLoadingEl, sidebarWeatherDetailsEl, sidebarProvinceDetailsEl, subRegionContainerEl, subRegionListEl } = this.elements;
        if (sidebarPlaceholderEl) sidebarPlaceholderEl.style.display = 'none';
        if (sidebarLoadingEl) sidebarLoadingEl.style.display = 'none';
        if (sidebarWeatherDetailsEl) sidebarWeatherDetailsEl.style.display = 'none';
        if (sidebarProvinceDetailsEl) sidebarProvinceDetailsEl.style.display = 'none';
        if (subRegionContainerEl) subRegionContainerEl.style.display = 'none';
        if (subRegionListEl) subRegionListEl.innerHTML = '';
    },

    _renderSidebarLoadingState: function() {
        const { sidebarLoadingEl, sidebarLocationNameEl } = this.elements;
        if (sidebarLoadingEl) sidebarLoadingEl.style.display = 'block';
        if (sidebarLocationNameEl) sidebarLocationNameEl.textContent = `Memuat ${mapManager.getActiveLocationSimpleName() || 'lokasi'}...`;
    },

    _renderSidebarPlaceholderState: function() {
        const { sidebarPlaceholderEl, sidebarLocationNameEl } = this.elements;
        if (sidebarPlaceholderEl) {
            sidebarPlaceholderEl.textContent = 'Pilih satu wilayah di peta.';
            sidebarPlaceholderEl.style.display = 'block';
        }
        if (sidebarLocationNameEl) sidebarLocationNameEl.textContent = 'Detail Lokasi';
    },

    _renderSidebarErrorState: function(message) {
        const { sidebarPlaceholderEl, sidebarLocationNameEl } = this.elements;
        if (sidebarPlaceholderEl) {
            sidebarPlaceholderEl.textContent = message || `Data cuaca untuk ${mapManager.getActiveLocationLabel()} belum dimuat atau tidak lengkap.`;
            sidebarPlaceholderEl.style.display = 'block';
        }
        if (sidebarLocationNameEl) {
            sidebarLocationNameEl.textContent = mapManager.getActiveLocationSimpleName() || 'Detail Lokasi';
            if (!mapManager.getActiveLocationId()) {
                sidebarLocationNameEl.textContent = 'Detail Lokasi';
                if (sidebarPlaceholderEl) sidebarPlaceholderEl.textContent = 'Terjadi kesalahan.';
            }
        }
    },

    _renderSidebarProvinceState: function() {
        const { sidebarProvinceDetailsEl, sidebarLocationNameEl } = this.elements;
        if (!sidebarProvinceDetailsEl || !sidebarLocationNameEl) return;

        const container = sidebarProvinceDetailsEl;
        container.innerHTML = ''; 
        const labelEl = document.createElement('div');
        labelEl.className = 'location-label-subtitle'; 
        labelEl.id = 'sidebar-location-label-province'; 
        labelEl.textContent = mapManager.getActiveLocationLabel();
        container.appendChild(labelEl);
        // const infoEl = document.createElement('p');
        // infoEl.textContent = '(Menampilkan daftar wilayah administratif di bawah provinsi ini)';
        // infoEl.style.textAlign = 'center';
        // infoEl.style.marginTop = '10px';
        // infoEl.style.fontSize = '0.9rem';
        // infoEl.style.color = '#666';
        // container.appendChild(infoEl);
        container.style.display = 'block';
        sidebarLocationNameEl.textContent = mapManager.getActiveLocationSimpleName();

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

        // Pastikan tipadm number
        const tipadm = Number(activeData.tipadm);

        // TIPADM 4 (Desa) tidak punya sub-wilayah
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
            
            const url = `${baseUrl}/api/sub-wilayah-cuaca?id=${encodeURIComponent(activeData.id)}&tipadm=${tipadm}`;

            const resp = await fetch(url);
            
            if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
            
            const data = await resp.json();
            this._subRegionData = data; 

            if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'none';

            if (!data || data.length === 0) {
                if (subRegionTitleEl) subRegionTitleEl.textContent = `Tidak ada data ${titles[titleKey] || 'sub-wilayah'}`;
                if (subRegionListEl) subRegionListEl.innerHTML = '<div style="padding:10px; text-align:center; color:#777;">Data sub-wilayah tidak tersedia.</div>';
                return;
            }
            
            // [AUDIT FIX: Time Injection]
            // Cek jika Time Manager belum punya data global, gunakan data sub-wilayah pertama untuk inisialisasi
            const isTimeNotSynced = (timeManager.getGlobalTimeLookup().length === 0);
            if (isTimeNotSynced && data[0] && data[0].hourly?.time) {
                console.log("[Time Injection] Menginisialisasi waktu dari data sub-wilayah provinsi.");
                timeManager.setGlobalTimeLookup(data[0].hourly.time);
                const realStartDate = new Date(data[0].hourly.time[0]);
                timeManager.initializeOrSync(realStartDate);
            }

            const currentTimeIndex = timeManager.getSelectedTimeIndex();
            this._renderSubRegionList(currentTimeIndex);

        } catch (e) {
            console.error("Gagal fetch sub-wilayah:", e);
            if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'none';
            if (subRegionTitleEl) subRegionTitleEl.textContent = "Gagal memuat data";
            if (subRegionListEl) subRegionListEl.innerHTML = `<div style="padding:10px; text-align:center; color:red;">Error: ${e.message}</div>`;
        }
    },

    _renderSubRegionList: function(timeIndex) {
        const { subRegionListEl } = this.elements;
        
        if (!subRegionListEl) {
            return;
        }
        if (!this._subRegionData || this._subRegionData.length === 0) {
            return; 
        }

        if (timeIndex < 0) {
             subRegionListEl.innerHTML = '<div style="padding:10px; text-align:center;">Menunggu sinkronisasi waktu...</div>';
             return;
        }

        const fragment = document.createDocumentFragment();
        
        for (const subRegion of this._subRegionData) {
            const hourly = subRegion.hourly;
            if (!hourly || !hourly.time) {
                continue; 
            }
            if (timeIndex >= hourly.time.length) {
                continue;
            }

            const dataPoint = {
                is_day: hourly.is_day?.[timeIndex],
                weather_code: hourly.weather_code?.[timeIndex],
                suhu: hourly.temperature_2m?.[timeIndex],
            };
            const { deskripsi, ikon } = utils.getWeatherInfo(dataPoint.weather_code, dataPoint.is_day);

            const item = document.createElement('div');
            item.className = 'sub-region-item';
            
            const infoCol = document.createElement('div');
            infoCol.className = 'sub-region-info-col'; 

            const nameEl = document.createElement('span');
            nameEl.className = 'sub-region-item-name';
            nameEl.textContent = subRegion.nama_simpel || 'N/A';
            
            const descEl = document.createElement('span'); 
            descEl.className = 'sub-region-item-desc';
            descEl.textContent = deskripsi;

            infoCol.appendChild(nameEl);
            infoCol.appendChild(descEl);

            const iconEl = document.createElement('i');
            iconEl.className = `sub-region-item-icon ${ikon}`;
            
            const tempEl = document.createElement('span');
            tempEl.className = 'sub-region-item-temp';
            tempEl.textContent = `${dataPoint.suhu?.toFixed(1) ?? '-'}°C`;

            item.appendChild(infoCol);
            item.appendChild(iconEl);
            item.appendChild(tempEl);
            fragment.appendChild(item);
        }

        subRegionListEl.innerHTML = ''; 
        subRegionListEl.appendChild(fragment); 
    },

    renderSidebarContent: function() {
        const { sidebarContentEl, sidebarLocationNameEl, sidebarEl } = this.elements;
        
        if (!this._isSidebarOpen || !sidebarContentEl) { return; }
        
        this._hideAllSidebarSections(); 
        
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
        
        if (activeData && activeData.hourly?.time) {
            try {
                const hourly = activeData.hourly;
                if (idxGlobal >= hourly.time.length) {
                    // Jika index di luar batas data aktif, TETAP render sub-wilayah jika ada
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

        // PENTING: Render ulang daftar sub-wilayah saat waktu berubah
        this._renderSubRegionList(idxGlobal);
    }
};