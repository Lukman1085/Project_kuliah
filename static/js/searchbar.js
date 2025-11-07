// Tunggu sampai semua elemen HTML dimuat
document.addEventListener('DOMContentLoaded', () => {

    // --- DATA CONTOH ---
    // Ganti ini dengan data dari API Anda nanti
    const daftarLokasi = [
        "Jakarta", "Jayapura", "Surabaya", "Bandung", "Medan", 
        "Semarang", "Makassar", "Palembang", "Denpasar", "Banjarmasin"
    ];

    // Ambil elemen-elemen yang kita butuhkan
    const searchInput = document.getElementById('search-bar'); // ID dari HTML Anda
    const suggestionsDropdown = document.getElementById('suggestions-dropdown'); // ID baru

    // Event listener saat pengguna mengetik
    searchInput.addEventListener('input', function() {
        const inputText = this.value.toLowerCase();
        suggestionsDropdown.innerHTML = ''; // Bersihkan hasil lama

        if (inputText.length === 0) {
            suggestionsDropdown.style.display = 'none';
            return;
        }

        // Filter data
        const hasilFilter = daftarLokasi.filter(lokasi => 
            lokasi.toLowerCase().startsWith(inputText)
        );

        // Tampilkan hasil
        if (hasilFilter.length > 0) {
            hasilFilter.forEach(lokasi => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.textContent = lokasi;

                // Event saat item di-klik
                item.addEventListener('click', () => {
                    searchInput.value = lokasi;
                    suggestionsDropdown.style.display = 'none';
                    // Panggil fungsi pencarian Anda di sini
                    // console.log('Mencari cuaca untuk: ' + lokasi);
                });
                
                suggestionsDropdown.appendChild(item);
            });

            suggestionsDropdown.style.display = 'block';
        } else {
            suggestionsDropdown.style.display = 'none';
        }
    });

    // Sembunyikan dropdown jika klik di luar
    document.addEventListener('click', function(e) {
        // Jika yang diklik BUKAN di dalam #search-wrapper
        if (!document.getElementById('search-wrapper').contains(e.target)) {
            suggestionsDropdown.style.display = 'none';
        }
    });

});