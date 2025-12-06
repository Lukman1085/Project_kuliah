/** * 🌋 GEMPA MANAGER
 * Menangani pengambilan data (Fetch), de-duplikasi (BMKG vs USGS), 
 * dan manajemen cache khusus gempa.
 */
export const GempaManager = {
    _data: null, // Cache internal data gempa yang sudah diproses

    /**
     * Mengambil data dari API, memprosesnya, dan mengembalikan FeatureCollection.
     * @returns {Promise<Array>} Array of features
     */
    fetchAndProcess: async function() {
        // Jika data sudah ada di memori (cache sederhana), kembalikan. 
        // (Logic TTL bisa ditambahkan di sini jika perlu lebih kompleks)
        if (this._data) return this._data;

        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = window.location.port ? `:${window.location.port}` : '';
        const baseUrl = `${protocol}//${hostname}${port}`;
        
        try {
            // Fetch Parallel
            const [bmkgRes, usgsRes] = await Promise.allSettled([
                fetch(`${baseUrl}/api/gempa/bmkg`),
                fetch(`${baseUrl}/api/gempa/usgs`)
            ]);

            let bmkgFeatures = [];
            let usgsFeatures = [];

            if (bmkgRes.status === 'fulfilled' && bmkgRes.value.ok) {
                const json = await bmkgRes.value.json();
                bmkgFeatures = json.features || [];
            }
            if (usgsRes.status === 'fulfilled' && usgsRes.value.ok) {
                const json = await usgsRes.value.json();
                usgsFeatures = json.features || [];
            }

            // --- LOGIKA DEDUPLIKASI (Logic Bisnis) ---
            // Prioritas BMKG. Jika USGS punya data yang mirip (jarak & waktu dekat), anggap duplikat.
            const finalFeatures = [...bmkgFeatures];
            
            usgsFeatures.forEach(usgs => {
                let isDuplicate = false;
                const uTime = new Date(usgs.properties.time).getTime();
                const uCoord = usgs.geometry.coordinates; 

                for (const bmkg of bmkgFeatures) {
                    const bTime = new Date(bmkg.properties.time).getTime();
                    const bCoord = bmkg.geometry.coordinates;

                    // Toleransi waktu: 120 detik (2 menit)
                    const timeDiff = Math.abs(uTime - bTime) / 1000; 
                    if (timeDiff > 120) continue; 

                    // Toleransi jarak: ~50km (0.5 derajat)
                    const dist = Math.sqrt(Math.pow(uCoord[0] - bCoord[0], 2) + Math.pow(uCoord[1] - bCoord[1], 2));
                    if (dist < 0.5) {
                        isDuplicate = true;
                        break;
                    }
                }

                if (!isDuplicate) {
                    finalFeatures.push(usgs);
                }
            });

            this._data = finalFeatures; // Simpan ke cache
            console.log(`Gempa Manager: Processed ${finalFeatures.length} events.`);
            return finalFeatures;

        } catch (e) {
            console.error("Gempa Manager: Gagal memuat data.", e);
            throw e; // Lempar error agar UI bisa menangani
        }
    },

    /**
     * Membersihkan cache (misal untuk tombol refresh manual)
     */
    clearCache: function() {
        this._data = null;
    }
};