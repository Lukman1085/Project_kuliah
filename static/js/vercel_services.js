/**
 * 📊 VERCEL ANALYTICS & SPEED INSIGHTS MANAGER
 * Menggunakan versi ESM (ECMAScript Module) yang kompatibel dengan browser
 * tanpa perlu bundler (Webpack/Vite).
 * * Dokumentasi:
 * - Analytics: https://vercel.com/docs/analytics/quickstart
 * - Speed Insights: https://vercel.com/docs/speed-insights/quickstart
 */

// Mengimpor langsung dari CDN ESM yang kompatibel dengan browser
import { inject as injectAnalytics } from 'https://esm.sh/@vercel/analytics';
import { injectSpeedInsights } from 'https://esm.sh/@vercel/speed-insights';

export const initVercelServices = () => {
    // Cek apakah kita berada di browser
    if (typeof window === 'undefined') return;

    console.log("🚀 Initializing Vercel Services...");

    // 1. Inject Web Analytics
    // Secara default, ini tidak akan mengirim data di localhost (Development)
    // kecuali mode debug diaktifkan.
    injectAnalytics({
        debug: false, // Set true jika ingin melihat log di console browser saat dev
        
        // [MODIFIKASI] Filter berdasarkan route di app.py
        beforeSend: (event) => {
            try {
                // Parsing URL untuk mendapatkan pathname yang bersih
                const url = new URL(event.url);
                const path = url.pathname;

                // 1. KECUALIKAN SEMUA API BACKEND (Flask)
                // Berdasarkan app.py, semua data endpoint dimulai dengan /api/
                // Kita tidak ingin menghitung fetch data sebagai "Page View"
                if (path.startsWith('/api/')) {
                    return null; // Abaikan event ini
                }

                // 2. KECUALIKAN FILE STATIS (Opsional, Vercel biasanya auto-filter, tapi aman ditambahkan)
                // Mencegah tracking file .css, .js, .map, dll jika termuat sebagai navigasi
                if (path.startsWith('/static/')) {
                    return null;
                }

                return event; // Kirim event jika lolos filter
            } catch (e) {
                // Jika URL parsing gagal, kembalikan event apa adanya atau null
                console.warn("Vercel Analytics URL parse error:", e);
                return event;
            }
        }
    });

    // 2. Inject Speed Insights
    // Mengukur Core Web Vitals (LCP, FID, CLS)
    injectSpeedInsights({
        sampleRate: 1.0, // Persentase user yang dilacak (1.0 = 100%)
    });

    console.log("✅ Vercel Analytics & Speed Insights Injected.");
};