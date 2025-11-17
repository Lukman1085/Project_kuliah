import { sidebarManager } from "./sidebar_manager.js";
import { mapManager } from "./map_manager.js";

/** 🔍 Mengelola semua logika untuk search bar */
export const searchBarManager = {
    elements: {}, // Untuk menyimpan { searchInput, suggestionsDropdown }

    /**
     * Dipanggil oleh main.js untuk 'menyuntikkan' elemen DOM
     * @param {object} elements - Objek berisi { searchInput, suggestionsDropdown }
     */
    init: function(elements) {
        this.elements = elements;
        console.log("Elemen DOM SearchBar telah di-set.");
    },

    /** 🔍 Aksi yang terjadi saat hasil pencarian di-klik */
    handleSuggestionClick: function(lokasi) {
        // Ambil elemen dari 'this.elements'
        const { searchInput, suggestionsDropdown } = this.elements;
        // Ambil map dari mapManager
        const map = mapManager.getMap();

        if (!map) {
            console.error("Map belum siap saat handleSuggestionClick dipanggil.");
            return;
        }

        if (searchInput) searchInput.value = ''; 
        if (suggestionsDropdown) {
            suggestionsDropdown.innerHTML = '';
            suggestionsDropdown.style.display = 'none';
        }
        if (searchInput) searchInput.blur(); 

        let zoom = 10; 
        const tipadm = parseInt(lokasi.tipadm, 10);
        if (tipadm === 1) { zoom = 7; }       
        else if (tipadm === 2) { zoom = 9; } 
        else if (tipadm === 3) { zoom = 11; } 
        else if (tipadm === 4) { zoom = 14; } 
        
        console.log(`Search click: ${lokasi.nama_label} (TIPADM: ${tipadm}), zooming to ${zoom}`);

        map.easeTo({
            center: [lokasi.lon, lokasi.lat],
            zoom: zoom
        });

        const props = {
            id: lokasi.id,
            nama_simpel: lokasi.nama_simpel,
            nama_label: lokasi.nama_label,
            lat: lokasi.lat,
            lon: lokasi.lon,
            tipadm: lokasi.tipadm // <-- MODIFIKASI: Tambahkan tipadm
        };
        
        setTimeout(() => {
                mapManager.handleUnclusteredClick(props);
                
                // Event ini sudah di-decouple (terpisah), jadi ini sudah bagus
                if (!sidebarManager.isOpen() && sidebarManager) {
                    console.log("Search click: Meminta sidebar dibuka.");
                    document.dispatchEvent(new CustomEvent('requestSidebarOpen'));
                }
        }, 500); 
    },

    /** 🔍 Merender hasil pencarian ke dropdown */
    renderSuggestions: function(results) {
        const { suggestionsDropdown } = this.elements;
        if (!suggestionsDropdown) return;

        suggestionsDropdown.innerHTML = '';
        if (!results) {
            suggestionsDropdown.style.display = 'none';
            return;
        }
        if (results.length === 0) {
            suggestionsDropdown.innerHTML = '<div class="suggestion-item-none">Lokasi tidak ditemukan</div>';
            suggestionsDropdown.style.display = 'block';
            return;
        }
        results.forEach(lokasi => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.textContent = lokasi.nama_label; 
            item.dataset.id = lokasi.id;
            item.dataset.nama_simpel = lokasi.nama_simpel; 
            item.dataset.nama_label = lokasi.nama_label; 
            item.dataset.lat = lokasi.lat;
            item.dataset.lon = lokasi.lon;
            item.dataset.tipadm = lokasi.tipadm; 
            item.addEventListener('click', () => {
                this.handleSuggestionClick(lokasi); // Panggil metode internal
            });
            suggestionsDropdown.appendChild(item);
        });
        suggestionsDropdown.style.display = 'block';
    },

    /** 🔍 Mengambil data lokasi dari backend */
    fetchLokasi: async function(query) {
        // Definisikan baseUrl di sini karena fetchLokasi membutuhkannya
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = '5000';
        const baseUrl = `${protocol}//${hostname}:${port}`;

        const { suggestionsDropdown } = this.elements;

        try {
            const resp = await fetch(`${baseUrl}/api/cari-lokasi?q=${encodeURIComponent(query)}`);
            if (!resp.ok) throw new Error('Network response was not ok');
            const results = await resp.json();
            this.renderSuggestions(results); // Panggil metode internal
        } catch (e) {
            console.error("Search fetch error:", e);
            if (suggestionsDropdown) {
                suggestionsDropdown.innerHTML = '<div class="suggestion-item-error">Gagal memuat hasil</div>';
                suggestionsDropdown.style.display = 'block';
            }
        }
    }
};