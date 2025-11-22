import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { mapManager } from "./map_manager.js";
import { cacheManager } from "./cache_manager.js"; // [LAZY LOAD] Import cacheManager

/** ➡️ SIDEBAR MANAGER: Mengelola logika buka/tutup dan render sidebar */
export const sidebarManager = { 
    _isSidebarOpen: false,
    _subRegionData: null, 
    _observer: null, // [LAZY LOAD] Menyimpan instance IntersectionObserver

    elements: {},

    initDOM: function(domElements) {
        this.elements = domElements;
        console.log("Elemen DOM Sidebar telah di-set di sidebarManager.");
        
        // [LAZY LOAD] Inisialisasi Observer
        this._initIntersectionObserver();
    },

    // [LAZY LOAD] Setup Observer untuk mendeteksi scroll
    _initIntersectionObserver: function() {
        const options = {
            root: this.elements.sidebarContentEl, // Mengamati viewport konten sidebar
            rootMargin: '50px', // Pre-fetch sedikit sebelum item masuk layar
            threshold: 0.1
        };

        this._observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const target = entry.target;
                    const id = target.dataset.id;
                    if (id && !target.dataset.loaded) {
                        this._fetchSingleSubRegionWeather(id, target);
                        // Stop mengamati setelah fetch dipicu
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
            
            // [LAZY LOAD] Tambahkan parameter view=simple
            const url = `${baseUrl}/api/sub-wilayah-cuaca?id=${encodeURIComponent(activeData.id)}&tipadm=${tipadm}&view=simple`;

            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
            
            const simpleData = await resp.json();
            this._subRegionData = simpleData; // Simpan list basic

            if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'none';

            if (!simpleData || simpleData.length === 0) {
                if (subRegionTitleEl) subRegionTitleEl.textContent = `Tidak ada data ${titles[titleKey] || 'sub-wilayah'}`;
                if (subRegionListEl) subRegionListEl.innerHTML = '<div style="padding:10px; text-align:center; color:#777;">Data sub-wilayah tidak tersedia.</div>';
                return;
            }
            
            // [LAZY LOAD] Render Skeleton List, bukan data lengkap
            this._renderSubRegionListSkeleton(simpleData);

            // [SAFEGUARD TIME SYNC] Jika waktu belum sync (misal klik provinsi duluan),
            // fetch item pertama secara penuh untuk inisialisasi waktu.
            if (timeManager.getGlobalTimeLookup().length === 0 && simpleData.length > 0) {
                const firstId = simpleData[0].id;
                const firstEl = document.getElementById(`sub-region-${firstId}`);
                if (firstEl) {
                    // Trigger fetch langsung untuk item pertama
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

    // [LAZY LOAD] Render awal berupa Skeleton
    _renderSubRegionListSkeleton: function(simpleData) {
        const { subRegionListEl } = this.elements;
        if (!subRegionListEl) return;
        
        subRegionListEl.innerHTML = ''; 
        const fragment = document.createDocumentFragment();
        
        simpleData.forEach(item => {
            const div = document.createElement('div');
            div.className = 'sub-region-item skeleton-mode'; // Tambah class khusus
            div.id = `sub-region-${item.id}`;
            div.dataset.id = item.id; // ID untuk observer
            
            // Cek Cache: Jika sudah ada di cache, render langsung (skip skeleton)
            const cached = cacheManager.get(item.id);
            if (cached) {
                this._fillSubRegionItem(div, cached);
                div.dataset.loaded = "true";
            } else {
                // Render Skeleton UI
                div.innerHTML = `
                    <div class="sub-region-info-col">
                        <span class="sub-region-item-name">${item.nama_simpel}</span>
                        <span class="sub-region-item-desc skeleton-loading"></span>
                    </div>
                    <i class="sub-region-item-icon skeleton-loading"></i>
                    <span class="sub-region-item-temp skeleton-loading"></span>
                `;
                // Daftarkan ke observer
                if (this._observer) {
                    this._observer.observe(div);
                }
            }
            
            fragment.appendChild(div);
        });
        
        subRegionListEl.appendChild(fragment);
    },

    // [LAZY LOAD] Fetch data per item saat scroll
    _fetchSingleSubRegionWeather: async function(id, element) {
        // Double check cache sebelum fetch network
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
            
            // Gunakan endpoint data-by-ids yang sudah ada (mengembalikan data lengkap + cache headers)
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${id}`);
            if (!resp.ok) throw new Error("Err");
            
            const dataMap = await resp.json();
            const data = dataMap[id];
            
            if (data) {
                // Simpan ke cache lewat mapManager (karena mapManager handle logic time sync juga)
                // Tapi karena kita di sidebar, kita bisa panggil _processIncomingData mapManager jika mau konsisten,
                // atau manual set cache. Agar aman waktu sync, kita manfaatkan cacheManager saja, 
                // tapi untuk Time Sync pertama kali kita perlu bantuan mapManager/TimeManager.
                
                // Manual set cache
                cacheManager.set(id, data);
                
                // Cek Time Sync
                if (timeManager.getGlobalTimeLookup().length === 0 && data.hourly?.time) {
                     timeManager.setGlobalTimeLookup(data.hourly.time);
                     timeManager.initializeOrSync(new Date(data.hourly.time[0]));
                }
                
                // Update UI
                this._fillSubRegionItem(element, data);
                element.dataset.loaded = "true";
            }
        } catch (e) {
            console.warn(`Lazy load failed for ${id}`, e);
            // Visual Error State kecil
            const descEl = element.querySelector('.sub-region-item-desc');
            if (descEl) {
                descEl.classList.remove('skeleton-loading');
                descEl.textContent = "Gagal";
                descEl.style.color = "red";
            }
        }
    },

    // [LAZY LOAD] Helper untuk mengisi data real ke elemen skeleton
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

        // Re-construct isi elemen agar rapi
        element.innerHTML = `
            <div class="sub-region-info-col">
                <span class="sub-region-item-name">${data.nama_simpel || 'N/A'}</span>
                <span class="sub-region-item-desc">${deskripsi}</span>
            </div>
            <i class="sub-region-item-icon ${ikon}"></i>
            <span class="sub-region-item-temp">${dataPoint.suhu?.toFixed(1) ?? '-'}°C</span>
        `;
    },

    // [LAZY LOAD] Dipanggil ulang saat slider waktu digeser
    _renderSubRegionList: function(timeIndex) {
        // Fungsi ini sekarang hanya mengupdate item yang SUDAH TERLOAD (bukan skeleton)
        // Skeleton biarkan tetap skeleton.
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
                // [MODIFIKASI] Tidak perlu render ulang list sub-wilayah di sini jika index di luar batas,
                // karena sub-wilayah punya logic update sendiri via _renderSubRegionList
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

        // PENTING: Render ulang daftar sub-wilayah saat waktu berubah
        this._renderSubRegionList(idxGlobal);
    },

    // [BARU] Render Sidebar Khusus Gempa
    renderSidebarGempa: function(gempaData) {
        if (!this.elements.sidebarContentEl) return;
        
        // Sembunyikan elemen cuaca
        this._hideAllSidebarSections();
        this.elements.sidebarLocationNameEl.textContent = 'Detail Gempa Bumi';
        this.elements.sidebarEl.querySelector('#sidebar-location-label-weather').textContent = '';
        
        // Buat/Tampilkan Container Gempa
        let gempaContainer = document.getElementById('sidebar-gempa-container');
        if (!gempaContainer) {
            gempaContainer = document.createElement('div');
            gempaContainer.id = 'sidebar-gempa-container';
            this.elements.sidebarContentEl.appendChild(gempaContainer);
        }
        gempaContainer.style.display = 'block';
        
        const isTsunami = gempaData.tsunami;
        const dateObj = new Date(gempaData.time);
        
        gempaContainer.innerHTML = `
            <div class="gempa-detail-card" style="border-left: 6px solid ${isTsunami ? '#d32f2f' : '#455A64'}; background:#fff; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.1); padding:20px; margin-bottom:20px;">
                
                ${isTsunami ? `
                <div style="background:#ffebee; color:#c62828; padding:10px; border-radius:6px; font-weight:bold; text-align:center; margin-bottom:15px; border:1px solid #ffcdd2; display:flex; align-items:center; justify-content:center; gap:8px;">
                    <i class="wi wi-tsunami" style="font-size:1.5rem;"></i> BERPOTENSI TSUNAMI
                </div>` : ''}

                <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:10px;">
                    <div>
                        <div style="font-size:0.9rem; color:#666; text-transform:uppercase; letter-spacing:1px;">Magnitudo</div>
                        <div style="font-size:3.5rem; font-weight:800; line-height:1; color:#333;">${gempaData.mag.toFixed(1)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:0.9rem; color:#666; text-transform:uppercase; letter-spacing:1px;">Kedalaman</div>
                        <div style="font-size:2rem; font-weight:700; color:#455A64;">${gempaData.depth}</div>
                    </div>
                </div>
                
                <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
                
                <div style="margin-bottom:15px;">
                    <div style="display:flex; gap:10px; margin-bottom:8px;">
                        <i class="wi wi-time-3" style="font-size:1.2rem; color:#555; width:20px; text-align:center;"></i>
                        <div>
                            <div style="font-weight:600; color:#333;">${dateObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
                            <div style="color:#666;">Pukul ${dateObj.toLocaleTimeString('id-ID')}</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <i class="wi wi-direction-up" style="font-size:1.2rem; color:#555; width:20px; text-align:center;"></i>
                        <div>
                            <div style="font-weight:600; color:#333;">Lokasi</div>
                            <div style="color:#666; line-height:1.4;">${gempaData.place}</div>
                        </div>
                    </div>
                </div>

                <div style="background:#f5f7fa; padding:12px; border-radius:6px; font-size:0.85rem; color:#555;">
                    Data bersumber dari <strong>${gempaData.source ? gempaData.source.toUpperCase() : 'BMKG'}</strong>. 
                    Selalu pantau informasi resmi dari otoritas setempat.
                </div>
            </div>
        `;
    }
};