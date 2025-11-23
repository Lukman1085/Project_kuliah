// ================================================================
// 1. IMPORT EKSTERNAL
// ================================================================
import { mapManager } from './map_manager.js';
import { sidebarManager } from './sidebar_manager.js';
import { timeManager } from './time_manager.js';
import { popupManager } from './popup_manager.js';
import { utils, WMO_CODE_MAP } from './utilities.js';
import { MAP_STYLE } from './map_style.js';
import { ResetPitchControl } from './reset_pitch_ctrl.js';
import { calendarManager } from './calender_manager.js';
import { searchBarManager } from './searchbar.js';
import { legendManager } from './legend_manager.js'; 

// ================================================================
// 2. KONFIGURASI & STATE GLOBAL
// ================================================================

const protocol = window.location.protocol;
const hostname = window.location.hostname;
const port = '5000';
const baseUrl = `${protocol}//${hostname}:${port}`;

let map; 
let searchDebounceTimer; 

// ================================================================
// 3. TITIK MASUK APLIKASI (APPLICATION ENTRYPOINT)
// ================================================================
document.addEventListener('DOMContentLoaded', function() {

    // ================================================================
    // 1. Ambil Elemen UI
    // ================================================================
    const sidebarEl = document.getElementById('detail-sidebar');
    const toggleBtnEl = document.getElementById('sidebar-toggle-btn');
    const closeBtnEl = document.getElementById('close-sidebar-btn');
    const sidebarContentEl = document.getElementById('sidebar-content');
    const sidebarLocationNameEl = document.getElementById('sidebar-location-name');
    const sidebarPlaceholderEl = document.getElementById('sidebar-placeholder');
    const sidebarLoadingEl = document.getElementById('sidebar-loading');
    const sidebarWeatherDetailsEl = document.getElementById('sidebar-weather-details');
    const sidebarProvinceDetailsEl = document.getElementById('sidebar-province-details');
    
    const prevDayBtn = document.getElementById('prev-day-btn');
    const nextDayBtn = document.getElementById('next-day-btn');
    const dateDisplay = document.getElementById('date-display');
    const calendarBtn = document.getElementById('calendar-btn');
    const prevThreeHourBtn = document.getElementById('prev-three-hour-btn');
    const prevHourBtn = document.getElementById('prev-hour-btn');
    const nextHourBtn = document.getElementById('next-hour-btn');
    const nextThreeHourBtn = document.getElementById('next-three-hour-btn');
    const hourDisplay = document.getElementById('hour-display');
    
    const calendarPopup = document.getElementById('calendar-popup');
    const calendarGrid = document.getElementById('calendar-grid');
    const calendarMonthYear = document.getElementById('calendar-month-year');
    
    const calendarPrevMonthBtn = document.getElementById('calendar-prev-month'); 
    const calendarNextMonthBtn = document.getElementById('calendar-next-month'); 
    
    const searchInput = document.getElementById('search-bar');
    const suggestionsDropdown = document.getElementById('suggestions-dropdown');

    const subRegionContainerEl = document.getElementById('sidebar-sub-region-container');
    const subRegionTitleEl = document.getElementById('sidebar-sub-region-title');
    const subRegionLoadingEl = document.getElementById('sidebar-sub-region-loading');
    const subRegionListEl = document.getElementById('sidebar-sub-region-list');

    // ================================================================
    // 2. Inisialisasi Manajer (Dependency Injection)
    // ================================================================
    
    sidebarManager.initDOM({
        sidebarEl, toggleBtnEl, closeBtnEl, sidebarContentEl, sidebarLocationNameEl,
        sidebarPlaceholderEl, sidebarLoadingEl, sidebarWeatherDetailsEl, sidebarProvinceDetailsEl,
        sidebarEl, subRegionContainerEl, subRegionTitleEl, subRegionLoadingEl, subRegionListEl
    });

    sidebarManager.initWeatherElements({
        timeEl: document.getElementById('sidebar-current-time'),
        iconEl: document.getElementById('sidebar-current-icon'),
        tempEl: document.getElementById('sidebar-current-temp'),
        descEl: document.getElementById('sidebar-current-desc'),
        feelsLikeEl: document.getElementById('sidebar-current-feelslike'),
        humidityEl: document.getElementById('sidebar-current-humidity'),
        precipEl: document.getElementById('sidebar-current-precipitation'),
        windEl: document.getElementById('sidebar-current-wind'),
        dailyListEl: document.getElementById('sidebar-daily-forecast-list')
    });
    
    timeManager.initDOM({
        prevDayBtn, nextDayBtn, dateDisplay, hourDisplay,
        prevThreeHourBtn, prevHourBtn, nextHourBtn, nextThreeHourBtn
    });

    searchBarManager.init({ searchInput, suggestionsDropdown });

    calendarManager.initDOM({ calendarPopup, calendarGrid, calendarMonthYear });

    // ================================================================
    // 3. Logika Inisialisasi Awal
    // ================================================================
    fetch(`${baseUrl}/api/wmo-codes`)
        .then(res => res.ok ? res.json() : Promise.reject(`Error ${res.status}`))
        .then(data => { Object.assign(WMO_CODE_MAP, data); })
        .catch(e => console.error("Gagal memuat WMO codes:", e));

    timeManager.init();
    
    // ================================================================
    // 4. Pasang Event Listener
    // ================================================================

    prevDayBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() - 24));
    nextDayBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() + 24));
    prevThreeHourBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() - 3));
    prevHourBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() - 1));
    nextHourBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() + 1));
    nextThreeHourBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() + 3));
    
    calendarBtn.addEventListener('click', (e) => { e.stopPropagation(); calendarManager.toggleCalendar(); });
    calendarPrevMonthBtn.addEventListener('click', (e) => { e.stopPropagation(); calendarManager.changeCalendarMonth(-1); });
    calendarNextMonthBtn.addEventListener('click', (e) => { e.stopPropagation(); calendarManager.changeCalendarMonth(1); });

    toggleBtnEl.addEventListener('click', () => sidebarManager.toggleSidebar());
    closeBtnEl.addEventListener('click', () => sidebarManager.closeSidebar());

    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        const query = searchInput.value;
        if (query.length < 3) { 
            suggestionsDropdown.innerHTML = '';
            suggestionsDropdown.style.display = 'none';
            return;
        }
        searchDebounceTimer = setTimeout(() => { searchBarManager.fetchLokasi(query); }, 350); 
    });
    searchInput.addEventListener('focus', () => {
        const query = searchInput.value;
        if (query.length >= 3) { searchBarManager.fetchLokasi(query); }
    });
    
    document.addEventListener('click', function(e) {
        const wrapper = document.getElementById('search-wrapper');
        if (wrapper && !wrapper.contains(e.target)) { suggestionsDropdown.style.display = 'none'; }
        if (calendarPopup && calendarPopup.style.display === 'block') {
            if (!calendarPopup.contains(e.target) && e.target !== calendarBtn) { calendarManager.toggleCalendar(); }
        }
    });
    
    document.getElementById('search-btn').addEventListener('click', () => {
        const query = searchInput.value;
        if (query.length < 3) return;
        clearTimeout(searchDebounceTimer);
        searchBarManager.fetchLokasi(query);
        searchInput.focus();
    });

    // Listener Khusus
    document.addEventListener('requestSidebarDetail', () => { sidebarManager.openSidebarFromPopup(); });
    document.addEventListener('requestSidebarOpen', () => { if (!sidebarManager.isOpen()) { sidebarManager.openSidebar(); } });
    
    // Listener untuk Membuka Sidebar Gempa dari Popup
    document.addEventListener('requestSidebarGempa', (e) => {
        if (!sidebarManager.isOpen()) sidebarManager.openSidebar();
        // Pastikan sidebarManager punya data yang dikirim dari event
        if (e.detail && e.detail.gempaData) {
            sidebarManager.renderSidebarGempa(e.detail.gempaData);
        }
    });

    // ================================================================
    // 5. Inisialisasi Peta & Event Peta
    // ================================================================
    
    map = new maplibregl.Map({ 
        container: 'map',
        style: MAP_STYLE,
        center: [118.0149, -2.5489], zoom: 4.5, minZoom: 4, maxZoom: 14,
        maxBounds: [[90, -15], [145, 10]]
    });

    mapManager.setMap(map);

    map.on('load', () => {
        map.addSource('cartodb-labels', { type: 'raster', tiles: ['https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'], tileSize: 256 });
        map.addLayer({ id: 'cartodb-labels-layer', type: 'raster', source: 'cartodb-labels', minzoom: 7 });

        // --- FACTORY ANIMASI CANGGIH (SONAR & PULSE) ---
        function createPulsingDot(type, size, r, g, b, duration) {
            return {
                width: size,
                height: size,
                data: new Uint8Array(size * size * 4),

                onAdd: function () {
                    const canvas = document.createElement('canvas');
                    canvas.width = this.width;
                    canvas.height = this.height;
                    this.context = canvas.getContext('2d');
                },

                render: function () {
                    const now = performance.now();
                    const context = this.context;
                    context.clearRect(0, 0, this.width, this.height);

                    const centerX = this.width / 2;
                    const centerY = this.height / 2;
                    const maxRadius = (this.width / 2) * 0.95;
                    
                    if (type === 'sonar') {
                        const waveCount = 3; 
                        
                        // 1. Gambar Inti Merah Solid
                        context.beginPath();
                        context.arc(centerX, centerY, 8, 0, Math.PI * 2);
                        context.fillStyle = `rgba(${r}, ${g}, ${b}, 1)`;
                        context.fill();
                        context.strokeStyle = '#ffffff';
                        context.lineWidth = 2;
                        context.stroke();

                        // 2. Gambar Gelombang Cincin
                        for (let i = 0; i < waveCount; i++) {
                            const offset = (duration / waveCount) * i;
                            let t = ((now + offset) % duration) / duration;
                            t = 1 - Math.pow(1 - t, 3);
                            
                            const radius = maxRadius * t;
                            const alpha = Math.max(0, (1 - t) * 0.8);

                            context.beginPath();
                            context.arc(centerX, centerY, radius, 0, Math.PI * 2);
                            context.lineWidth = 4 * (1 - t); 
                            context.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                            context.stroke();
                        }
                    } else {
                        const t = (now % duration) / duration;
                        const radius = maxRadius * t;
                        const outerAlpha = (1 - t) * 0.6;
                        
                        context.beginPath();
                        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
                        context.fillStyle = `rgba(${r}, ${g}, ${b}, ${outerAlpha})`;
                        context.fill();

                        context.beginPath();
                        context.arc(centerX, centerY, 6, 0, Math.PI * 2);
                        context.fillStyle = 'rgba(255, 255, 255, 0.9)';
                        context.fill();
                        context.lineWidth = 2;
                        context.strokeStyle = `rgba(${r}, ${g}, ${b}, 1)`;
                        context.stroke();
                    }

                    this.data = context.getImageData(0, 0, this.width, this.height).data;
                    map.triggerRepaint();
                    return true;
                }
            };
        }

        // 1. SONAR (Tsunami): Merah, Ripple, 2 detik
        map.addImage('pulsing-dot-sonar', createPulsingDot('sonar', 150, 211, 47, 47, 2000), { pixelRatio: 2 });
        
        // 2. FAST (Severe): Merah, Dot Cepat, 1 detik
        map.addImage('pulsing-dot-fast', createPulsingDot('dot', 100, 229, 57, 53, 1000), { pixelRatio: 2 });
        
        // 3. SLOW (Moderate): Kuning/Oranye, Dot Lambat, 2.5 detik
        map.addImage('pulsing-dot-slow', createPulsingDot('dot', 100, 255, 193, 7, 2500), { pixelRatio: 2 });
        

        // --- INISIALISASI LEGENDA ---
        legendManager.init(map);

        // Kontrol Kustom Gempa
        class GempaControl {
            onAdd(map) {
                this._map = map;
                this._container = document.createElement('div');
                this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                this._btn = document.createElement('button');
                this._btn.type = 'button';
                this._btn.title = 'Mode Gempa Bumi';
                this._btn.className = 'maplibregl-ctrl-gempa';
                this._btn.innerHTML = `<i class="wi wi-earthquake" style="font-size:18px; margin-top:4px;"></i>`;
                
                this._isActive = false;
                
                this._btn.onclick = () => {
                    this._isActive = !this._isActive;
                    if (this._isActive) {
                        this._btn.classList.add('active-mode');
                        mapManager.toggleGempaLayer(true);
                        // [FIX ISSUE 1] Tampilkan Legenda
                        legendManager.toggle(true); 
                    } else {
                        this._btn.classList.remove('active-mode');
                        mapManager.toggleGempaLayer(false);
                        // [FIX ISSUE 1] SEMBUNYIKAN Legenda
                        legendManager.toggle(false); 
                    }
                };
                
                this._container.appendChild(this._btn);
                return this._container;
            }
            onRemove() {
                this._container.parentNode.removeChild(this._container);
                this._map = undefined;
            }
        }

        map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
        map.addControl(new ResetPitchControl(), 'bottom-right');
        // Tambahkan Tombol Gempa
        map.addControl(new GempaControl(), 'bottom-right');
        map.addControl(new maplibregl.ScaleControl());
        
        map.on('data', (e) => {
            if (e.sourceId === 'data-cuaca-source' && e.isSourceLoaded) {
                // Listener untuk source lama (GeoJSON) jika masih digunakan untuk search/highlight tertentu
                // Tapi untuk render utama marker sudah via renderMarkers()
                mapManager.fetchDataForVisibleMarkers(); 
            }
        });

        // Trigger render manual pertama kali
        mapManager.renderMarkers();
        mapManager.triggerFetchData();

        const allInteractiveLayers = [ 'cluster-background-layer', 'unclustered-point-hit-target', 'provinsi-point-hit-target' ];
        
        map.on('click', (e) => {
            let features = [];
            try {
                features = map.queryRenderedFeatures(e.point, { layers: allInteractiveLayers });
            } catch (err) {
                console.warn("Query feature failed:", err);
                return;
            }

            // Logika klik di kanvas kosong
            if (sidebarManager.isOpen() && !features.length) { 
                const sidebarClicked = e.originalEvent.target.closest('#detail-sidebar');
                const popupClicked = e.originalEvent.target.closest('.maplibregl-popup');
                const controlClicked = e.originalEvent.target.closest('.maplibregl-ctrl') || e.originalEvent.target.closest('.maplibregl-ctrl-group');
                const toggleClicked = e.originalEvent.target.closest('#sidebar-toggle-btn');
                const pickerClicked = e.originalEvent.target.closest('#datetime-picker-container');
                const calendarClicked = e.originalEvent.target.closest('#calendar-popup');
                const searchClicked = e.originalEvent.target.closest('#search-wrapper'); 
                const markerClicked = e.originalEvent.target.closest('.marker-container'); 

                // Tambahkan pengecekan klik di marker gempa agar sidebar tidak tertutup instan
                const gempaLayerClicked = map.queryRenderedFeatures(e.point, { layers: ['gempa-point-layer', 'gempa-pulse-layer'] }).length > 0;

                if (!sidebarClicked && !popupClicked && !controlClicked && !toggleClicked && !pickerClicked && !calendarClicked && !searchClicked && !markerClicked) {
                    sidebarManager.closeSidebar(); 
                }
            }

            if (!features.length) { 
                // [CATATAN] Jangan tutup popup gempa di sini, biarkan ditangani map_manager
                // popupManager.close(); 
                return;
            }

            const feature = features[0];
            const layerId = feature.layer.id;
            const props = feature.properties;
            const coordinates = feature.geometry.coordinates.slice();

            if (layerId === 'cluster-background-layer') { 
                mapManager.handleClusterClick(feature, coordinates); 
            }
            else if (layerId === 'provinsi-point-hit-target') { 
                mapManager.handleProvinceClick(props, coordinates); 
            }
            else if (layerId === 'unclustered-point-hit-target') {
                // Fallback untuk klik pada layer hit target invisible
                // (Walaupun biasanya klik ditangkap oleh HTML marker itu sendiri)
                const dataUntukHandler = { 
                    id: feature.id, 
                    nama_simpel: props.nama_simpel, 
                    nama_label: props.nama_label, 
                    lat: coordinates[1], 
                    lon: coordinates[0],
                    tipadm: props.tipadm 
                };
                mapManager.handleUnclusteredClick(dataUntukHandler);
            }
        }); 
        
        // Hover pointer & Info koordinat
        map.on('mousemove', (e) => { 
            try {
                const features = map.queryRenderedFeatures(e.point, { layers: allInteractiveLayers });
                map.getCanvas().style.cursor = features.length ? 'pointer' : '';
            } catch(err) {
            }
        });
        
        const infoKoordinat = document.getElementById('koordinat-info'); 
        infoKoordinat.innerHTML = 'Geser kursor di atas peta'; 
        map.on('mousemove', (e) => { 
                infoKoordinat.innerHTML = `Latitude: ${e.lngLat.lat.toFixed(5)} | Longitude: ${e.lngLat.lng.toFixed(5)}`;
        });
        map.on('mouseout', () => { 
                infoKoordinat.innerHTML = 'Geser kursor di atas peta';
        });

    }); 
});