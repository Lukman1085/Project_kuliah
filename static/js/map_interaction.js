/** 🖱️ MAP INTERACTION
 * Menangani semua event listener peta (Mouse, Touch, Click, Hover).
 * Bertugas sebagai "Indera Perasa" peta, melaporkan kejadian ke MapManager.
 */
export const MapInteraction = {
    _map: null,
    _callbacks: {}, // Tempat menyimpan fungsi lapor ke MapManager
    
    // State Internal untuk Hover Poligon
    _hoveredStateId: null,
    _hoveredSourceLayer: null,

    /**
     * Inisialisasi listener interaksi.
     * @param {object} mapInstance - Objek MapLibre
     * @param {object} callbacks - Daftar fungsi callback (onInteractStart, onInteractEnd, onGempaClick, shouldSkipHover)
     */
    init: function(mapInstance, callbacks) {
        this._map = mapInstance;
        this._callbacks = callbacks || {};
        
        this._initInteractionGuards();
        this._initHoverLogic();
        this._initClickListeners();
        
        console.log("MapInteraction: Sensor interaksi aktif.");
    },

    /**
     * Mendeteksi kapan user mulai/selesai menyentuh peta (untuk menunda fetch data)
     */
    _initInteractionGuards: function() {
        const container = this._map.getContainer();

        // Mulai Interaksi
        const startInteract = () => {
            if (this._callbacks.onInteractStart) this._callbacks.onInteractStart();
        };

        container.addEventListener('mousedown', startInteract);
        container.addEventListener('touchstart', startInteract, { passive: true });

        // Selesai Interaksi (Di window agar tertangkap meski lepas mouse di luar peta)
        const endInteract = () => {
            // Cek apakah peta masih bergerak (inersia)
            // Kita kirim callback, biarkan MapManager yang memutuskan logic fetch-nya
            if (this._callbacks.onInteractEnd) this._callbacks.onInteractEnd();
        };

        window.addEventListener('mouseup', endInteract);
        window.addEventListener('touchend', endInteract);
    },

    /**
     * Menangani logika Hover pada poligon wilayah (Provinsi/Kab/Kec)
     */
    _initHoverLogic: function() {
        const fillLayers = ['batas-provinsi-fill', 'batas-kabupaten-fill', 'batas-kecamatan-fill'];

        this._map.on('mousemove', (e) => {
            // TANYA MAP MANAGER: Apakah saya boleh hover? (Misal: mouse sedang di atas marker)
            if (this._callbacks.shouldSkipHover && this._callbacks.shouldSkipHover()) {
                return;
            }

            let features = this._map.queryRenderedFeatures(e.point, { layers: fillLayers });
            
            if (features.length > 0) {
                const feature = features[0];
                if (feature.id !== undefined) {
                    if (this._hoveredStateId !== feature.id) {
                        this.clearHoverState(); // Bersihkan yang lama
                        
                        this._hoveredStateId = feature.id;
                        this._hoveredSourceLayer = feature.sourceLayer;
                        
                        this._map.setFeatureState(
                            { source: 'batas-wilayah-vector', sourceLayer: this._hoveredSourceLayer, id: this._hoveredStateId },
                            { hover: true }
                        );
                    }
                }
            } else {
                this.clearHoverState();
            }
        });

        this._map.on('mouseleave', () => {
            // Jika mouse keluar peta, tapi bukan masuk ke marker
            if (this._callbacks.shouldSkipHover && !this._callbacks.shouldSkipHover()) {
                this.clearHoverState();
            }
        });
    },

    /**
     * Menangani klik khusus pada layer (selain Marker HTML)
     */
    _initClickListeners: function() {
        // Listener Gempa (Layer Simbol/Lingkaran)
        this._map.on('click', 'gempa-point-layer', (e) => {
            // Cek apakah mode gempa aktif via callback atau logic internal layer visibility
            // Tapi lebih aman lapor saja ke Manager
            const feature = e.features[0];
            if (feature && this._callbacks.onGempaClick) {
                e.originalEvent.stopPropagation(); // Stop bubbling
                this._callbacks.onGempaClick(feature);
            }
        });

        // Cursor Pointer untuk Gempa
        this._map.on('mouseenter', 'gempa-point-layer', () => {
            if (this._callbacks.isGempaMode && this._callbacks.isGempaMode()) {
                this._map.getCanvas().style.cursor = 'pointer';
            }
        });
        this._map.on('mouseleave', 'gempa-point-layer', () => {
            if (this._callbacks.isGempaMode && this._callbacks.isGempaMode()) {
                this._map.getCanvas().style.cursor = '';
            }
        });
    },

    /**
     * PUBLIC API: Menyalakan highlight poligon secara manual (misal saat hover Marker)
     */
    highlightPolygon: function(id, tipadm) {
        if (!this._map) return;
        
        let sourceLayer = '';
        const tip = parseInt(tipadm, 10);
        if (tip === 1) sourceLayer = 'batas_provinsi';
        else if (tip === 2) sourceLayer = 'batas_kabupatenkota';
        else if (tip === 3) sourceLayer = 'batas_kecamatandistrik';
        else return; 

        this.clearHoverState();
        this._hoveredStateId = id;
        this._hoveredSourceLayer = sourceLayer;
        
        this._map.setFeatureState(
            { source: 'batas-wilayah-vector', sourceLayer: sourceLayer, id: id },
            { hover: true }
        );
    },

    /**
     * PUBLIC API: Membersihkan semua efek hover
     */
    clearHoverState: function() {
        if (this._hoveredStateId !== null && this._hoveredSourceLayer !== null && this._map) {
            this._map.setFeatureState(
                { source: 'batas-wilayah-vector', sourceLayer: this._hoveredSourceLayer, id: this._hoveredStateId },
                { hover: false }
            );
        }
        this._hoveredStateId = null;
        this._hoveredSourceLayer = null;
    }
};