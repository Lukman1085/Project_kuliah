import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { mapManager } from "./map_manager.js";

/** 🏙️ PENGELOLA POPUP TERPUSAT */
export const popupManager = { 
    _currentInstance: null,
    _internalCloseFlag: false,

    /** * GENERATOR 1: POPUP LENGKAP (Mini Sidebar) untuk Non-Provinsi 
     */
    generatePopupContent: function(nama, data, deskripsi, ikon, formattedTime) {
        const container = document.createElement('div');
        container.className = 'weather-popup-card'; // Class baru untuk styling css

        // Header: Nama & Waktu
        const header = document.createElement('div');
        header.className = 'popup-header';
        header.innerHTML = `
            <div class="popup-title">${nama}</div>
            <div class="popup-time">${formattedTime}</div>
        `;
        container.appendChild(header);

        // Main Weather: Icon & Temp
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

        // Details Grid (Mini Version of Sidebar)
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

        // Footer: Action Button
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

    /** * GENERATOR 2: POPUP PROVINSI (Minimalis)
     * Hanya Nama Wilayah & Tombol Lihat Detail (Sub-wilayah di sidebar)
     */
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
    
    open: function(lngLat, content, options = { maxWidth: '300px', closeButton: true }) {
        const map = mapManager.getMap(); 
        this.close(true);

        if (!map) { return null; }
        if (!Array.isArray(lngLat) || lngLat.length !== 2) { return null; }
        
        try {
            // Gunakan offset agar popup tidak menutupi marker persis
            const popupOptions = { ...options, offset: 15 };
            const newPopup = new maplibregl.Popup(popupOptions).setLngLat(lngLat);
            
            if (typeof content === 'string') { newPopup.setHTML(content); }
            else if (content instanceof HTMLElement) { newPopup.setDOMContent(content); } 
            
            this._currentInstance = newPopup;
            
            newPopup.once('close', () => {
                    const wasInternal = this._internalCloseFlag;
                    this._internalCloseFlag = false;
                    if (this._currentInstance === newPopup) {
                        this._currentInstance = null;
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
        this._internalCloseFlag = false; // Reset flag
    },

    isOpen: function() { return !!this._currentInstance && this._currentInstance.isOpen(); },
    getElement: function() { return (this._currentInstance && this._currentInstance.isOpen()) ? this._currentInstance.getElement() : null; },
    getInstance: function() { return this._currentInstance; },
    setHTML: function(htmlContent) { if (this.isOpen() && typeof htmlContent === 'string') this._currentInstance.setHTML(htmlContent); },
    setDOMContent: function(domElement) { if (this.isOpen() && domElement instanceof HTMLElement) this._currentInstance.setDOMContent(domElement); },
    
    /** Memperbarui konten popup non-provinsi saat waktu berubah */
    updateUIForTime: function(idxGlobal, localTimeString) {
        if (!this.isOpen()) return;
        const popupEl = this.getElement();
        if (!popupEl) return;

        // Cek apakah ini popup "Mini Sidebar" (weather-popup-card)
        const card = popupEl.querySelector('.weather-popup-card');
        
        // Jika ini popup provinsi, jangan update cuaca!
        if (card && card.classList.contains('province-mode')) return;

        // Update logika untuk popup biasa
        if (card) {
            const activeData = mapManager.getActiveLocationData();
            // Pastikan bukan provinsi dan data valid
            if (activeData && activeData.tipadm !== 1 && activeData.hourly?.time) {
                try {
                    if (idxGlobal >= activeData.hourly.time.length) return; 
                    
                    const formattedTime = utils.formatLocalTimestampString(localTimeString); 
                    const dataPoint = utils.extractHourlyDataPoint(activeData.hourly, idxGlobal);
                    const { deskripsi, ikon } = utils.getWeatherInfo(dataPoint.weather_code, dataPoint.is_day); 
                    
                    // Update DOM Elements secara spesifik agar tidak redraw total (flicker)
                    const timeEl = card.querySelector('.popup-time'); 
                    if (timeEl) timeEl.textContent = formattedTime;
                    
                    const iconEl = card.querySelector('.popup-icon-container i');
                    if (iconEl) iconEl.className = ikon;
                    
                    const tempEl = card.querySelector('.popup-temp');
                    if (tempEl) tempEl.textContent = `${dataPoint.suhu?.toFixed(1) ?? "-"}°`;
                    
                    const descEl = card.querySelector('.popup-desc');
                    if (descEl) descEl.textContent = deskripsi;

                    // Update details grid items (agak tricky karena generated string, tapi kita bisa update urutan)
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