// ================================================================
// 1. IMPORT EKSTERNAL
// ================================================================
import { mapManager, inflightIds } from './map_manager.js';
import { sidebarManager } from './sidebar_manager.js';
import { timeManager } from './time_manager.js';
import { popupManager } from './popup_manager.js';
import { utils, WMO_CODE_MAP } from './utilities.js';
import { MAP_STYLE } from './map_style.js';
import { ResetPitchControl } from './reset_pitch_ctrl.js';
import { calendarManager } from './calender_manager.js';
import { fetchLokasi, } from './searchbar.js';

// ================================================================
// 2. KONFIGURASI & STATE GLOBAL
// ================================================================

const protocol = window.location.protocol;
const hostname = window.location.hostname;
const port = '5000';
const baseUrl = `${protocol}//${hostname}:${port}`;

// Variabel elemen UI
let sidebarEl, toggleBtnEl, closeBtnEl, sidebarContentEl, sidebarLocationNameEl;
let sidebarPlaceholderEl, sidebarLoadingEl, sidebarWeatherDetailsEl, sidebarProvinceDetailsEl;
let prevDayBtn, nextDayBtn, dateDisplay, calendarBtn, prevHourBtn, nextHourBtn, prevThreeHourBtn, nextThreeHourBtn, hourDisplay;
let calendarPopup, calendarGrid, calendarMonthYear, calendarPrevMonthBtn, calendarNextMonthBtn, loadingSpinner;
let map; 
let searchInput, suggestionsDropdown, searchDebounceTimer; 

