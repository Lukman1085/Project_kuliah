import { cacheManager } from "./cache_manager";
import { utils } from "./utilities";
import { mapManager } from "./map_manager";

/** 팝-업 PENGELOLA POPUP TERPUSAT */
export const popupManager = { 
    _currentInstance: null,
    _internalCloseFlag: false,

    /** Membuat konten DOM untuk popup (Bukan string HTML) */
    generatePopupContent: function(nama, data, deskripsi, ikon, formattedTime) {
        // (Se bagian besar tidak berubah, kecuali event listener)
        const container = document.createElement('div');
        container.className = 'weather-popup-content';
        const namaEl = document.createElement('b');
        namaEl.textContent = nama;
        const timeEl = document.createElement('div');
        timeEl.id = 'popup-time';
        timeEl.style.cssText = 'font-size: 12px; color: #555;';
        timeEl.textContent = formattedTime;
        const weatherWrapper = document.createElement('div');
        weatherWrapper.className = 'popup-current-weather';
        const iconEl = document.createElement('i');
        iconEl.id = 'popup-icon';
        iconEl.className = ikon;
        const detailsWrapper = document.createElement('div');
        detailsWrapper.className = 'popup-details';
        const createDetailEl = (id, htmlContent) => {
            const el = document.createElement('div');
            if (id) el.id = id;
            el.innerHTML = htmlContent;
            return el;
        };
        const tempDescEl = createDetailEl(null, `<b id="popup-temp">${data.suhu?.toFixed(1) ?? '-'}°C</b> <span id="popup-desc">(${deskripsi})</span>`);
        const feelsLikeEl = createDetailEl('popup-feelslike', `Terasa: <b>${data.terasa?.toFixed(1) ?? '-'}°C</b>`);
        const humidityEl = createDetailEl('popup-humidity', `Kelembapan: <b>${data.kelembapan ?? '-'}%</b>`);
        const precipEl = createDetailEl('popup-precipitation', `Presipitasi: <b>${data.prob_presipitasi ?? '-'}%</b>`);
        const windEl = createDetailEl('popup-wind', `Angin: <b>${data.kecepatan_angin_10m ?? '-'} m/s</b> dari arah ${data.arah_angin_10m ?? '-'}°`);
        detailsWrapper.appendChild(tempDescEl);
        detailsWrapper.appendChild(feelsLikeEl);
        detailsWrapper.appendChild(humidityEl);
        detailsWrapper.appendChild(precipEl);
        detailsWrapper.appendChild(windEl);
        weatherWrapper.appendChild(iconEl);
        weatherWrapper.appendChild(detailsWrapper);
        const actionsWrapper = document.createElement('div');
        actionsWrapper.className = 'popup-actions';
        const button = document.createElement('button');
        button.id = 'popup-sidebar-btn-dynamic';
        button.textContent = 'Lihat Detail di Sidebar';
        
        // --- REFAKTOR (Proyek 2.2) ---
        // Dekopling: Memancarkan event, alih-alih memanggil sidebarManager
        button.addEventListener('click', () => {
            // sidebarManager.openSidebarFromPopup(); // <-- Dihapus
            document.dispatchEvent(new CustomEvent('requestSidebarDetail'));
        });
        // --- Akhir Refaktor ---
        
        actionsWrapper.appendChild(button);
        container.appendChild(namaEl);
        container.appendChild(timeEl);
        container.appendChild(weatherWrapper);
        container.appendChild(actionsWrapper);
        return container;
        },
    
        // (Tidak ada perubahan di 'open', 'close', 'isOpen', 'getElement', 'getInstance', 'setHTML', 'setDOMContent')
    open: function(lngLat, content, options = { maxWidth: '260px' }) {
        this.close(true);
        if (!Array.isArray(lngLat) || lngLat.length !== 2 || typeof lngLat[0] !== 'number' || typeof lngLat[1] !== 'number' || isNaN(lngLat[0]) || isNaN(lngLat[1])) { console.error("Invalid lngLat:", lngLat); return null; }
        try {
            const newPopup = new maplibregl.Popup(options).setLngLat(lngLat);
            if (typeof content === 'string') { newPopup.setHTML(content); }
            else if (content instanceof HTMLElement) { newPopup.setDOMContent(content); } 
            else { newPopup.setHTML("Invalid content."); }
            this._currentInstance = newPopup;
            newPopup.once('close', () => {
                    const wasInternal = popupManager._internalCloseFlag;
                    popupManager._internalCloseFlag = false;
                    if (popupManager._currentInstance === newPopup) {
                        popupManager._currentInstance = null;
                    } 
                    if (!wasInternal) {
                        mapManager.resetActiveLocationState(); 
                    }
            });
            newPopup.addTo(map);
            return newPopup;
        } catch (e) {
                console.error("Failed to create/add popup:", e, " LngLat:", lngLat);
                if (this._currentInstance === newPopup) this._currentInstance = null;
                return null;
        }
    },
    close: function(isInternalAction = false) {
        if (this._currentInstance) {
            const popupToClose = this._currentInstance;
            this._internalCloseFlag = isInternalAction;
            try {
                if (popupToClose.isOpen()) {
                    popupToClose.remove();
                } else {
                    if(this._currentInstance === popupToClose){
                            this._currentInstance = null; this._internalCloseFlag = false;
                    }
                }
            } catch(e) {
                    console.warn("Error removing popup:", e);
                    if(this._currentInstance === popupToClose){ this._currentInstance = null; }
                    this._internalCloseFlag = false;
            }
        } else { this._internalCloseFlag = false; }
    },
    isOpen: function() { return !!this._currentInstance && this._currentInstance.isOpen(); },
    getElement: function() { return (this._currentInstance && this._currentInstance.isOpen()) ? this._currentInstance.getElement() : null; },
    getInstance: function() { return this._currentInstance; },
    setHTML: function(htmlContent) { if (this._currentInstance && this._currentInstance.isOpen() && typeof htmlContent === 'string') { try { this._currentInstance.setHTML(htmlContent); } catch (e) { console.error("Err setHTML:", e); } } },
    setDOMContent: function(domElement) { if (this._currentInstance && this._currentInstance.isOpen() && domElement instanceof HTMLElement) { try { this._currentInstance.setDOMContent(domElement); } catch (e) { console.error("Err setDOMContent:", e); } } },
    
    /** Memperbarui konten popup (jika terbuka) untuk waktu yang dipilih. */
    updateUIForTime: function(idxGlobal, localTimeString) {
        if (!this.isOpen()) return;
        const popupEl = this.getElement();
        if (!popupEl) return;
        const singlePopup = popupEl.querySelector('.weather-popup-content');
        if (singlePopup) {
            const activeData = mapManager.getActiveLocationData();
            if (activeData && activeData.hourly?.time) {
                try {
                    const hourly = activeData.hourly;
                    if (idxGlobal >= hourly.time.length) return; 
                    const formattedTime = utils.formatLocalTimestampString(localTimeString); 
                    const dataPoint = utils.extractHourlyDataPoint(hourly, idxGlobal);
                    const { deskripsi, ikon } = utils.getWeatherInfo(dataPoint.weather_code, dataPoint.is_day); 
                    const timeEl = singlePopup.querySelector('#popup-time'); if (timeEl) timeEl.textContent = formattedTime;
                    const iconEl = singlePopup.querySelector('#popup-icon'); if (iconEl) iconEl.className = ikon;
                    const tempEl = singlePopup.querySelector('#popup-temp'); if (tempEl) tempEl.textContent = `${dataPoint.suhu?.toFixed(1) ?? "-"}°C`;
                    const descEl = singlePopup.querySelector('#popup-desc'); if (descEl) descEl.textContent = `(${deskripsi})`;
                    const feelsLikeEl = singlePopup.querySelector('#popup-feelslike'); if (feelsLikeEl) feelsLikeEl.innerHTML = `Terasa: <b>${dataPoint.terasa?.toFixed(1) ?? "-"}°C</b>`;
                    const humidityEl = singlePopup.querySelector('#popup-humidity'); if (humidityEl) humidityEl.innerHTML = `Kelembapan: <b>${dataPoint.kelembapan ?? "-"}%</b>`;
                    const precipEl = singlePopup.querySelector('#popup-precipitation'); if (precipEl) precipEl.innerHTML = `Presipitasi: <b>${dataPoint.prob_presipitasi ?? "-"}%</b>`;
                    const windEl = singlePopup.querySelector('#popup-wind'); if (windEl) windEl.innerHTML = `Angin: <b>${dataPoint.kecepatan_angin_10m ?? "-"} m/s</b> dari arah ${dataPoint.arah_angin_10m ?? "-"}°`;
                } catch (e) { console.warn("Error updating single popup DOM:", e); }
            }
        }
        const clusterPopup = popupEl.querySelector('.cluster-popup-content');
        if (clusterPopup) {
            try {
                const clusterItems = clusterPopup.querySelectorAll('.cluster-item');
                clusterItems.forEach(item => {
                    const id = item.dataset.id;
                    if (!id) return;
                    const itemData = cacheManager.get(id);
                    if (!itemData?.hourly?.time) return;
                    if (idxGlobal >= itemData.hourly.time.length) return; 
                    const itemHourly = itemData.hourly;
                    const itemDataPoint = utils.extractHourlyDataPoint(itemHourly, idxGlobal);
                    const { deskripsi: itemDeskripsi } = utils.getWeatherInfo(itemDataPoint.weather_code, itemDataPoint.is_day); 
                    const suhuEl = item.querySelector('.item-suhu');
                    const descEl = item.querySelector('.item-desc');
                    if (suhuEl) suhuEl.textContent = `${itemDataPoint.suhu?.toFixed(1) ?? '-'}°C`;
                    if (descEl) descEl.textContent = itemDeskripsi;
                });
            } catch (e) { console.warn("Error updating cluster popup DOM:", e); }
        }
    }
};