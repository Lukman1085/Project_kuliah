/** 🖱️ MAP INTERACTION (MULTI-SOURCE SUPPORT)
 * Menangani semua event listener peta (Mouse, Touch, Click, Hover).
 * Update: Mendukung 3 sumber data terpisah (Provinsi, Kab/Kota, Kecamatan).
 */
export const MapInteraction = {
    _map: null,
    _callbacks: {}, 
    
    // State Internal untuk Hover
    _hoveredStateId: null,
    _hoveredSource: null,      // [BARU] Menyimpan ID Source (misal: 'source_provinsi')
    _hoveredSourceLayer: null, // Menyimpan nama layer dalam vector tile

    /**
     * Inisialisasi listener interaksi.
     * @param {object} mapInstance - Objek MapLibre
     * @param {object} callbacks - Daftar fungsi callback
     */
    init: function(mapInstance, callbacks) {
        this._map = mapInstance;
        this._callbacks = callbacks || {};
        
        this._initInteractionGuards();
        this._initHoverLogic();
        this._initClickListeners();
        
        console.log("MapInteraction: Sensor interaksi aktif (Multi-source support).");
    },

    /**
     * Mendeteksi kapan user mulai/selesai menyentuh peta
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
     * Menangani logika Hover pada poligon wilayah.
     * [UPDATE] Sekarang menangani 3 source berbeda.
     */
    _initHoverLogic: function() {
        // Daftar layer fill yang ada di map_style.js
        const fillLayers = ['batas-provinsi-fill', 'batas-kabupaten-fill', 'batas-kecamatan-fill'];

        // Mapping dari Layer ID ke Source Config
        const layerConfig = {
            'batas-provinsi-fill': { source: 'source_provinsi', sourceLayer: 'batas_provinsi' },
            'batas-kabupaten-fill': { source: 'source_kabupaten', sourceLayer: 'batas_kabupatenkota' },
            'batas-kecamatan-fill': { source: 'source_kecamatan', sourceLayer: 'batas_kecamatandistrik' }
        };

        this._map.on('mousemove', (e) => {
            if (this._callbacks.shouldSkipHover && this._callbacks.shouldSkipHover()) {
                return;
            }

            // Cek style readiness
            const style = this._map.getStyle();
            if (!style || !style.layers) return;

            try {
                // Query ke semua layer fill sekaligus
                let features = this._map.queryRenderedFeatures(e.point, { layers: fillLayers });
                
                if (features.length > 0) {
                    const feature = features[0];
                    const config = layerConfig[feature.layer.id];

                    if (feature.id !== undefined && config) {
                        // Jika pindah fitur atau pindah layer
                        if (this._hoveredStateId !== feature.id || this._hoveredSource !== config.source) {
                            this.clearHoverState(); 
                            
                            this._hoveredStateId = feature.id;
                            this._hoveredSource = config.source;
                            this._hoveredSourceLayer = config.sourceLayer;
                            
                            // Safety check: pastikan source ada sebelum setFeatureState
                            if (this._map.getSource(this._hoveredSource)) {
                                this._map.setFeatureState(
                                    { 
                                        source: this._hoveredSource, 
                                        sourceLayer: this._hoveredSourceLayer, 
                                        id: this._hoveredStateId 
                                    },
                                    { hover: true }
                                );
                            }
                        }
                    }
                } else {
                    this.clearHoverState();
                }
            } catch (err) {
                // Silent catch untuk glitch render
                console.warn("Hover logic warning:", err);
            }
        });

        this._map.on('mouseleave', () => {
            if (this._callbacks.shouldSkipHover && !this._callbacks.shouldSkipHover()) {
                this.clearHoverState();
            }
        });
    },

    /**
     * Menangani klik khusus pada layer gempa
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
     * PUBLIC API: Highlight poligon manual (misal saat hover Marker).
     * [UPDATE] Memilih source yang tepat berdasarkan tipadm.
     */
    highlightPolygon: function(id, tipadm) {
        if (!this._map) return;
        
        let targetSource = '';
        let targetLayer = '';

        const tip = parseInt(tipadm, 10);
        
        // PENTING: Mapping ini harus sesuai dengan map_style.js
        if (tip === 1) {
            targetSource = 'source_provinsi';
            targetLayer = 'batas_provinsi';
        } else if (tip === 2) {
            targetSource = 'source_kabupaten';
            targetLayer = 'batas_kabupatenkota';
        } else if (tip === 3) {
            targetSource = 'source_kecamatan';
            targetLayer = 'batas_kecamatandistrik';
        } else {
            return; 
        }

        // Bersihkan state sebelumnya jika ada
        this.clearHoverState();

        this._hoveredStateId = id;
        this._hoveredSource = targetSource;
        this._hoveredSourceLayer = targetLayer;
        
        if (this._map.getSource(targetSource)) {
            this._map.setFeatureState(
                { source: targetSource, sourceLayer: targetLayer, id: id },
                { hover: true }
            );
        }
    },

    /**
     * PUBLIC API: Membersihkan semua efek hover
     */
    clearHoverState: function() {
        if (this._hoveredStateId !== null && this._hoveredSource && this._map) {
            // Safety check source existence
            if (this._map.getSource(this._hoveredSource)) {
                this._map.setFeatureState(
                    { 
                        source: this._hoveredSource, 
                        sourceLayer: this._hoveredSourceLayer, 
                        id: this._hoveredStateId 
                    },
                    { hover: false }
                );
            }
        }
        this._hoveredStateId = null;
        this._hoveredSource = null;
        this._hoveredSourceLayer = null;
    }
};