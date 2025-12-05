/** Mengelola cache data cuaca dengan logika TTL (Time-To-Live) */
export const cacheManager = {
    _cache: new Map(),
    _TTL: 1800 * 1000, // 30 Menit (1800 detik * 1000 ms), sama seperti backend

    /** Mengambil data dari cache. Mengembalikan null jika tidak ada atau kedaluwarsa. */
    get: function(id) {
        const entry = this._cache.get(id);
        if (!entry) {
            return null; // Tidak ada
        }
        
        // Cek apakah kedaluwarsa
        if (Date.now() - entry.timestamp > this._TTL) {
            console.log(`Cache expired for ${id}`);
            this._cache.delete(id);
            return null; // Kedaluwarsa
        }
        
        // Valid
        return entry.data;
    },

    /** Menyimpan data ke cache dengan timestamp baru. */
    set: function(id, data) {
        this._cache.set(id, { data: data, timestamp: Date.now() });
    },
    
    /** Janitor: Membersihkan semua entri yang kedaluwarsa dari cache. */
    cleanExpired: function() {
        // console.log("Running cache janitor..."); // Bisa di-enable untuk debugging
        const now = Date.now();
        let removedCount = 0;
        for (const [id, entry] of this._cache.entries()) {
            if (now - entry.timestamp > this._TTL) {
                this._cache.delete(id);
                removedCount++;
            }
        }
        if (removedCount > 0) {
            console.log(`Cache janitor removed ${removedCount} expired entries.`);
        }
    }
};