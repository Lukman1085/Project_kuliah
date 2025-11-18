import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { mapManager } from "./map_manager.js";

/** ➡️ SIDEBAR MANAGER: Mengelola logika buka/tutup dan render sidebar */
export const sidebarManager = { 
    _isSidebarOpen: false,
    _subRegionData: null, // <-- MODIFIKASI: State untuk data sub-wilayah

    // FUNGSI BARU: Tempat menyimpan referensi elemen DOM
    elements: {},

    // FUNGSI BARU: Dipanggil oleh main.js untuk 'menyuntikkan' elemen DOM
    initDOM: function(domElements) {
        this.elements = domElements;
        // domElements akan berisi: 
        // { sidebarEl, toggleBtnEl, closeBtnEl, sidebarContentEl, sidebarLocationNameEl, 
        //   sidebarPlaceholderEl, sidebarLoadingEl, sidebarWeatherDetailsEl, sidebarProvinceDetailsEl,
        //   subRegionContainerEl, subRegionTitleEl, subRegionLoadingEl, subRegionListEl }
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

    // Modifikasi: closeSidebar tidak lagi memaksa hapus highlight
    closeSidebar: function() {
        const { sidebarEl, toggleBtnEl } = this.elements;
        if (!sidebarEl || !toggleBtnEl || !this._isSidebarOpen) return;
        
        sidebarEl.classList.remove('sidebar-open');
        this._isSidebarOpen = false;
        toggleBtnEl.innerHTML = '&gt;';
        toggleBtnEl.setAttribute('aria-label', 'Buka detail lokasi');
        
        const activeId = mapManager.getActiveLocationId();
        if (!activeId) { return } 
        
        // Panggil fungsi ini, mapManager akan memutuskan apakah highlight perlu dihapus
        // berdasarkan apakah popup masih terbuka atau tidak
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
        // Modifikasi: Tambahkan elemen-elemen sub-wilayah
        const { sidebarPlaceholderEl, sidebarLoadingEl, sidebarWeatherDetailsEl, sidebarProvinceDetailsEl, subRegionContainerEl, subRegionListEl } = this.elements;
        if (sidebarPlaceholderEl) sidebarPlaceholderEl.style.display = 'none';
        if (sidebarLoadingEl) sidebarLoadingEl.style.display = 'none';
        if (sidebarWeatherDetailsEl) sidebarWeatherDetailsEl.style.display = 'none';
        if (sidebarProvinceDetailsEl) sidebarProvinceDetailsEl.style.display = 'none';

        // MODIFIKASI: Sembunyikan dan bersihkan kontainer sub-wilayah
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
        
        // MODIFIKASI: Panggil fetcher sub-wilayah
        this._subRegionData = null; // Reset data sebelumnya
        this._fetchAndRenderSubRegions(activeData); // Panggil fetcher baru
    },

    // ===== FUNGSI BARU (1/3): Fetch Sub-Wilayah =====
    _fetchAndRenderSubRegions: async function(activeData) {
        const { subRegionContainerEl, subRegionLoadingEl, subRegionListEl, subRegionTitleEl } = this.elements;
        
        // 1. Validasi
        if (!activeData || !activeData.id || activeData.tipadm === undefined) {
            console.log("Data aktif tidak memiliki ID atau TIPADM, skip sub-wilayah.");
            return; 
        }

        // 2. Jangan tampilkan jika kita ada di level terendah
        if (activeData.tipadm >= 4) {
            console.log(`Level terendah (TIPADM ${activeData.tipadm}), tidak ada sub-wilayah.`);
            return; 
        }

        // 3. Tampilkan UI Loading
        if (subRegionContainerEl) subRegionContainerEl.style.display = 'block';
        if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'block';
        if (subRegionListEl) subRegionListEl.innerHTML = '';

        // 4. Sesuaikan Judul
        const titles = { 1: "Kab/Kota", 2: "Kecamatan", 3: "Kel/Desa" };
        const titleKey = activeData.tipadm; // 1, 2, atau 3
        if (subRegionTitleEl) subRegionTitleEl.textContent = `Prakiraan per ${titles[titleKey] || 'Wilayah Bawahan'}`;

        // 5. Fetch Data
        try {
            const protocol = window.location.protocol;
            const hostname = window.location.hostname;
            const port = '5000';
            const baseUrl = `${protocol}//${hostname}:${port}`;
            
            const resp = await fetch(`${baseUrl}/api/sub-wilayah-cuaca?id=${activeData.id}&tipadm=${activeData.tipadm}`);
            
            if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
            
            const data = await resp.json();
            this._subRegionData = data; // Simpan data di state manajer

            if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'none';

            if (data.length === 0) {
                if (subRegionTitleEl) subRegionTitleEl.textContent = `Tidak ada data ${titles[titleKey] || 'sub-wilayah'}`;
                return;
            }

            // 6. Render list untuk pertama kali
            const currentTimeIndex = timeManager.getSelectedTimeIndex();
            this._renderSubRegionList(currentTimeIndex);

        } catch (e) {
            console.error("Gagal fetch sub-wilayah:", e);
            if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'none';
            if (subRegionTitleEl) subRegionTitleEl.textContent = "Gagal memuat data sub-wilayah";
        }
    },

    // ===== FUNGSI BARU (2/3): Render Sub-Wilayah =====
    // Modifikasi: Menambahkan deskripsi cuaca ke item list
    _renderSubRegionList: function(timeIndex) {
        const { subRegionListEl } = this.elements;
        if (!subRegionListEl || !this._subRegionData || this._subRegionData.length === 0) {
            return; 
        }

        if (timeIndex < 0) {
             console.warn("Indeks waktu tidak valid untuk render sub-list.");
             return;
        }

        const fragment = document.createDocumentFragment();

        for (const subRegion of this._subRegionData) {
            const hourly = subRegion.hourly;
            if (!hourly || !hourly.time || timeIndex >= hourly.time.length) {
                continue; 
            }

            const dataPoint = {
                is_day: hourly.is_day?.[timeIndex],
                weather_code: hourly.weather_code?.[timeIndex],
                suhu: hourly.temperature_2m?.[timeIndex],
            };
            const { deskripsi, ikon } = utils.getWeatherInfo(dataPoint.weather_code, dataPoint.is_day);

            // Buat Container Item
            const item = document.createElement('div');
            item.className = 'sub-region-item';
            
            // Kolom 1: Info Teks (Nama + Deskripsi)
            const infoCol = document.createElement('div');
            infoCol.className = 'sub-region-info-col'; // Class baru untuk styling fleksibel

            const nameEl = document.createElement('span');
            nameEl.className = 'sub-region-item-name';
            nameEl.textContent = subRegion.nama_simpel || 'N/A';
            
            const descEl = document.createElement('span'); // Elemen deskripsi baru
            descEl.className = 'sub-region-item-desc';
            descEl.textContent = deskripsi;

            infoCol.appendChild(nameEl);
            infoCol.appendChild(descEl);

            // Kolom 2: Ikon
            const iconEl = document.createElement('i');
            iconEl.className = `sub-region-item-icon ${ikon}`;
            
            // Kolom 3: Suhu
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

    // ===== FUNGSI BARU (3/3): Modifikasi updateUIForTime =====
    updateUIForTime: function(idxGlobal, localTimeString, activeData) {
        if (!this._isSidebarOpen) {
            return;
        }
        
        // Update kondisi saat ini (kode yang sudah ada)
        if (activeData && activeData.hourly?.time) {
            try {
                const hourly = activeData.hourly;
                if (idxGlobal >= hourly.time.length) {
                     // Jika indeks tidak valid, setidaknya coba update sub-list
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

        // MODIFIKASI:
        // Render ulang daftar sub-wilayah dengan data indeks waktu yang baru
        // Ini dipanggil bahkan jika activeData null (untuk menyembunyikan/membersihkan)
        // atau jika data cuaca activeData tidak ada (jika sub-wilayah masih ada)
        this._renderSubRegionList(idxGlobal);
    }
};