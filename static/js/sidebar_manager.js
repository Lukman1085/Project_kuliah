import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { mapManager } from "./map_manager.js";

/** ➡️ SIDEBAR MANAGER: Mengelola logika buka/tutup dan render sidebar */
export const sidebarManager = { 
    _isSidebarOpen: false,

    // FUNGSI BARU: Tempat menyimpan referensi elemen DOM
    elements: {},

    // FUNGSI BARU: Dipanggil oleh main.js untuk 'menyuntikkan' elemen DOM
    initDOM: function(domElements) {
        this.elements = domElements;
        // domElements akan berisi: 
        // { sidebarEl, toggleBtnEl, closeBtnEl, sidebarContentEl, sidebarLocationNameEl, 
        //   sidebarPlaceholderEl, sidebarLoadingEl, sidebarWeatherDetailsEl, sidebarProvinceDetailsEl }
        console.log("Elemen DOM Sidebar telah di-set di sidebarManager.");
    },

    // Properti untuk elemen detail cuaca
    _timeEl: null, _iconEl: null, _tempEl: null, _descEl: null,
    _feelsLikeEl: null, _humidityEl: null, _precipEl: null, _windEl: null,
    _dailyListEl: null,

    // FUNGSI BARU: Dipanggil oleh main.js untuk 'menyuntikkan' elemen detail cuaca
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
        // Ganti referensi global ke referensi internal 'this.elements'
        const { sidebarEl, toggleBtnEl } = this.elements;
        if (!sidebarEl || !toggleBtnEl || this._isSidebarOpen) return;
        
        mapManager.removeActiveMarkerHighlight(); 
        sidebarEl.classList.add('sidebar-open');
        this._isSidebarOpen = true;
        toggleBtnEl.innerHTML = '&lt;';
        toggleBtnEl.setAttribute('aria-label', 'Tutup detail lokasi');
        this.renderSidebarContent(); 
        mapManager.setActiveMarkerHighlight(mapManager.getActiveLocationId()); 
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
        mapManager.removeActiveMarkerHighlight(activeId); 
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
        const { sidebarPlaceholderEl, sidebarLoadingEl, sidebarWeatherDetailsEl, sidebarProvinceDetailsEl } = this.elements;
        if (sidebarPlaceholderEl) sidebarPlaceholderEl.style.display = 'none';
        if (sidebarLoadingEl) sidebarLoadingEl.style.display = 'none';
        if (sidebarWeatherDetailsEl) sidebarWeatherDetailsEl.style.display = 'none';
        if (sidebarProvinceDetailsEl) sidebarProvinceDetailsEl.style.display = 'none';
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
        const infoEl = document.createElement('p');
        infoEl.textContent = '(Detail informasi provinsi akan ditampilkan di sini.)';
        infoEl.style.textAlign = 'center';
        infoEl.style.marginTop = '20px';
        container.appendChild(infoEl);
        container.style.display = 'block';
        sidebarLocationNameEl.textContent = mapManager.getActiveLocationSimpleName();
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

        sidebarWeatherDetailsEl.style.display = 'block';
        sidebarLocationNameEl.textContent = mapManager.getActiveLocationSimpleName();
        const labelEl = sidebarEl.querySelector('#sidebar-location-label-weather');
        if (labelEl) {
            labelEl.textContent = mapManager.getActiveLocationLabel();
        }
        const activeData = mapManager.getActiveLocationData();
        if (!activeData) {
            this._renderSidebarErrorState("Data lokasi aktif tidak ditemukan.");
            return;
        }
        const daily = activeData.daily;
        const timeZone = activeData.timezone;
        const listContainer = this._dailyListEl; // Ini sudah properti internal
        if (!listContainer) return;

        listContainer.innerHTML = ''; 
        if (daily?.time) {
            const getLocalDateString = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const todayStr = getLocalDateString(new Date());
            const todayIndex = daily.time.indexOf(todayStr);
            const startIndex = (todayIndex !== -1) ? todayIndex : 0;
            const endIndex = Math.min(startIndex + 7, daily.time.length);
            const fragment = document.createDocumentFragment();
            for (let i = startIndex; i < endIndex; i++) {
                const date = daily.time[i], code = daily.weather_code?.[i], maxT = daily.temperature_2m_max?.[i], minT = daily.temperature_2m_min?.[i];
                if (date === undefined || code === undefined || maxT === undefined || minT === undefined) continue;
                const itemEl = this._createDailyForecastItem(date, code, maxT, minT, timeZone);
                fragment.appendChild(itemEl);
            }
            listContainer.appendChild(fragment); 
        } else { 
            const p = document.createElement('p');
            const i = document.createElement('i');
            i.textContent = 'Data harian tidak tersedia.';
            p.appendChild(i);
            listContainer.appendChild(p);
        }
        const idx = timeManager.getSelectedTimeIndex();
        const lookup = timeManager.getGlobalTimeLookup();
            if (idx >= 0 && idx < lookup.length) {
                const timeStr = lookup[idx];
                this.updateUIForTime(idx, timeStr, activeData);
            } else {
                this.updateCurrentConditions(null, null, null);
            }
    },

    renderSidebarContent: function() {
        const { sidebarContentEl, sidebarLocationNameEl, sidebarEl } = this.elements;
        
        if (!this._isSidebarOpen || !sidebarContentEl) { return; }
        
        this._hideAllSidebarSections(); // Ini sudah menggunakan this.elements
        
        if (sidebarLocationNameEl) sidebarLocationNameEl.textContent = 'Detail Lokasi'; // Default
        
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
        // Fungsi ini sudah menggunakan properti internal (this._timeEl, dll.),
        // jadi tidak perlu diubah, HANYA perlu ditambahkan null safety check.
        
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
        if (!this._isSidebarOpen || !activeData || !activeData.hourly?.time) {
            return;
        }
        try {
            const hourly = activeData.hourly;
            if (idxGlobal >= hourly.time.length) return; 
            const formattedTime = utils.formatLocalTimestampString(localTimeString); 
            const dataPoint = utils.extractHourlyDataPoint(hourly, idxGlobal);
            const { deskripsi, ikon } = utils.getWeatherInfo(dataPoint.weather_code, dataPoint.is_day); 
            this.updateCurrentConditions(dataPoint, formattedTime, { deskripsi, ikon });
        } catch (e) { console.warn("Error updating sidebar DOM:", e); }
    }
};