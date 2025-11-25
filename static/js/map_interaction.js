/** 🖱️ MAP INTERACTION
 * Menangani semua event listener peta (Mouse, Touch, Click, Hover).
 * Bertugas sebagai "Indera Perasa" peta, melaporkan kejadian ke MapManager.
 */
export const MapInteraction = {
    _map: null,
    _callbacks: {}, 
    
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

        const startInteract = () => {
            if (this._callbacks.onInteractStart) this._callbacks.onInteractStart();
        };

        container.addEventListener('mousedown', startInteract);
        container.addEventListener('touchstart', startInteract, { passive: true });

        const endInteract = () => {
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
            if (this._callbacks.shouldSkipHover && this._callbacks.shouldSkipHover()) {
                return;
            }

            // [PERBAIKAN BUG CRITICAL]
            // Cek apakah layer target sudah ada di style peta sebelum query.
            // Jika tiles gagal dimuat (404) atau style belum siap, ini mencegah crash.
            const style = this._map.getStyle();
            if (!style || !style.layers) return;
            
            // Kita cek layer pertama sebagai sampel
            if (!this._map.getLayer(fillLayers[0])) return;

            try {
                let features = this._map.queryRenderedFeatures(e.point, { layers: fillLayers });
                
                if (features.length > 0) {
                    const feature = features[0];
                    if (feature.id !== undefined) {
                        if (this._hoveredStateId !== feature.id) {
                            this.clearHoverState(); 
                            
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
            } catch (err) {
                // Silent catch untuk mencegah flooding console jika terjadi glitch render
            }
        });

        this._map.on('mouseleave', () => {
            if (this._callbacks.shouldSkipHover && !this._callbacks.shouldSkipHover()) {
                this.clearHoverState();
            }
        });
    },

    /**
     * Menangani klik khusus pada layer (selain Marker HTML)
     */
    _initClickListeners: function() {
        this._map.on('click', 'gempa-point-layer', (e) => {
            const feature = e.features[0];
            if (feature && this._callbacks.onGempaClick) {
                e.originalEvent.stopPropagation(); 
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
        
        // Safety check sebelum set state
        if (this._map.getSource('batas-wilayah-vector')) {
            this._map.setFeatureState(
                { source: 'batas-wilayah-vector', sourceLayer: sourceLayer, id: id },
                { hover: true }
            );
        }
    },

    /**
     * PUBLIC API: Membersihkan semua efek hover
     */
    clearHoverState: function() {
        if (this._hoveredStateId !== null && this._hoveredSourceLayer !== null && this._map) {
            // Safety check
            if (this._map.getSource('batas-wilayah-vector')) {
                this._map.setFeatureState(
                    { source: 'batas-wilayah-vector', sourceLayer: this._hoveredSourceLayer, id: this._hoveredStateId },
                    { hover: false }
                );
            }
        }
        this._hoveredStateId = null;
        this._hoveredSourceLayer = null;
    }
};