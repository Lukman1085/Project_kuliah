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
// [BARU] Import service Vercel
import { initVercelServices } from './vercel_services.js';

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

    // [BARU] Inisialisasi Vercel Analytics & Speed Insights
    // Panggil sedini mungkin saat DOM Ready
    initVercelServices();

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
    // Header untuk interaksi Toggle
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

    // [INTERAKSI 1] KLIK HEADER UNTUK TOGGLE PEEKING/EXPANDED
    sidebarHeader.addEventListener('click', (e) => {
        // Jangan trigger jika klik tombol close atau tombol fly-to
        if (e.target.closest('#close-sidebar-btn') || e.target.closest('.sidebar-fly-btn')) return;

        // Guard: Jangan lakukan toggle jika baru saja selesai swipe
        if (sidebarHeader.dataset.swiping === "true") return;

        // Cek apakah sidebar sedang dalam mode peeking
        if (sidebarEl.classList.contains('sidebar-peeking')) {
            // Jika ya, Expand
            sidebarManager.setMobilePeekingState(false);
        } else if (sidebarManager.isOpen()) {
            // Jika Expanded, Collapse ke Peeking
            sidebarManager.setMobilePeekingState(true);
        }
    });

    // [INTERAKSI 2 - FIX] LOGIKA KLIK HANDLE (PSEUDO-ELEMENT ::BEFORE) DENGAN DYNAMIC BOUNDARY
    sidebarEl.addEventListener('click', (e) => {
        // 1. Filter Target: Pastikan klik terjadi LANSUNG pada container #detail-sidebar
        // (Bukan pada judul, tombol, atau konten di dalamnya).
        // Klik pada ::before akan terbaca sebagai klik pada sidebarEl itu sendiri.
        if (e.target !== sidebarEl) return;
        if (!sidebarHeader) return; // Safety check

        // 2. Logika Batas Dinamis:
        // offsetTop header adalah jarak dari atas sidebar sampai ke header.
        // Area ini secara implisit mencakup tinggi ::before + margin/padding.
        const headerBoundary = sidebarHeader.offsetTop;

        // 3. Cek Posisi Klik (Hit Testing):
        // e.offsetY adalah posisi Y kursor relatif terhadap elemen target (sidebarEl).
        // Jika Y < headerBoundary, berarti klik terjadi di "ruang kosong" di atas header (Handle Area).
        if (e.offsetY < headerBoundary) {
            console.log("Handle Clicked (Detected above Header via Dynamic Boundary)");

            // Logika Toggle (Sama seperti header)
            if (sidebarEl.classList.contains('sidebar-peeking')) {
                sidebarManager.setMobilePeekingState(false); // Expand
            } else if (sidebarManager.isOpen()) {
                sidebarManager.setMobilePeekingState(true);  // Collapse to Peeking
            }
        }
    });

    // [MULAI] LOGIKA SWIPE FINAL (ANTI-UNDERFLOW & PIXEL PERFECT)
    // -------------------------------------------------------------
    (function initMobileSwipeGesture() {
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        const SWIPE_THRESHOLD = 80;

        // Helper
        function isMobile() { return window.innerWidth <= 768; }

        const startEvents = ['touchstart', 'mousedown'];
        const moveEvents = ['touchmove', 'mousemove'];
        const endEvents = ['touchend', 'mouseup', 'mouseleave'];

        // Event Listeners
        [sidebarEl, toggleBtnEl].forEach(el => {
            startEvents.forEach(evt => el.addEventListener(evt, handleStart, { passive: false }));
        });
        moveEvents.forEach(evt => document.addEventListener(evt, handleMove, { passive: false }));
        endEvents.forEach(evt => document.addEventListener(evt, handleEnd, { passive: false }));

        function handleStart(e) {
            if (!isMobile()) return;
            if (e.type === 'mousedown' && e.button !== 0) return;

            // Cek konflik scroll konten
            if (sidebarEl.contains(e.target) && sidebarContentEl.contains(e.target)) {
                if (sidebarContentEl.scrollTop > 0) return; 
            }

            isDragging = true;
            sidebarEl.style.transition = 'none'; // Matikan animasi

            if (e.type === 'touchstart') startY = e.touches[0].clientY;
            else startY = e.clientY;
        }

        function handleMove(e) {
            if (!isDragging) return;

            // Cegah map ikut gerak
            if (e.cancelable) e.preventDefault(); 
            e.stopPropagation();

            if (e.type === 'touchmove') currentY = e.touches[0].clientY;
            else currentY = e.clientY;

            const diffY = currentY - startY;
            
            // [LOGIKA BARU] MENGGUNAKAN PIXEL UNTUK CLAMPING
            // Ambil tinggi sidebar saat ini (misal: 600px)
            const sidebarHeight = sidebarEl.offsetHeight; 

            if (!sidebarManager.isOpen()) {
                // --- KASUS: MEMBUKA (SWIPE UP) ---
                // Start position secara visual adalah di 'sidebarHeight' (karena translateY 100%)
                // Kita ingin gerak menuju 0.
                
                // Rumus: Tinggi Asli + Pergerakan Jari (diffY negatif)
                let newPos = sidebarHeight + diffY;

                // CLAMPING (PENTING):
                // Jangan biarkan newPos kurang dari 0.
                // Jika < 0, paksa jadi 0. Ini mencegah sidebar terbang ke atas.
                if (newPos < 0) newPos = 0; 
                
                sidebarEl.style.transform = `translateY(${newPos}px)`;

            } else {
                // --- KASUS: MENUTUP (SWIPE DOWN) ---
                // Start position adalah 0.
                
                // Rumus: 0 + Pergerakan Jari (diffY positif)
                let newPos = diffY;

                // CLAMPING:
                // Jangan biarkan newPos kurang dari 0 (mencegah ditarik ke atas saat sudah terbuka)
                if (newPos < 0) {
                    // Efek Resistance (Kenyal) sangat sedikit jika dipaksa tarik ke atas
                    newPos = newPos * 0.1; 
                }
                
                sidebarEl.style.transform = `translateY(${newPos}px)`;
            }
        }

        function handleEnd(e) {
            if (!isDragging) return;
            isDragging = false;
            
            // Kembalikan animasi CSS
            sidebarEl.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)'; 
            sidebarEl.style.transform = ''; // Hapus style inline pixel tadi

            const diffY = currentY - startY;
            const isOpen = sidebarManager.isOpen();

            // Logika Keputusan (Threshold)
            if (diffY === 0) return;

            if (!isOpen) {
                // Jika geser ke ATAS cukup jauh -> BUKA
                if (diffY < -SWIPE_THRESHOLD) sidebarManager.openSidebar();
                // Jika tidak, CSS akan otomatis menariknya kembali ke bawah (karena transform dihapus)
            } else {
                // Jika geser ke BAWAH cukup jauh -> TUTUP
                if (diffY > SWIPE_THRESHOLD) {
                    if (sidebarContentEl.scrollTop <= 0) sidebarManager.closeSidebar();
                }
            }
            
            startY = 0; currentY = 0;
        }
    })();

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