// ================================================================
// 3. TITIK MASUK APLIKASI (APPLICATION ENTRYPOINT)
// ================================================================
document.addEventListener('DOMContentLoaded', function() {

    // ================================================================
    // 1. Ambil Elemen UI
    // ================================================================
    // (Tidak ada perubahan)
    sidebarEl = document.getElementById('detail-sidebar');
    toggleBtnEl = document.getElementById('sidebar-toggle-btn');
    closeBtnEl = document.getElementById('close-sidebar-btn');
    sidebarContentEl = document.getElementById('sidebar-content');
    sidebarLocationNameEl = document.getElementById('sidebar-location-name');
    sidebarPlaceholderEl = document.getElementById('sidebar-placeholder');
    sidebarLoadingEl = document.getElementById('sidebar-loading');
    sidebarWeatherDetailsEl = document.getElementById('sidebar-weather-details');
    sidebarProvinceDetailsEl = document.getElementById('sidebar-province-details');
    prevDayBtn = document.getElementById('prev-day-btn');
    nextDayBtn = document.getElementById('next-day-btn');
    dateDisplay = document.getElementById('date-display');
    calendarBtn = document.getElementById('calendar-btn');
    prevThreeHourBtn = document.getElementById('prev-three-hour-btn');
    prevHourBtn = document.getElementById('prev-hour-btn');
    nextHourBtn = document.getElementById('next-hour-btn');
    nextThreeHourBtn = document.getElementById('next-three-hour-btn');
    hourDisplay = document.getElementById('hour-display');
    calendarPopup = document.getElementById('calendar-popup');
    calendarGrid = document.getElementById('calendar-grid');
    calendarMonthYear = document.getElementById('calendar-month-year');
    loadingSpinner = document.getElementById('global-loading-spinner');
    calendarPrevMonthBtn = document.getElementById('calendar-prev-month'); 
    calendarNextMonthBtn = document.getElementById('calendar-next-month'); 
    searchInput = document.getElementById('search-bar');
    suggestionsDropdown = document.getElementById('suggestions-dropdown');

    sidebarManager._timeEl = document.getElementById('sidebar-current-time');
    sidebarManager._iconEl = document.getElementById('sidebar-current-icon');
    sidebarManager._tempEl = document.getElementById('sidebar-current-temp');
    sidebarManager._descEl = document.getElementById('sidebar-current-desc');
    sidebarManager._feelsLikeEl = document.getElementById('sidebar-current-feelslike');
    sidebarManager._humidityEl = document.getElementById('sidebar-current-humidity');
    sidebarManager._precipEl = document.getElementById('sidebar-current-precipitation');
    sidebarManager._windEl = document.getElementById('sidebar-current-wind');
    sidebarManager._dailyListEl = document.getElementById('sidebar-daily-forecast-list');
    
    // ================================================================
    // 2. Logika Inisialisasi Awal
    // ================================================================
    // (Tidak ada perubahan)
    fetch(`${baseUrl}/api/wmo-codes`)
        .then(res => res.ok ? res.json() : Promise.reject(`Error ${res.status}`))
        .then(data => { WMO_CODE_MAP = data; })
        .catch(e => console.error("Gagal memuat WMO codes:", e));

    timeManager.init(); // Fallback time picker tetap berfungsi
    
    // ================================================================
    // 3. Pasang Event Listener
    // ================================================================
    // (Tidak ada perubahan di listener tombol waktu)

    prevDayBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() - 24));
    nextDayBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() + 24));
    prevThreeHourBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() - 3));
    prevHourBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() - 1));
    nextHourBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() + 1));
    nextThreeHourBtn.addEventListener('click', () => timeManager.handleTimeChange(timeManager.getSelectedTimeIndex() + 3));
    
    // --- REFAKTOR (Rencana 3.2.2) ---
    // Menambahkan stopPropagation agar listener global tidak langsung menutupnya
    calendarBtn.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        calendarManager.toggleCalendar(); 
    });
    // --- Akhir Refaktor ---
    
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
        searchDebounceTimer = setTimeout(() => {
            fetchLokasi(query); 
        }, 350); 
    });
    searchInput.addEventListener('focus', () => {
        const query = searchInput.value;
        if (query.length >= 3) {
            fetchLokasi(query); 
        }
    });
    
    // --- REFAKTOR (Rencana 3.2.2) ---
    // Listener global untuk menutup dropdown pencarian DAN kalender
    document.addEventListener('click', function(e) {
        // Logika penutup search
        const wrapper = document.getElementById('search-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            suggestionsDropdown.style.display = 'none';
        }
        
        // Logika penutup kalender
        if (calendarPopup && calendarPopup.style.display === 'block') {
            // Jika klik BUKAN di dalam kalender DAN BUKAN di tombol kalender
            if (!calendarPopup.contains(e.target) && e.target !== calendarBtn) {
                calendarManager.toggleCalendar(); // Panggil toggle untuk menutup
            }
        }
    });
    // --- Akhir Refaktor ---
    
    document.getElementById('search-btn').addEventListener('click', () => {
        const query = searchInput.value;
        if (query.length < 3) {
            console.log("Kueri pencarian terlalu pendek untuk diklik");
            return;
        }
        clearTimeout(searchDebounceTimer);
        fetchLokasi(query);
        searchInput.focus();
    });

    // --- REFAKTOR (Proyek 2.2) ---
    // [BARU] Event listener terpusat (Pub/Sub) untuk dekopling
    document.addEventListener('requestSidebarDetail', () => {
        console.log("Event 'requestSidebarDetail' diterima.");
        sidebarManager.openSidebarFromPopup();
    });
    document.addEventListener('requestSidebarOpen', () => {
        console.log("Event 'requestSidebarOpen' diterima.");
        if (!sidebarManager.isOpen()) {
            sidebarManager.openSidebar();
        }
    });
    // --- Akhir Refaktor ---

    // ================================================================
    // 4. Inisialisasi Peta & Event Peta
    // ================================================================
    
    map = new maplibregl.Map({ 
        container: 'map',
        // --- REFAKTOR (Rencana 3.1) ---
        // Menggunakan konstanta global
        style: MAP_STYLE,
        // --- Akhir Refaktor ---
        center: [118.0149, -2.5489], zoom: 4.5, minZoom: 4, maxZoom: 14,
        maxBounds: [[90, -15], [145, 10]]
    });

    // --- Logika Peta on 'load' ---
    map.on('load', () => {
        map.addSource('cartodb-labels', { type: 'raster', tiles: ['https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'], tileSize: 256 });
        map.addLayer({ id: 'cartodb-labels-layer', type: 'raster', source: 'cartodb-labels', minzoom: 7 });

        map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
        map.addControl(new ResetPitchControl(), 'bottom-right');
        map.addControl(new maplibregl.ScaleControl());
        
        const perbaruiPetaDebounced = utils.debounce(mapManager.perbaruiPetaGeo.bind(mapManager), 700);
        map.on('moveend', perbaruiPetaDebounced);
        map.on('data', (e) => {
            if (e.sourceId === 'data-cuaca-source' && e.isSourceLoaded) {
                    mapManager.fetchDataForVisibleMarkers.bind(mapManager)();
            }
        });

        mapManager.perbaruiPetaGeo(); 

        // --- Handler Klik Peta ---
        const allInteractiveLayers = [ 'cluster-background-layer', 'unclustered-point-temp-circle', 'provinsi-point-circle' ];
        map.on('click', (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: allInteractiveLayers });

            // --- REFAKTOR (Rencana 3.2.1) ---
            // Logika ini DIBIARKAN seperti semula karena sudah kuat.
            // Ini menangani klik pada "kanvas peta kosong" untuk menutup sidebar.
            if (sidebarManager.isOpen() && !features.length) { 
                const sidebarClicked = e.originalEvent.target.closest('#detail-sidebar');
                const popupClicked = e.originalEvent.target.closest('.maplibregl-popup');
                const controlClicked = e.originalEvent.target.closest('.maplibregl-ctrl') || e.originalEvent.target.closest('.maplibregl-ctrl-group');
                const toggleClicked = e.originalEvent.target.closest('#sidebar-toggle-btn');
                const pickerClicked = e.originalEvent.target.closest('#datetime-picker-container');
                const calendarClicked = e.originalEvent.target.closest('#calendar-popup');
                const searchClicked = e.originalEvent.target.closest('#search-wrapper'); 

                // Jika klik BUKAN pada salah satu elemen UI ini, baru tutup.
                if (!sidebarClicked && !popupClicked && !controlClicked && !toggleClicked && !pickerClicked && !calendarClicked && !searchClicked) {
                    sidebarManager.closeSidebar(); 
                }
            }
            // --- Akhir Refaktor ---

            if (!features.length) { 
                popupManager.close();
                return;
            }

            const feature = features[0];
            const layerId = feature.layer.id;
            const props = feature.properties;
            const coordinates = feature.geometry.coordinates.slice();

            if (layerId === 'cluster-background-layer') { mapManager.handleClusterClick(feature, coordinates); }
            else if (layerId === 'provinsi-point-circle') { 
                mapManager.handleProvinceClick(props, coordinates); 
            }
            else if (layerId === 'unclustered-point-temp-circle') {
                const dataUntukHandler = { 
                    id: feature.id, 
                    nama_simpel: props.nama_simpel, 
                    nama_label: props.nama_label, 
                    lat: coordinates[1], 
                    lon: coordinates[0] 
                };
                mapManager.handleUnclusteredClick(dataUntukHandler);
            }
        }); 
        
        // Hover pointer & Info koordinat
        map.on('mousemove', (e) => { 
                const features = map.queryRenderedFeatures(e.point, { layers: allInteractiveLayers });
                map.getCanvas().style.cursor = features.length ? 'pointer' : '';
            });
        const infoKoordinat = document.getElementById('koordinat-info'); 
        infoKoordinat.innerHTML = 'Geser kursor di atas peta'; 
        map.on('mousemove', (e) => { 
                infoKoordinat.innerHTML = `Latitude: ${e.lngLat.lat.toFixed(5)} | Longitude: ${e.lngLat.lng.toFixed(5)}`;
            });
        map.on('mouseout', () => { 
                infoKoordinat.innerHTML = 'Geser kursor di atas peta';
            });

    }); // Akhir map.on('load')
}); // Akhir DOMContentLoaded
