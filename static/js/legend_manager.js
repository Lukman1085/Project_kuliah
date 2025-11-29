/** * 🗺️ LEGEND MANAGER 
 * Menampilkan panduan visual arti warna dan animasi gempa.
 */
export const legendManager = {
    _container: null,

    init: function(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'map-legend-container';
        // Hapus style.display = 'none' default, kita gunakan opacity/transform
        
        this._container.innerHTML = `
            <div class="legend-header">
                <span>Indikator Gempa</span>
                <button class="legend-close-btn" aria-label="Tutup">&times;</button>
            </div>
            <div class="legend-body">
                <!-- Level 1: Tsunami -->
                <div class="legend-item">
                    <div class="legend-icon-wrapper">
                        <div class="legend-sonar"></div>
                    </div>
                    <div class="legend-label">
                        <strong>Potensi Tsunami</strong>
                        <span>Evakuasi Segera</span>
                    </div>
                </div>
                
                <!-- Level 2: Kuat -->
                <div class="legend-item">
                    <div class="legend-icon-wrapper">
                        <div class="legend-dot red pulse-fast"></div>
                    </div>
                    <div class="legend-label">
                        <strong>Guncangan Kuat</strong>
                        <span>Merusak (MMI > VI)</span>
                    </div>
                </div>

                <!-- Level 3: Sedang -->
                <div class="legend-item">
                    <div class="legend-icon-wrapper">
                        <div class="legend-dot yellow pulse-slow"></div>
                    </div>
                    <div class="legend-label">
                        <strong>Terasa</strong>
                        <span>Benda bergoyang (MMI III-VI)</span>
                    </div>
                </div>

                <!-- Level 4: Lemah -->
                <div class="legend-item">
                    <div class="legend-icon-wrapper">
                        <div class="legend-dot blue"></div>
                    </div>
                    <div class="legend-label">
                        <strong>Lemah / Dalam</strong>
                        <span>Tidak terasa (MMI < III)</span>
                    </div>
                </div>
            </div>
        `;

        // Pasang ke dalam container peta (pojok kiri bawah, di atas scale)
        const mapContainer = map.getContainer();
        mapContainer.appendChild(this._container);

        // Event Listener Tutup
        this._container.querySelector('.legend-close-btn').addEventListener('click', () => {
            this.toggle(false);
        });
    },

    toggle: function(show) {
        if (this._container) {
            // Gunakan Class Toggle untuk Animasi CSS
            if (show) {
                // Sedikit delay agar transisi 'from none' bisa terdeteksi browser (opsional)
                requestAnimationFrame(() => {
                    this._container.classList.add('legend-visible');
                });
            } else {
                this._container.classList.remove('legend-visible');
            }
        }
    }
};