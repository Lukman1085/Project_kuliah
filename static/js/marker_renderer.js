import { utils } from "./utilities.js";
import { timeManager } from "./time_manager.js";
import { cacheManager } from "./cache_manager.js";
// [CONSTANTS] Import Constants untuk konsistensi
import { CSS_CLASSES } from "./constants.js"; 

/** * 🎨 MARKER RENDERER
 * Bertanggung jawab murni untuk pembuatan dan manipulasi DOM Marker.
 * Memisahkan 'View' dari 'Logic' di MapManager.
 */
export const MarkerRenderer = {

    /**
     * Membuat elemen HTML untuk marker tunggal (Non-cluster)
     */
    createMarkerElement: function(id, props, handlers) {
        const safeId = String(id).replace(/[^a-zA-Z0-9-_]/g, '-');
        const tipadm = parseInt(props.tipadm, 10);
        const isProvince = (tipadm === 1);
        
        const container = document.createElement('div');
        container.className = 'marker-container'; 
        container.id = `marker-${safeId}`;
        
        if (handlers.onHover) container.addEventListener('mouseenter', () => handlers.onHover(id, tipadm));
        if (handlers.onLeave) container.addEventListener('mouseleave', () => handlers.onLeave());
        if (handlers.onClick) {
            container.addEventListener('click', (e) => {
                e.stopPropagation(); 
                handlers.onClick(props);
            });
        }
        
        if (isProvince) {
            const svgPin = `
                <svg viewBox="0 0 24 24" width="22" height="22" fill="white">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
            `;
            container.innerHTML = `
                <div class="location-badge province-badge">${props.nama_simpel}</div>
                <div class="marker-capsule marker-theme-province" id="capsule-${safeId}">
                    <div class="main-icon-wrapper">${svgPin}</div>
                    <div class="status-stack-province"><span style="font-size:10px; font-weight:bold; color:#555;">PROV</span></div>
                </div>
                <div class="marker-anchor"></div><div class="marker-pulse"></div>`;
        } else {
            container.innerHTML = `
                <div class="location-badge">${props.nama_simpel}</div>
                <div class="marker-capsule" id="capsule-${safeId}">
                    <div class="main-icon-wrapper"><i id="icon-weather-${safeId}" class="wi wi-na"></i></div>
                    <div class="status-stack">
                        <div class="thermo-stack"><i class="wi wi-thermometer-internal thermo-liquid" id="icon-thermo-${safeId}"></i><i class="wi wi-thermometer-exterior thermo-frame"></i></div>
                        <div class="rain-icon-box"><i class="wi wi-raindrop" id="icon-rain-${safeId}"></i></div>
                    </div>
                </div>
                <div class="marker-anchor"></div><div class="marker-pulse"></div>`;
        }

        return container;
    },

    /**
     * Membuat elemen HTML untuk Cluster
     */
    createClusterElement: function(members, handlers) {
        const count = members.length;
        const container = document.createElement('div');
        container.className = 'marker-container'; 
        
        if (handlers.onHover) container.addEventListener('mouseenter', handlers.onHover);
        if (handlers.onLeave) container.addEventListener('mouseleave', handlers.onLeave);

        let gradientClass = 'cluster-gradient-blue'; 
        if (count > 10) gradientClass = 'cluster-gradient-yellow'; 
        if (count > 50) gradientClass = 'cluster-gradient-red'; 

        container.innerHTML = `
            <div class="marker-capsule" style="padding: 2px 8px 2px 2px; gap: 6px; align-items: center;">
                <div class="cluster-count-circle ${gradientClass}" style="
                    width: 32px; height: 32px; 
                    border-radius: 50%; 
                    color: white; font-weight: bold; font-size: 13px;
                    display: flex; justify-content: center; align-items: center;">
                    ${count}
                </div>
                <span style="font-size: 11px; text-transform: uppercase;">Lokasi</span>
            </div>
            <div class="marker-anchor"></div>
            <div class="marker-pulse"></div>
        `;

        if (handlers.onClick) {
            container.addEventListener('click', (e) => {
                e.stopPropagation();
                handlers.onClick(members);
            });
        }

        return container;
    },

    /**
     * [PERBAIKAN BUG #1 & #2]
     * Fungsi khusus untuk update visual state (dimmed/active) TANPA peduli tipe marker.
     * Ini memastikan Provinsi dan Cluster juga kena efek toggle.
     */
    updateVisualStateOnly: function(markerInstance, isGempaActive) {
        if (!markerInstance) return;
        const el = markerInstance.getElement();
        
        // Gunakan Konstanta CSS
        if (isGempaActive) {
            el.classList.add(CSS_CLASSES.MARKER_DIMMED);
            // Reset opacity manual jika ada sisa inline style
            el.style.opacity = ''; 
            el.style.pointerEvents = '';
        } else {
            el.classList.remove(CSS_CLASSES.MARKER_DIMMED);
        }
    },

    /**
     * Memperbarui konten DATA marker (Ikon, Suhu, dll).
     * Tetap memfilter Provinsi karena Provinsi tidak punya data cuaca hourly.
     */
    updateMarkerContent: function(markerInstance, id, isGempaActive) {
        if (!markerInstance) return;
        const el = markerInstance.getElement();
        
        // [KONTEKS] Update Visual State juga dipanggil di sini untuk sinkronisasi saat render ulang
        this.updateVisualStateOnly(markerInstance, isGempaActive);

        // [FILTER] Provinsi tidak perlu update konten cuaca
        if (el.querySelector(`.${CSS_CLASSES.MARKER_PROVINCE}`)) return; 

        const safeId = String(id).replace(/[^a-zA-Z0-9-_]/g, '-');
        
        let capsuleEl, weatherIconEl, thermoIconEl, rainIconEl;
        try {
            capsuleEl = el.querySelector(`#capsule-${safeId}`);
            weatherIconEl = el.querySelector(`#icon-weather-${safeId}`);
            thermoIconEl = el.querySelector(`#icon-thermo-${safeId}`);
            rainIconEl = el.querySelector(`#icon-rain-${safeId}`);
        } catch (e) { return; }

        const cachedData = cacheManager.get(String(id));
        const idx = timeManager.getSelectedTimeIndex();

        // State 1: Skeleton / Loading
        if (!cachedData) {
            el.classList.add('marker-skeleton'); 
            if (capsuleEl) capsuleEl.className = 'marker-capsule marker-theme-skeleton';
            if (weatherIconEl) weatherIconEl.className = 'wi wi-time-4'; 
            if (thermoIconEl) thermoIconEl.style.color = '#ccc';
            if (rainIconEl) rainIconEl.style.color = '#ccc';
            return;
        } 
        
        // State 2: Data Ready
        el.classList.remove('marker-skeleton');

        if (cachedData.hourly?.time && idx < cachedData.hourly.time.length) {
            const hourly = cachedData.hourly;
            const code = hourly.weather_code?.[idx];
            const isDay = hourly.is_day?.[idx];
            const temp = hourly.temperature_2m?.[idx];
            const precip = hourly.precipitation_probability?.[idx];

            const weatherInfo = utils.getWeatherInfo(code, isDay);
            const themeClass = utils.getWeatherTheme(code, isDay);

            if (capsuleEl) capsuleEl.className = `marker-capsule ${themeClass}`;
            if (weatherIconEl) weatherIconEl.className = `wi ${weatherInfo.raw_icon_name}`;
            if (thermoIconEl) thermoIconEl.style.color = utils.getTempColor(temp);
            if (rainIconEl) rainIconEl.style.color = utils.getRainColor(precip);
            
             if (!isGempaActive) {
                el.style.opacity = ''; 
                el.style.pointerEvents = '';
             }
        } else { 
             if (!isGempaActive) el.style.opacity = 0.7; 
        }
    }
};