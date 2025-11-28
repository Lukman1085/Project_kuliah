/** 📖 CONSTANTS
 * Sentralisasi semua "Magic Strings" (ID DOM, Class CSS, Nama Layer Peta).
 * Memudahkan refactoring dan mencegah typo.
 */

export const DOM_IDS = {
    GLOBAL_SPINNER: 'global-loading-spinner',
    // Nanti bisa ditambahkan: SIDEBAR, SEARCHBAR, dll.
};

export const CSS_CLASSES = {
    MARKER_DIMMED: 'marker-dimmed',
    MARKER_ACTIVE: 'active-marker',
    MARKER_ENTRANCE: 'marker-entrance',
    MARKER_PROVINCE: 'marker-theme-province'
};

export const MAP_LAYERS = {
    // Layer Gempa
    GEMPA_POINT: 'gempa-point-layer',
    GEMPA_PULSE: 'gempa-pulse-layer',
    GEMPA_LABEL: 'gempa-label-layer',
    
    // Layer Wilayah (Vector Tile)
    PROVINSI_FILL: 'batas-provinsi-fill',
    KABUPATEN_FILL: 'batas-kabupaten-fill',
    KECAMATAN_FILL: 'batas-kecamatan-fill',
    
    PROVINSI_LINE: 'batas-provinsi-layer',
    KABUPATEN_LINE: 'batas-kabupaten-layer',
    KECAMATAN_LINE: 'batas-kecamatan-layer'
};

export const MAP_SOURCES = {
    GEMPA: 'gempa-source',
    // Nama source ini harus SAMA PERSIS dengan yang ada di map_style.js
    SOURCE_PROVINSI: 'source_provinsi',
    SOURCE_KABUPATEN: 'source_kabupaten',
    SOURCE_KECAMATAN: 'source_kecamatan'
};

export const MAP_KEYS = {
    ID_PROV: 'KDPPUM',
    ID_KAB: 'KDPKAB',
    ID_KEC: 'KDCPUM',
    NAME_PROV: 'WADMPR',
    NAME_KAB: 'WADMKK',
    NAME_KEC: 'WADMKC'
};