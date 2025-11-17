import { sidebarManager } from "./sidebar_manager";
import { mapManager } from "./map_manager";

// --- FUNGSI-FUNGSI UNTUK SEARCH BAR ---
/** 🔍 Aksi yang terjadi saat hasil pencarian di-klik */
function handleSuggestionClick(lokasi) {
    searchInput.value = ''; 
    suggestionsDropdown.innerHTML = '';
    suggestionsDropdown.style.display = 'none';
    searchInput.blur(); 

    let zoom = 10; 
    const tipadm = parseInt(lokasi.tipadm, 10);
    if (tipadm === 1) { zoom = 7; }       
    else if (tipadm === 2) { zoom = 9; } 
    else if (tipadm === 3) { zoom = 11; } 
    else if (tipadm === 4) { zoom = 14; } 
    
    console.log(`Search click: ${lokasi.nama_label} (TIPADM: ${tipadm}), zooming to ${zoom}`);

    if (map) {
        map.easeTo({
            center: [lokasi.lon, lokasi.lat],
            zoom: zoom
        });
    }

    const props = {
        id: lokasi.id,
        nama_simpel: lokasi.nama_simpel,
        nama_label: lokasi.nama_label,
        lat: lokasi.lat,
        lon: lokasi.lon
    };
    
    if (mapManager) {
        setTimeout(() => {
                mapManager.handleUnclusteredClick(props);
                
                // --- REFAKTOR (Proyek 2.2) ---
                // Dekopling: Memancarkan event, alih-alih memanggil sidebarManager
                if (!sidebarManager.isOpen() && sidebarManager) {
                console.log("Search click: Meminta sidebar dibuka.");
                // sidebarManager.openSidebar(); // <-- Dihapus
                document.dispatchEvent(new CustomEvent('requestSidebarOpen'));
                }
                // --- Akhir Refaktor ---
        }, 500); 
    }
}

/** 🔍 Merender hasil pencarian ke dropdown */
function renderSuggestions(results) {
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
            handleSuggestionClick(lokasi);
        });
        suggestionsDropdown.appendChild(item);
    });
    suggestionsDropdown.style.display = 'block';
}

/** 🔍 Mengambil data lokasi dari backend */
export async function fetchLokasi(query) {
    try {
        const resp = await fetch(`${baseUrl}/api/cari-lokasi?q=${encodeURIComponent(query)}`);
        if (!resp.ok) throw new Error('Network response was not ok');
        const results = await resp.json();
        renderSuggestions(results);
    } catch (e) {
        console.error("Search fetch error:", e);
        suggestionsDropdown.innerHTML = '<div class="suggestion-item-error">Gagal memuat hasil</div>';
        suggestionsDropdown.style.display = 'block';
    }
}



