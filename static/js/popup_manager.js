import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { mapManager } from "./map_manager.js";
import { timeManager } from "./time_manager.js"; 

/** 🏙️ PENGELOLA POPUP TERPUSAT */
export const popupManager = { 
    _currentInstance: null,
    _internalCloseFlag: false,

    // State untuk Lazy Loading Popup Klaster
    _activePopupType: null, 
    _activeClusterItemsGenerator: null, 
    _clusterFetchCallback: null, 
    _clusterObserver: null,      

    // Setter untuk Fetcher Callback
    setFetchCallback: function(fn) {
        this._clusterFetchCallback = fn;
    },

    /** * GENERATOR 1: POPUP LENGKAP (Mini Sidebar) untuk Non-Provinsi */
    generatePopupContent: function(nama, data, deskripsi, ikon, formattedTime) {
        const container = document.createElement('div');
        container.className = 'weather-popup-card';

        const header = document.createElement('div');
        header.className = 'popup-header';
        header.innerHTML = `
            <div class="popup-title">${nama}</div>
            <div class="popup-time">${formattedTime}</div>
        `;
        container.appendChild(header);

        const mainRow = document.createElement('div');
        mainRow.className = 'popup-main-row';
        mainRow.innerHTML = `
            <div class="popup-icon-container"><i class="${ikon}"></i></div>
            <div class="popup-temp-container">
                <div class="popup-temp">${data.suhu?.toFixed(1) ?? '-'}°</div>
                <div class="popup-desc">${deskripsi}</div>
            </div>
        `;
        container.appendChild(mainRow);

        const detailsGrid = document.createElement('div');
        detailsGrid.className = 'popup-details-grid';
        
        const createDetailItem = (iconClass, text) => `
            <div class="popup-detail-item">
                <i class="wi ${iconClass}"></i> <span>${text}</span>
            </div>
        `;

        detailsGrid.innerHTML = `
            ${createDetailItem('wi-thermometer', `Terasa: ${data.terasa?.toFixed(1) ?? '-'}°`)}
            ${createDetailItem('wi-humidity', `${data.kelembapan ?? '-'}%`)}
            ${createDetailItem('wi-raindrop', `${data.prob_presipitasi ?? '-'}%`)}
            ${createDetailItem('wi-strong-wind', `${data.kecepatan_angin_10m ?? '-'} m/s`)}
        `;
        container.appendChild(detailsGrid);

        const footer = document.createElement('div');
        footer.className = 'popup-footer';
        const button = document.createElement('button');
        button.className = 'popup-btn-detail';
        button.textContent = 'Lihat Detail Lengkap';
        button.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('requestSidebarDetail'));
        });
        footer.appendChild(button);
        container.appendChild(footer);

        return container;
    },

    /** * GENERATOR 2: POPUP PROVINSI (Minimalis) */
    generateProvincePopupContent: function(namaSimpel, namaLabel) {
        const container = document.createElement('div');
        container.className = 'weather-popup-card province-mode';

        const header = document.createElement('div');
        header.className = 'popup-header';
        header.innerHTML = `
            <div class="popup-subtitle">PROVINSI</div>
            <div class="popup-title large">${namaSimpel}</div>
        `;
        container.appendChild(header);

        const body = document.createElement('div');
        body.className = 'popup-body-text';
        body.textContent = "Lihat prakiraan cuaca untuk kabupaten/kota di wilayah ini.";
        container.appendChild(body);

        const footer = document.createElement('div');
        footer.className = 'popup-footer';
        const button = document.createElement('button');
        button.className = 'popup-btn-detail';
        button.textContent = 'Lihat Sub-Wilayah';
        button.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('requestSidebarDetail'));
        });
        footer.appendChild(button);
        container.appendChild(footer);

        return container;
    },

    /** * [BARU] GENERATOR 2.5: POPUP NEGARA (Eksklusif) */
    generateCountryPopupContent: function(namaSimpel) {
        const container = document.createElement('div');
        container.className = 'weather-popup-card province-mode'; // Re-use style provinsi

        const header = document.createElement('div');
        header.className = 'popup-header';
        // Warna header khusus negara (Merah Tua)
        header.style.background = '#b71c1c';
        header.style.color = '#fff';
        header.innerHTML = `
            <div class="popup-subtitle" style="color:#ffcdd2;">NEGARA KESATUAN</div>
            <div class="popup-title large" style="color:#fff;">${namaSimpel.toUpperCase()}</div>
        `;
        container.appendChild(header);

        const body = document.createElement('div');
        body.className = 'popup-body-text';
        body.innerHTML = `
            <div style="display:flex; justify-content:center; margin-bottom:10px;">
                <!-- Ikon Garuda / Peta Indonesia SVG -->
                <svg viewBox="0 0 24 24" width="48" height="48" fill="#b71c1c" style="opacity:0.8;">
                     <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
            </div>
            Lihat daftar Provinsi di seluruh Indonesia.
        `;
        container.appendChild(body);

        const footer = document.createElement('div');
        footer.className = 'popup-footer';
        const button = document.createElement('button');
        button.className = 'popup-btn-detail';
        button.textContent = 'Buka Direktori Provinsi';
        button.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('requestSidebarDetail'));
        });
        footer.appendChild(button);
        container.appendChild(footer);

        return container;
    },

    /** * GENERATOR 3: POPUP LOADING (Konsisten) */
    generateLoadingPopupContent: function(nama) {
        const container = document.createElement('div');
        container.className = 'weather-popup-card';
        
        const header = document.createElement('div');
        header.className = 'popup-header';
        header.innerHTML = `<div class="popup-title">${nama}</div>`;
        container.appendChild(header);

        const body = document.createElement('div');
        body.style.padding = '30px 20px';
        body.style.textAlign = 'center';
        body.innerHTML = `
            <i class="wi wi-day-sunny" style="font-size: 2rem; color: #0056b3; animation: spin-slow 2s linear infinite;"></i>
            <div style="margin-top: 10px; color: #666; font-size: 0.9rem;">Memuat data...</div>
            <style>@keyframes spin-slow { 100% { transform: rotate(360deg); } }</style>
        `;
        container.appendChild(body);

        return container;
    },

    /** * GENERATOR: POPUP ERROR (Styled) */
    generateErrorPopupContent: function(title, message) {
        const container = document.createElement('div');
        container.className = 'weather-popup-card'; 

        const header = document.createElement('div');
        header.className = 'popup-header';
        // Warna header merah muda untuk error
        header.style.backgroundColor = '#fff5f5';
        header.style.borderBottom = '1px solid #feb2b2';
        header.innerHTML = `<div class="popup-title" style="color: #c53030;">${title}</div>`;
        container.appendChild(header);

        const body = document.createElement('div');
        body.style.padding = '25px 20px';
        body.style.textAlign = 'center';
        body.innerHTML = `
            <i class="wi wi-cloud-refresh" style="font-size: 2.5rem; color: #fc8181; margin-bottom: 10px; display:block;"></i>
            <div style="color: #c53030; font-weight:500; font-size:0.9rem;">${message}</div>
        `;
        container.appendChild(body);

        return container;
    },

    /** * GENERATOR 4: POPUP CLUSTER LIST (LAZY LOADING SUPPORTED) */
    generateClusterPopupContent: function(titleText, items) {
        const container = document.createElement('div');
        container.className = 'weather-popup-card'; 
        container.style.width = '300px'; 

        const header = document.createElement('div');
        header.className = 'popup-header';
        header.innerHTML = `<div class="popup-title" style="font-size: 0.95rem;">${titleText}</div>`;
        container.appendChild(header);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'cluster-popup-content'; 
        contentDiv.style.maxHeight = '220px'; 
        contentDiv.style.overflowY = 'auto';
        contentDiv.style.backgroundColor = '#fff';
        contentDiv.id = 'cluster-popup-list'; 

        items.forEach(itemData => {
            const itemEl = document.createElement('div');
            itemEl.className = 'cluster-item'; 
            
            // [LAZY LOAD] Tambahkan data-id untuk observer
            if (itemData.id) itemEl.dataset.id = itemData.id;
            
            itemEl.style.padding = '8px 12px';
            itemEl.style.borderBottom = '1px solid #f0f0f0';
            itemEl.style.display = 'flex';
            itemEl.style.justifyContent = 'space-between';
            itemEl.style.alignItems = 'center';
            
            // [LAZY LOAD] Render Skeleton jika data belum ada
            if (itemData.isLoading) {
                itemEl.classList.add('skeleton-mode');
                itemEl.innerHTML = `
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="cluster-item-loading-block skeleton-icon"></div>
                        <span style="font-weight: 500; font-size: 0.85rem; color: #333;">${itemData.nama}</span>
                    </div>
                    <div style="text-align: right;">
                        <div class="cluster-item-loading-block skeleton-text-short"></div>
                        <div class="cluster-item-loading-block skeleton-text-long"></div>
                    </div>
                `;
            } else {
                // Render Normal
                itemEl.dataset.loaded = "true";
                itemEl.innerHTML = `
                    <div style="display:flex; align-items:center; gap:10px;">
                        <i class="${itemData.icon || 'wi wi-na'}" style="font-size:1.4rem; color:#555; width:24px; text-align:center;"></i>
                        <span style="font-weight: 500; font-size: 0.85rem; color: #333;">${itemData.nama}</span>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-weight: 700; color: #0056b3; font-size: 0.9rem;">${itemData.suhu}</span>
                        <br>
                        <span style="font-size: 0.7rem; color: #888;">${itemData.desc}</span>
                    </div>
                `;
            }
            
            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if(itemData.onClick) itemData.onClick();
            });

            contentDiv.appendChild(itemEl);
        });
        container.appendChild(contentDiv);

        return container;
    },

    /** * GENERATOR 5: POPUP GEMPA REDESIGN */
    generateGempaPopupContent: function(props) {
        const container = document.createElement('div');
        container.className = 'gempa-popup-card'; 

        // 1. Tentukan Tema Warna
        const color = props.status_color || '#2196F3';
        let themeClass = 'gempa-theme-blue'; 
        if (color.toLowerCase().includes('d32f2f') || color.toLowerCase().includes('e53935')) {
            themeClass = 'gempa-theme-red';
        } else if (color.toLowerCase().includes('ffc107') || color.toLowerCase().includes('orange')) {
            themeClass = 'gempa-theme-yellow';
        }
        container.classList.add(themeClass);

        // 2. Format Waktu
        let formattedTime = "Waktu tidak tersedia";
        try {
            const dateObj = new Date(props.time);
            if (!isNaN(dateObj.getTime())) {
                formattedTime = new Intl.DateTimeFormat('id-ID', { 
                    weekday: 'short', day: 'numeric', month: 'short',
                    hour: '2-digit', minute: '2-digit', hour12: false
                }).format(dateObj).replace('.', ':');
            }
        } catch(e) {}
        
        const statusLabel = props.status_label || (props.tsunami ? "BERPOTENSI TSUNAMI" : "INFO GEMPA");
        const sourceName = props.source ? props.source.toUpperCase() : 'BMKG';

        // === STRUKTUR HTML BARU ===
        container.innerHTML = `
            <!-- 1. Header Bar Solid -->
            <div class="gempa-header-bar">
                <i class="wi wi-earthquake"></i> ${statusLabel}
            </div>

            <!-- 2. Hero Section (Centered Magnitude) -->
            <div class="gempa-hero-section">
                <div class="gempa-mag-value-wrapper">
                    <span class="gempa-mag-value">${props.mag.toFixed(1)}</span>
                    <span class="gempa-mag-unit">M</span>
                </div>
                <div style="font-size:0.75rem; color:#888;">Magnitudo</div>
            </div>

            <!-- 3. Grid Info -->
            <div class="gempa-info-grid">
                <!-- Waktu -->
                <div class="gempa-info-cell">
                    <div class="gempa-icon-circle"><i class="wi wi-time-3"></i></div>
                    <span class="gempa-cell-label">Waktu Kejadian</span>
                    <span class="gempa-cell-value">${formattedTime}</span>
                </div>
                <!-- Kedalaman -->
                <div class="gempa-info-cell">
                    <div class="gempa-icon-circle"><i class="wi wi-direction-down"></i></div>
                    <span class="gempa-cell-label">Kedalaman</span>
                    <span class="gempa-cell-value">${props.depth}</span>
                </div>
            </div>

            <!-- 4. Lokasi (Simple) -->
            <div class="gempa-location-section">
                <svg class="suggestion-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                 <div class="gempa-location-text">${props.place}</div>
            </div>

            <!-- 5. Footer (Sumber & Tombol) -->
            <div class="gempa-footer-section">
                <!-- Sumber di atas Tombol -->
                <div class="gempa-source-text">
                    Sumber Data: <span class="gempa-source-provider">${sourceName}</span>
                </div>
                <button class="popup-btn-detail" id="btn-detail-gempa">
                    Lihat Analisis Lengkap
                </button>
            </div>
        `;
        
        const btn = container.querySelector('#btn-detail-gempa');
        if (btn) {
            btn.addEventListener('click', () => {
                document.dispatchEvent(new CustomEvent('requestSidebarGempa', { detail: { gempaData: props } }));
            });
        }

        return container;
    },
    
    open: function(lngLat, content, options = { maxWidth: '300px', closeButton: true }) {
        const map = mapManager.getMap(); 
        this.close(true);

        if (!map) { return null; }
        if (!Array.isArray(lngLat) || lngLat.length !== 2) { return null; }
        
        try {
            const popupOptions = { ...options, offset: 15 };
            const newPopup = new maplibregl.Popup(popupOptions).setLngLat(lngLat);
            
            if (typeof content === 'string') { newPopup.setHTML(content); }
            else if (content instanceof HTMLElement) { newPopup.setDOMContent(content); } 
            
            this._currentInstance = newPopup;
            
            if (content instanceof HTMLElement) {
                if (content.querySelector('.cluster-popup-content')) this._activePopupType = 'cluster';
                else if (content.classList.contains('province-mode')) this._activePopupType = 'province'; // Berlaku juga untuk negara
                else this._activePopupType = 'weather';
            } else {
                this._activePopupType = 'loading'; 
            }
            
            newPopup.once('close', () => {
                    const wasInternal = this._internalCloseFlag;
                    this._internalCloseFlag = false;
                    
                    // Cleanup Observer
                    if (this._clusterObserver) {
                        this._clusterObserver.disconnect();
                        this._clusterObserver = null;
                    }

                    if (this._currentInstance === newPopup) {
                        this._currentInstance = null;
                        this._activePopupType = null;
                        this._activeClusterItemsGenerator = null;
                    } 
                    if (!wasInternal) {
                        mapManager.resetActiveLocationState(); 
                    }
            });

            newPopup.addTo(map); 
            return newPopup;
        } catch (e) {
            console.error("Failed to create popup:", e);
            return null;
        }
    },

    close: function(isInternalAction = false) {
        if (this._currentInstance) {
            const popupToClose = this._currentInstance;
            this._internalCloseFlag = isInternalAction;
            if (popupToClose.isOpen()) {
                popupToClose.remove();
            }
            if (this._currentInstance === popupToClose) {
                this._currentInstance = null;
            }
        }
        this._internalCloseFlag = false; 
    },

    isOpen: function() { return !!this._currentInstance && this._currentInstance.isOpen(); },
    getElement: function() { return (this._currentInstance && this._currentInstance.isOpen()) ? this._currentInstance.getElement() : null; },
    getInstance: function() { return this._currentInstance; },
    setHTML: function(htmlContent) { if (this.isOpen() && typeof htmlContent === 'string') this._currentInstance.setHTML(htmlContent); },
    setDOMContent: function(domElement) { if (this.isOpen() && domElement instanceof HTMLElement) this._currentInstance.setDOMContent(domElement); },
    
    setClusterGenerator: function(generatorFn) {
        this._activeClusterItemsGenerator = generatorFn;
    },

    // Attach Observer setelah popup dibuka
    attachClusterObserver: function() {
        const popupEl = this.getElement();
        if (!popupEl) return;
        
        const listContainer = popupEl.querySelector('.cluster-popup-content');
        if (!listContainer) return;

        const options = { root: listContainer, threshold: 0.1 };

        if (this._clusterObserver) this._clusterObserver.disconnect();

        this._clusterObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const itemEl = entry.target;
                    const id = itemEl.dataset.id;
                    
                    if (id && !itemEl.dataset.loaded && this._clusterFetchCallback) {
                        // Unobserve dulu biar tidak double trigger
                        observer.unobserve(itemEl);
                        // Trigger Fetch Single
                        this._clusterFetchCallback(id).then(data => {
                            // Update Tampilan Baris Ini Saja
                            if (data) this._updateSingleClusterItem(itemEl, data);
                        });
                    }
                }
            });
        }, options);

        // Observe semua item skeleton
        const skeletons = listContainer.querySelectorAll('.cluster-item.skeleton-mode');
        skeletons.forEach(el => this._clusterObserver.observe(el));
    },

    // Update parsial satu baris item (dari Skeleton -> Real Data)
    _updateSingleClusterItem: function(itemEl, data) {
        const idxDisplay = timeManager.getSelectedTimeIndex();
        
        // [UPDATE] Cek jika data adalah Negara/Provinsi (tidak punya hourly)
        if (!data.hourly) {
             const tip = parseInt(data.tipadm, 10);
             if (tip <= 1) {
                 itemEl.classList.remove('skeleton-mode');
                 itemEl.dataset.loaded = "true";
                 const role = tip === 0 ? "Negara" : "Provinsi";
                 const icon = tip === 0 ? "wi wi-earthquake" : "wi wi-stars"; // Placeholder icon
                 
                 itemEl.innerHTML = `
                    <div style="display:flex; align-items:center; gap:10px;">
                        <i class="${icon}" style="font-size:1.4rem; color:#555; width:24px; text-align:center;"></i>
                        <span style="font-weight: 500; font-size: 0.85rem; color: #333;">${data.nama_simpel}</span>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-weight: 700; color: #333; font-size: 0.9rem;">-</span>
                        <br>
                        <span style="font-size: 0.7rem; color: #888;">${role}</span>
                    </div>
                `;
                return;
             }
        }

        if (idxDisplay < 0) return;

        const extractedData = utils.extractHourlyDataPoint(data.hourly, idxDisplay);
        const info = utils.getWeatherInfo(extractedData.weather_code, extractedData.is_day);
        
        const suhuStr = `${extractedData.suhu?.toFixed(1) ?? '-'}°C`;
        const descStr = info.deskripsi;
        const iconStr = info.ikon;

        itemEl.classList.remove('skeleton-mode');
        itemEl.dataset.loaded = "true";
        
        // Re-render inner HTML
        itemEl.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <i class="${iconStr}" style="font-size:1.4rem; color:#555; width:24px; text-align:center;"></i>
                <span style="font-weight: 500; font-size: 0.85rem; color: #333;">${data.nama_simpel}</span>
            </div>
            <div style="text-align: right;">
                <span style="font-weight: 700; color: #0056b3; font-size: 0.9rem;">${suhuStr}</span>
                <br>
                <span style="font-size: 0.7rem; color: #888;">${descStr}</span>
            </div>
        `;
    },

    /** Memperbarui konten popup saat waktu berubah */
    updateUIForTime: function(idxGlobal, localTimeString) {
        if (!this.isOpen()) return;
        
        if (this._activePopupType === 'cluster' && this._activeClusterItemsGenerator) {
            const newData = this._activeClusterItemsGenerator();
            if (newData && newData.items) {
                // Render ulang seluruh list untuk update waktu
                // (Observer akan otomatis dipasang ulang karena list baru)
                const newContent = this.generateClusterPopupContent(newData.title, newData.items);
                this.setDOMContent(newContent);
                this.attachClusterObserver(); 
            }
            return;
        }

        const popupEl = this.getElement();
        if (!popupEl) return;
        const card = popupEl.querySelector('.weather-popup-card');
        
        if (card && !card.classList.contains('province-mode') && !card.querySelector('.cluster-popup-content') && !card.classList.contains('gempa-popup-mode')) {
            const activeData = mapManager.getActiveLocationData();
            if (activeData && parseInt(activeData.tipadm, 10) > 1 && activeData.hourly?.time) {
                try {
                    if (idxGlobal >= activeData.hourly.time.length) return; 
                    
                    const formattedTime = utils.formatLocalTimestampString(localTimeString); 
                    const dataPoint = utils.extractHourlyDataPoint(activeData.hourly, idxGlobal);
                    const { deskripsi, ikon } = utils.getWeatherInfo(dataPoint.weather_code, dataPoint.is_day); 
                    
                    const timeEl = card.querySelector('.popup-time'); 
                    if (timeEl) timeEl.textContent = formattedTime;
                    const iconEl = card.querySelector('.popup-icon-container i');
                    if (iconEl) iconEl.className = ikon;
                    const tempEl = card.querySelector('.popup-temp');
                    if (tempEl) tempEl.textContent = `${dataPoint.suhu?.toFixed(1) ?? "-"}°`;
                    const descEl = card.querySelector('.popup-desc');
                    if (descEl) descEl.textContent = deskripsi;

                    const gridItems = card.querySelectorAll('.popup-detail-item span');
                    if (gridItems.length >= 4) {
                        gridItems[0].textContent = `Terasa: ${dataPoint.terasa?.toFixed(1) ?? "-"}°`;
                        gridItems[1].textContent = `${dataPoint.kelembapan ?? "-"}%`;
                        gridItems[2].textContent = `${dataPoint.prob_presipitasi ?? "-"}%`;
                        gridItems[3].textContent = `${dataPoint.kecepatan_angin_10m ?? "-"} m/s`;
                    }
                } catch (e) { console.warn("Error updating popup DOM:", e); }
            }
        }
    }
};