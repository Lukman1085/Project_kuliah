import { sidebarManager } from "./sidebar_manager.js";
import { mapManager } from "./map_manager.js";

/** 剥 Mengelola semua logika untuk search bar */
export const searchBarManager = {
    elements: {}, 
    results: [], 
    selectedIndex: -1,
    _originalPlaceholder: "Cari lokasi...", // [BARU] Simpan placeholder asli

    init: function(elements) {
        this.elements = elements;
        console.log("Elemen DOM SearchBar telah di-set.");
        
        if (this.elements.searchInput) {
            // Listener Keyboard
            this.elements.searchInput.addEventListener('keydown', this.handleKeyDown.bind(this));
            
            // Listener Input (Untuk reset saat kosong)
            this.elements.searchInput.addEventListener('input', (e) => {
                if (e.target.value.length < 3) {
                    this.closeDropdown();
                }
            });

            // Listener Blur (Untuk reset saat klik luar)
            this.elements.searchInput.addEventListener('blur', () => {
                // Beri delay kecil agar klik pada item dropdown sempat tereksekusi
                setTimeout(() => {
                    this.closeDropdown();
                }, 200);
            });
        }
    },

    /**
     * [FITUR BARU] Mengatur status aktif/non-aktif search bar (Lockdown Mode).
     * @param {boolean} isDisabled - True untuk mengunci, False untuk membuka.
     */
    setDisabledState: function(isDisabled) {
        const { searchInput } = this.elements;
        // Kita ambil wrapper langsung dari DOM karena statis
        const wrapper = document.getElementById('search-wrapper'); 

        if (!searchInput || !wrapper) return;

        if (isDisabled) {
            // LOCKDOWN: Matikan input, ganti visual, tutup dropdown
            searchInput.disabled = true;
            // Simpan placeholder lama jika belum tersimpan default
            const currentPh = searchInput.getAttribute('placeholder');
            if (currentPh && currentPh !== "Mode Gempa Aktif") {
                this._originalPlaceholder = currentPh;
            }
            searchInput.setAttribute('placeholder', "Mode Gempa Aktif");
            wrapper.classList.add('search-disabled');
            this.closeDropdown(); 
        } else {
            // RESTORE: Hidupkan input, kembalikan visual
            searchInput.disabled = false;
            searchInput.setAttribute('placeholder', this._originalPlaceholder);
            wrapper.classList.remove('search-disabled');
        }
    },

    handleSuggestionClick: function(lokasi) {
        const { searchInput, suggestionsDropdown } = this.elements;
        const map = mapManager.getMap();

        if (!map) {
            console.error("Map belum siap saat handleSuggestionClick dipanggil.");
            return;
        }

        if (searchInput) {
            searchInput.value = lokasi.nama_label; 
            // Jangan blur di sini agar UX tetap fluid, atau blur jika ingin menutup keyboard mobile
             searchInput.blur(); 
        }
        
        this.closeDropdown(); 

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
            tipadm: lokasi.tipadm 
        };
        
        setTimeout(() => {
                mapManager.handleUnclusteredClick(props);
                
                if (!sidebarManager.isOpen() && sidebarManager) {
                    console.log("Search click: Meminta sidebar dibuka.");
                    document.dispatchEvent(new CustomEvent('requestSidebarOpen'));
                }
        }, 700); 
    },

    renderSuggestions: function(results) {
        const { suggestionsDropdown } = this.elements;
        if (!suggestionsDropdown) return;

        this.results = results || []; 
        this.selectedIndex = -1; 

        suggestionsDropdown.innerHTML = '';
        
        if (!results) {
            this.closeDropdown();
            return;
        }

        if (results.length === 0) {
            suggestionsDropdown.innerHTML = '<div class="suggestion-item-none">Lokasi tidak ditemukan</div>';
            this.openDropdown();
            return;
        }

        results.forEach((lokasi, index) => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.id = `suggestion-item-${index}`;
            
            const iconSvg = `
                <svg class="suggestion-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
            `;

            // === LOGIKA SMART LABEL ===
            const mainText = lokasi.nama_simpel || lokasi.nama_label;
            let subText = lokasi.nama_label || "";

            // Regex untuk menghapus "Kec. [Nama], " atau "Kel. [Nama], " hanya di awal string subText
            // Gunakan flag 'i' untuk case-insensitive jika perlu
            try {
                // Escape karakter spesial regex di mainText (jika ada titik dsb)
                const escapedMain = mainText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                // Regex: Cari "Kec. MainText, " atau "Kel. MainText, " atau "MainText, " di awal string
                // Kita hapus hanya kejadian PERTAMA (tidak pakai flag 'g')
                const regex = new RegExp(`^(?:(?:Kec\\.|Kel\\.|Kab\\.|Kota)\\s+)?${escapedMain}(?:\\s+Adm\\.)?,\\s*`, 'i');
                
                if (regex.test(subText)) {
                    subText = subText.replace(regex, '');
                } else if (subText === mainText) {
                    // Jika sama persis (misal level provinsi), subtext bisa dikosongkan atau diisi negara
                    subText = "Indonesia";
                }
            } catch (e) {
                console.warn("Regex error formatting label:", e);
                // Fallback sederhana
                if (subText.startsWith(mainText)) {
                     subText = subText.substring(mainText.length).replace(/^,\s*/, '');
                }
            }
            
            if (!subText) subText = "Indonesia"; 

            item.innerHTML = `
                ${iconSvg}
                <div class="suggestion-text">
                    <span class="suggestion-main-text">${mainText}</span>
                    <span class="suggestion-sub-text">${subText}</span>
                </div>
            `;
            
            item.addEventListener('click', () => {
                this.handleSuggestionClick(lokasi); 
            });
            
            item.addEventListener('mouseover', () => {
                this.selectedIndex = index;
                this.updateSelectionVisual();
            });

            suggestionsDropdown.appendChild(item);
        });
        
        this.openDropdown();
    },

    fetchLokasi: async function(query) {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = '5000';
        const baseUrl = `${protocol}//${hostname}:${port}`;

        const { suggestionsDropdown } = this.elements;

        try {
            const resp = await fetch(`${baseUrl}/api/cari-lokasi?q=${encodeURIComponent(query)}`);
            if (!resp.ok) throw new Error('Network response was not ok');
            const results = await resp.json();
            this.renderSuggestions(results); 
        } catch (e) {
            console.error("Search fetch error:", e);
            if (suggestionsDropdown) {
                suggestionsDropdown.innerHTML = '<div class="suggestion-item-error">Gagal memuat hasil</div>';
                this.openDropdown();
            }
        }
    },

    openDropdown: function() {
        const { suggestionsDropdown } = this.elements;
        const wrapper = document.getElementById('search-wrapper');
        if (suggestionsDropdown) suggestionsDropdown.style.display = 'block';
        if (wrapper) wrapper.classList.add('search-active');
    },

    closeDropdown: function() {
        const { suggestionsDropdown } = this.elements;
        const wrapper = document.getElementById('search-wrapper');
        if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
        if (wrapper) wrapper.classList.remove('search-active');
        this.selectedIndex = -1;
    },

    handleKeyDown: function(e) {
        if (!this.results || this.results.length === 0) return;
        const { suggestionsDropdown } = this.elements;
        if (suggestionsDropdown.style.display === 'none') return;

        if (e.key === 'ArrowDown') {
            e.preventDefault(); 
            this.selectedIndex++;
            if (this.selectedIndex >= this.results.length) {
                this.selectedIndex = 0; 
            }
            this.updateSelectionVisual();
            this.scrollToSelected();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectedIndex--;
            if (this.selectedIndex < -1) {
                this.selectedIndex = this.results.length - 1; 
            }
            this.updateSelectionVisual();
            this.scrollToSelected();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.selectedIndex >= 0 && this.selectedIndex < this.results.length) {
                this.handleSuggestionClick(this.results[this.selectedIndex]);
            }
        } else if (e.key === 'Escape') {
            this.closeDropdown();
            this.elements.searchInput.blur();
        }
    },

    updateSelectionVisual: function() {
        const items = document.querySelectorAll('.suggestion-item');
        items.forEach((item, index) => {
            if (index === this.selectedIndex) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    },

    scrollToSelected: function() {
        if (this.selectedIndex === -1) return;
        const item = document.getElementById(`suggestion-item-${this.selectedIndex}`);
        if (item) {
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
};