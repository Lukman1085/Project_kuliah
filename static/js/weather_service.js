import { cacheManager } from "./cache_manager.js";
import { timeManager } from "./time_manager.js";

/** ☁️ WEATHER SERVICE
 * Bertanggung jawab murni untuk strategi pengambilan data cuaca.
 * - Memfilter ID yang perlu di-fetch (Single responsibility: Data Fetching).
 * - Menangani In-flight requests (mencegah double request).
 * - Mengelola Cache (via CacheManager).
 * - Mengelola Inisialisasi Waktu Global.
 */
export const WeatherService = {
    _inflightIds: new Set(), // Pengganti inflightIds di map_manager
    _isLoading: false,

    /**
     * Mengambil data untuk daftar ID lokasi secara batch.
     * @param {Array<string>} potentialIds - Daftar ID kandidat (dari marker di viewport).
     * @returns {Promise<object>} Hasil operasi { success, dataMap, error }.
     */
    fetchMissingData: async function(potentialIds) {
        // 1. Filter: Hanya ambil yang belum ada di cache & belum sedang di-fetch
        const validIds = potentialIds.filter(id => {
            return id && id !== 'undefined' && id !== 'null';
        });

        const idsToFetch = validIds.filter(id => {
            return !cacheManager.get(String(id)) && !this._inflightIds.has(String(id));
        });

        // Cek khusus untuk inisialisasi waktu awal (jika belum ada data waktu sama sekali)
        const isFirstLoad = (timeManager.getGlobalTimeLookup().length === 0);
        
        // [EDGE CASE] Jika load pertama dan tidak ada kandidat (misal semua sudah ter-cache atau kosong),
        // kita paksa ambil satu ID valid dari potentialIds agar waktu bisa di-init.
        if (isFirstLoad && idsToFetch.length === 0 && potentialIds.length > 0) {
             const firstValid = potentialIds.find(id => !this._inflightIds.has(String(id)));
             if (firstValid) idsToFetch.push(firstValid);
        }

        if (idsToFetch.length === 0) {
            return { success: true, dataMap: {}, isFirstLoad: isFirstLoad };
        }

        // Tandai In-flight
        idsToFetch.forEach(id => this._inflightIds.add(String(id)));
        this._isLoading = true;

        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = '5000';
        const baseUrl = `${protocol}//${hostname}:${port}`;

        try {
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${idsToFetch.join(',')}`);
            if (!resp.ok) throw new Error(`Network error ${resp.status}`);
            
            const dataMap = await resp.json();
            let didInitTime = false;

            // Proses Data Masuk
            for (const id in dataMap) {
                const data = dataMap[id];
                cacheManager.set(String(id), data);
                
                // Inisialisasi Waktu Global jika ini data pertama yang valid
                if (isFirstLoad && !didInitTime && data.hourly?.time?.length > 0) {
                    timeManager.setGlobalTimeLookup(data.hourly.time);
                    const realStartDate = new Date(data.hourly.time[0]);
                    timeManager.initializeOrSync(realStartDate);
                    didInitTime = true;
                }
            }

            return { 
                success: true, 
                dataMap: dataMap,
                idsFetched: idsToFetch 
            };

        } catch (e) {
            console.error("WeatherService: Gagal fetch batch.", e);
            return { success: false, error: e, idsFailed: idsToFetch };
        } finally {
            // Bersihkan status In-flight
            idsToFetch.forEach(id => this._inflightIds.delete(String(id)));
            this._isLoading = false;
        }
    },

    /**
     * Fetch data tunggal (Wrapper untuk klik marker/sidebar).
     */
    fetchSingle: async function(id) {
        const safeId = String(id);
        
        if (!safeId || safeId === 'undefined' || safeId === 'null') return null;

        // 1. Cek Cache
        const cached = cacheManager.get(safeId);
        if (cached) return cached;

        // 2. Fetch via Batch Logic
        const result = await this.fetchMissingData([safeId]);
        
        if (result.success && result.dataMap && result.dataMap[safeId]) {
            return result.dataMap[safeId];
        }
        
        // Jika gagal atau data kosong
        if (result.error) throw result.error;
        return null;
    },

    isLoading: function() {
        return this._isLoading;
    }
};