import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { mapManager } from "./map_manager.js";
import { timeManager } from "./time_manager.js"; // Import timeManager untuk update parsial

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

    /** * [BARU] GENERATOR 5: POPUP GEMPA (Interaktif & Aesthetic) */
    generateGempaPopupContent: function(props) {
        const container = document.createElement('div');
        container.className = 'weather-popup-card';
        // Gunakan class khusus gempa agar bisa di-style berbeda jika perlu
        container.classList.add('gempa-popup-mode');

        // Header: Warna Merah (Tsunami) atau Dark Grey (Standard)
        const isTsunami = props.tsunami;
        const headerColor = isTsunami ? '#d32f2f' : '#455A64';
        
        const header = document.createElement('div');
        header.className = 'popup-header';
        header.style.backgroundColor = headerColor;
        header.style.color = 'white';
        header.style.borderBottom = 'none';
        
        header.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="popup-title" style="color:white; margin:0; font-size:1.2rem;">M ${props.mag.toFixed(1)}</div>
                ${isTsunami ? '<span style="background:white; color:#d32f2f; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:800;">TSUNAMI</span>' : ''}
            </div>
            <div style="font-size:0.8rem; opacity:0.9; margin-top:4px;">
                ${new Date(props.time).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' })}
            </div>
        `;
        container.appendChild(header);

        const body = document.createElement('div');
        body.style.padding = '15px';
        
        body.innerHTML = `
            <div style="font-weight:600; font-size:0.95rem; color:#333; margin-bottom:12px; line-height:1.4;">
                ${props.place}
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div style="background:#f5f5f5; padding:8px; border-radius:6px; display:flex; align-items:center; gap:8px;">
                    <i class="wi wi-earthquake" style="color:#455A64; font-size:1.2rem;"></i>
                    <div>
                        <div style="font-size:0.7rem; color:#777;">Kedalaman</div>
                        <div style="font-weight:700; color:#333;">${props.depth}</div>
                    </div>
                </div>
                <div style="background:#f5f5f5; padding:8px; border-radius:6px; display:flex; align-items:center; gap:8px;">
                    <i class="wi wi-time-3" style="color:#455A64; font-size:1.2rem;"></i>
                    <div>
                        <div style="font-size:0.7rem; color:#777;">Waktu</div>
                        <div style="font-weight:700; color:#333;">${new Date(props.time).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</div>
                    </div>
                </div>
            </div>
            <div style="margin-top:10px; font-size:0.75rem; color:#999; text-align:right;">
                Sumber: ${props.source ? props.source.toUpperCase() : 'BMKG'}
            </div>
        `;
        container.appendChild(body);

        const footer = document.createElement('div');
        footer.className = 'popup-footer';
        const button = document.createElement('button');
        button.className = 'popup-btn-detail';
        // Style tombol agar sesuai tema gempa
        button.style.backgroundColor = isTsunami ? '#ffebee' : '#eceff1';
        button.style.color = isTsunami ? '#b71c1c' : '#37474f';
        button.textContent = 'Lihat Analisis Lengkap';
        
        // Klik tombol akan dispatch event custom untuk Sidebar
        button.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('requestSidebarGempa', { 
                detail: { gempaData: props } 
            }));
        });
        
        footer.appendChild(button);
        container.appendChild(footer);

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
                else if (content.classList.contains('province-mode')) this._activePopupType = 'province';
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

        const options = {
            root: listContainer, 
            threshold: 0.1
        };

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

    // [BARU] Update parsial satu baris item (dari Skeleton -> Real Data)
    _updateSingleClusterItem: function(itemEl, data) {
        const idxDisplay = timeManager.getSelectedTimeIndex();
        if (!data.hourly || idxDisplay < 0) return;

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
            if (activeData && activeData.tipadm !== 1 && activeData.hourly?.time) {
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