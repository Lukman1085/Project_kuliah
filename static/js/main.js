// ================================================================
// 1. IMPORT EKSTERNAL
// ================================================================
import { mapManager } from './map_manager.js';
import { sidebarManager } from './sidebar_manager.js';
import { timeManager } from './time_manager.js';
import { popupManager } from "./popup_manager.js";
import { utils, WMO_CODE_MAP } from './utilities.js';
import { getMapStyle } from './map_style.js';
import { ResetPitchControl } from './reset_pitch_ctrl.js';
import { calendarManager } from './calender_manager.js';
import { searchBarManager } from './searchbar.js';
import { legendManager } from './legend_manager.js'; 

// ================================================================
// 2. KONFIGURASI & STATE GLOBAL
// ================================================================

// Gunakan API relatif agar kompatibel dengan Vercel/Local
const protocol = window.location.protocol;
const hostname = window.location.hostname;
const port = window.location.port ? `:${window.location.port}` : '';
const baseUrl = `${protocol}//${hostname}${port}`;

let map; 
let searchDebounceTimer; 

// ================================================================
// 3. TITIK MASUK APLIKASI (APPLICATION ENTRYPOINT)
// ================================================================
document.addEventListener('DOMContentLoaded', function() {

    // [BARU] Inisialisasi Protokol PMTiles sebelum Map dimuat
    if (window.pmtiles) {
        let protocol = new pmtiles.Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
        console.log("✅ PMTiles Protocol Registered");
    } else {
        console.error("❌ PMTiles library not found!");
    }

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
    // [BARU] Header untuk interaksi Toggle
    const sidebarHeader = document.getElementById('sidebar-header');
    
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
        subRegionContainerEl, subRegionTitleEl, subRegionLoadingEl, subRegionListEl
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

    sidebarManager.setMapManager(mapManager);
    mapManager.setSidebarManager(sidebarManager);
    console.log("✅ DEPENDENCY INJECTION: Map <-> Sidebar connected.");

    // ================================================================
    // 3. Logika Inisialisasi Awal
    // ================================================================
    // Menggunakan API relatif ke root domain (handle Vercel/Local auto)
    fetch(`${baseUrl}/api/wmo-codes`)
        .then(res => res.ok ? res.json() : Promise.reject(`Error ${res.status}`))
        .then(data => { Object.assign(WMO_CODE_MAP, data); })
        .catch(e => console.error("Gagal memuat WMO codes:", e));

    timeManager.init();
    
    // ================================================================
    // 4. Pasang Event Listener
    // ================================================================

    // [BARU] INTERAKSI KLIK HEADER UNTUK TOGGLE PEEKING/EXPANDED
    sidebarHeader.addEventListener('click', (e) => {
        // Jangan trigger jika klik tombol close atau tombol fly-to
        if (e.target.closest('#close-sidebar-btn') || e.target.closest('.sidebar-fly-btn')) return;

        // [GUARD BARU] Jangan lakukan toggle jika baru saja selesai swipe
        // Ini mencegah "double action" (swipe selesai -> trigger click -> toggle)
        if (sidebarHeader.dataset.swiping === "true") return;

        // Cek apakah sidebar sedang dalam mode peeking
        if (sidebarEl.classList.contains('sidebar-peeking')) {
            // Jika ya, Expand
            sidebarManager.setMobilePeekingState(false);
        } else {
            // Jika Expanded, Collapse ke Peeking
            if (sidebarManager.isOpen()) {
                 sidebarManager.setMobilePeekingState(true);
            }
        }
    });

    // [MULAI] LOGIKA GESTURE SWIPE (KHUSUS MOBILE - BOTTOM SHEET - 3 STATES - REVISED) 
    // -------------------------------------------------------------
    (function initMobileSwipeGesture() {
        // State Variables
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        let hasMoved = false; // [BARU] Penanda apakah jari benar-benar bergerak
        const SWIPE_THRESHOLD = 80; // Jarak geser minimal agar bereaksi snap
        const MOVE_DEADZONE = 10;   // [BARU] Toleransi getaran jari (pixel)

        // Helper: Cek apakah mode mobile
        function isMobile() { return window.innerWidth <= 768; }

        const startEvents = ['touchstart', 'mousedown'];
        const moveEvents = ['touchmove', 'mousemove'];
        const endEvents = ['touchend', 'mouseup', 'mouseleave'];

        // Pasang listener
        [sidebarEl, toggleBtnEl].forEach(el => {
            startEvents.forEach(evt => el.addEventListener(evt, handleStart, { passive: false }));
        });
        moveEvents.forEach(evt => document.addEventListener(evt, handleMove, { passive: false }));
        endEvents.forEach(evt => document.addEventListener(evt, handleEnd, { passive: false }));

        function handleStart(e) {
            // 1. PENTING: Jika bukan Mobile, HENTIKAN proses gesture
            if (!isMobile()) return;

            // [PERBAIKAN] EXCLUSION GUARD: 
            // Jangan mulai swipe jika user menekan tombol interaktif (Button/Input),
            // KECUALI tombol toggle utama (#sidebar-toggle-btn) yang memang didesain untuk ditarik.
            
            const targetEl = e.target;
            const isButton = targetEl.closest('button');
            const isInput = targetEl.closest('input');
            const isToggleBtn = targetEl.closest('#sidebar-toggle-btn');

            // Jika (Input) ATAU (Tombol TAPI BUKAN Toggle Utama) -> Batalkan swipe
            if (isInput || (isButton && !isToggleBtn)) {
                return;
            }

            if (e.type === 'mousedown' && e.button !== 0) return;
            
            // Cek konflik scroll: Jangan geser jika user sedang scroll konten sidebar ke bawah
            // Pengecualian: Jika sedang PEEKING, konten tidak bisa discroll, jadi gesture valid
            const isPeeking = sidebarEl.classList.contains('sidebar-peeking');
            
            if (!isPeeking && sidebarEl.contains(e.target) && sidebarContentEl.contains(e.target)) {
                if (sidebarContentEl.scrollTop > 0) return; 
            }

            isDragging = true;
            hasMoved = false; // Reset status gerakan
            sidebarEl.style.transition = 'none'; // Matikan animasi agar responsif mengikuti jari

            if (e.type === 'touchstart') {
                startY = e.touches[0].clientY;
            } else {
                startY = e.clientY;
            }
        }

        function handleMove(e) {
            if (!isDragging) return;

            let clientY;
            if (e.type === 'touchmove') {
                clientY = e.touches[0].clientY;
            } else {
                e.preventDefault(); 
                clientY = e.clientY;
            }

            const diffY = clientY - startY;

            // [BARU] DEADZONE CHECK
            // Jika gerakan belum melebihi deadzone, jangan lakukan apa-apa
            // Ini mencegah efek "bounce" saat user hanya ingin klik (tapi jari bergetar 1-2px)
            if (!hasMoved && Math.abs(diffY) < MOVE_DEADZONE) {
                return;
            }

            hasMoved = true; // Konfirmasi bahwa ini adalah swipe
            currentY = clientY;

            const isPeeking = sidebarEl.classList.contains('sidebar-peeking');

            // --- LOGIKA PERGERAKAN ---
            
            // A. Sidebar Tertutup -> Swipe ATAS (Buka)
            if (!sidebarManager.isOpen() && diffY < 0) {
                 // Tarik naik penuh
                 sidebarEl.style.transform = `translateY(calc(100% + ${diffY}px))`;
            }
            // B. Sidebar Peeking -> Swipe ATAS (Expand) atau BAWAH (Close)
            else if (isPeeking) {
                // Basis posisi peeking adalah calc(100% - 80px)
                // Kita tambahkan diffY ke posisi itu
                // Ini agak tricky dengan calc di JS, jadi kita simplifikasi visualnya
                // User menggeser dari posisi 'bawah'.
                
                // Visualisasi sederhana: Geser elemen
                 sidebarEl.style.transform = `translateY(calc(100% - 80px + ${diffY}px))`;
            }
            // C. Sidebar Expanded -> Swipe BAWAH (Peeking/Close)
            else if (sidebarManager.isOpen() && !isPeeking && diffY > 0) {
                 sidebarEl.style.transform = `translateY(${diffY}px)`;
            }
        }

        function handleEnd(e) {
            if (!isDragging) return;
            isDragging = false;
            
            // Kembalikan transisi halus CSS
            sidebarEl.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)'; 
            sidebarEl.style.transform = ''; // Hapus style inline, biarkan Class CSS ambil alih

            // [BARU] JIKA TIDAK ADA GERAKAN SIGNIFIKAN, BERHENTI DI SINI
            // Biarkan browser menangani ini sebagai event 'click' biasa
            if (!hasMoved) {
                return;
            }

            // [BARU] CLICK-THROUGH GUARD
            // Jika user benar-benar swipe, pasang bendera sementara di header
            // agar listener klik header tidak terpicu
            sidebarHeader.dataset.swiping = "true";
            setTimeout(() => { delete sidebarHeader.dataset.swiping; }, 100);

            const diffY = currentY - startY;
            const isOpen = sidebarManager.isOpen();
            const isPeeking = sidebarEl.classList.contains('sidebar-peeking');

            // --- LOGIKA KEPUTUSAN 3-STATE ---

            if (!isOpen) {
                // Dari Tertutup
                if (diffY < -SWIPE_THRESHOLD) {
                     // Buka Penuh (Standard)
                     sidebarManager.openSidebar();
                }
            } else if (isPeeking) {
                // Dari Peeking
                if (diffY < -SWIPE_THRESHOLD) {
                    // Geser ATAS -> EXPAND
                    sidebarManager.setMobilePeekingState(false);
                } else if (diffY > SWIPE_THRESHOLD) {
                    // Geser BAWAH -> CLOSE
                    sidebarManager.closeSidebar();
                }
            } else {
                // Dari Expanded
                if (diffY > SWIPE_THRESHOLD) {
                    // Geser BAWAH -> PEEKING
                    sidebarManager.setMobilePeekingState(true);
                }
            }
            
            // Reset Variable
            startY = 0; currentY = 0;
        }
    })();
    // [AKHIR] LOGIKA GESTURE SWIPE

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

    document.addEventListener('requestSidebarDetail', () => { sidebarManager.openSidebarFromPopup(); });
    document.addEventListener('requestSidebarOpen', () => { if (!sidebarManager.isOpen()) { sidebarManager.openSidebar(); } });
    
    document.addEventListener('requestSidebarGempa', (e) => {
        popupManager.close(true);
        if (!sidebarManager.isOpen()) sidebarManager.openSidebar();
        if (e.detail && e.detail.gempaData) {
            sidebarManager.renderSidebarGempa(e.detail.gempaData);
        }
    });

    // ================================================================
    // 5. Inisialisasi Peta & Event Peta
    // ================================================================

    const dynamicStyle = getMapStyle();
    
    map = new maplibregl.Map({ 
        container: 'map',
        style: dynamicStyle,
        center: [118.0149, -2.5489], 
        zoom: 4.5, 
        minZoom: 4, 
        maxZoom: 14,
        maxBounds: [[90, -15], [145, 10]]
    });

    mapManager.setMap(map);

    map.on('load', () => {
        // [PENTING] Memastikan Iconset tersedia
        // utils.preloadMarkerAssets(map).then(() => {
        //     console.log("Marker Assets Loaded");
        //     mapManager.triggerFetchData(); // Pemicu awal data
        //     mapManager.renderMarkers();
        // });

        // Add Basemap Label Overlay
        map.addSource('cartodb-labels', { type: 'raster', tiles: ['https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'], tileSize: 256 });
        map.addLayer({ id: 'cartodb-labels-layer', type: 'raster', source: 'cartodb-labels', minzoom: 7 });

        // --- FACTORY ANIMASI (SONAR & PULSE) ---
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
                        context.beginPath();
                        context.arc(centerX, centerY, 8, 0, Math.PI * 2);
                        context.fillStyle = `rgba(${r}, ${g}, ${b}, 1)`;
                        context.fill();
                        context.strokeStyle = '#ffffff';
                        context.lineWidth = 2;
                        context.stroke();

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

        map.addImage('pulsing-dot-sonar', createPulsingDot('sonar', 150, 211, 47, 47, 2000), { pixelRatio: 2 });
        map.addImage('pulsing-dot-fast', createPulsingDot('dot', 100, 229, 57, 53, 1000), { pixelRatio: 2 });
        map.addImage('pulsing-dot-slow', createPulsingDot('dot', 100, 255, 193, 7, 2500), { pixelRatio: 2 });

        legendManager.init(map);

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
                        legendManager.toggle(true); 
                        sidebarManager.switchToMode('gempa');
                        searchBarManager.setDisabledState(true);
                        timeManager.setDisabledState(true);
                        const indicator = document.getElementById('mode-status-indicator');
                        if (indicator) indicator.style.display = 'flex';
                    } else {
                        this._btn.classList.remove('active-mode');
                        mapManager.toggleGempaLayer(false);
                        legendManager.toggle(false); 
                        sidebarManager.switchToMode('weather');
                        searchBarManager.setDisabledState(false);
                        timeManager.setDisabledState(false);
                        const indicator = document.getElementById('mode-status-indicator');
                        if (indicator) indicator.style.display = 'none';
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
        map.addControl(new GempaControl(), 'bottom-right');
        map.addControl(new maplibregl.ScaleControl());
        
        map.on('data', (e) => {
            if (e.sourceId === 'data-cuaca-source' && e.isSourceLoaded) {
                mapManager.fetchDataForVisibleMarkers(); 
            }
        });

        mapManager.triggerFetchData(); // Pemicu awal data
        mapManager.renderMarkers();

        // Event Listeners Map
        const allInteractiveLayers = [ 'cluster-background-layer', 'unclustered-point-hit-target', 'provinsi-point-hit-target' ];
        
        map.on('click', (e) => {
            let features = [];
            try {
                features = map.queryRenderedFeatures(e.point, { layers: allInteractiveLayers });
            } catch (err) { return; }

            if (sidebarManager.isOpen() && !features.length) { 
                const sidebarClicked = e.originalEvent.target.closest('#detail-sidebar');
                const popupClicked = e.originalEvent.target.closest('.maplibregl-popup');
                const controlClicked = e.originalEvent.target.closest('.maplibregl-ctrl') || e.originalEvent.target.closest('.maplibregl-ctrl-group');
                const toggleClicked = e.originalEvent.target.closest('#sidebar-toggle-btn');
                const pickerClicked = e.originalEvent.target.closest('#datetime-picker-container');
                const calendarClicked = e.originalEvent.target.closest('#calendar-popup');
                const searchClicked = e.originalEvent.target.closest('#search-wrapper'); 
                const markerClicked = e.originalEvent.target.closest('.marker-container'); 
                const gempaLayerClicked = map.queryRenderedFeatures(e.point, { layers: ['gempa-point-layer', 'gempa-pulse-layer'] }).length > 0;

                if (!sidebarClicked && !popupClicked && !controlClicked && !toggleClicked && !pickerClicked && !calendarClicked && !searchClicked && !markerClicked && !gempaLayerClicked) {
                    sidebarManager.closeSidebar(); 
                }
            }

            if (!features.length) return;

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
        
        map.on('mousemove', (e) => { 
            try {
                const features = map.queryRenderedFeatures(e.point, { layers: allInteractiveLayers });
                map.getCanvas().style.cursor = features.length ? 'pointer' : '';
            } catch(err) {}
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