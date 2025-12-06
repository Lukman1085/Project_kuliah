import { timeManager } from "./time_manager.js";

/** 🛠️ UTILS: Kumpulan fungsi helper murni */
export let WMO_CODE_MAP = {};
export const utils = { 
    // (Tidak ada perubahan di getWeatherInfo, getPredictedDateFromIndex, formatLocalTimestampString, formatPredictedDateObject)
    // (Tidak ada perubahan di formatDateDisplayFromString, formatDateDisplayFromDateObject, formatDayOnly, debounce)
    // (Tidak ada perubahan di extractHourlyDataPoint)
    
    getWeatherInfo: function(weather_code, is_day) {
        const default_info = ["N/A", "wi-na"];
        if (weather_code === undefined || weather_code === null) { return { deskripsi: default_info[0], ikon: `wi ${default_info[1]}` }; }
        const info = WMO_CODE_MAP[weather_code];
        if (!info) { return { deskripsi: `Kode ${weather_code}`, ikon: `wi ${default_info[1]}` }; }
        const deskripsi = info[0] || default_info[0];
        const useDayIcon = (is_day === 1 || is_day === true);
        // Kembalikan nama class ikon (string) yang sesuai dengan nama file SVG (tanpa ekstensi)
        const icon_name = useDayIcon ? (info[1] || info[2]) : (info[2] || info[1]);
        // Kita kembalikan format class untuk CSS 'wi ...' DAN nama raw untuk keperluan MapLibre image ID
        return { 
            deskripsi: deskripsi, 
            ikon: `wi ${icon_name || default_info[1]}`, // Untuk HTML Class (Sidebar/Popup)
            raw_icon_name: icon_name || default_info[1]   // Untuk MapLibre Layer (Marker)
        };
    },

    // --- [REVISI] SECTION: ICON LOADER ENGINE (TAHAP A - STABILIZED) ---

    /**
     * Memuat SVG, menyuntikkan dimensi, mengubahnya menjadi Data URI Base64,
     * memuatnya ke HTMLImageElement, lalu menambahkannya ke style peta.
     * Metode ini mencegah DOMException pada ImageBitmap.
     */
    loadSvgWithDimensions: async function(map, url, id, isSDF = false) {
        if (map.hasImage(id)) return; // Skip jika sudah ada

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Gagal fetch ${url}`);
            const svgText = await response.text();

            // 1. Parse XML SVG
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(svgText, "image/svg+xml");
            const svgElement = xmlDoc.documentElement;

            // 2. Suntikkan dimensi Eksplisit ke XML (PENTING)
            // Kita set width/height agar browser tahu ukuran render sebelum rasterisasi
            svgElement.setAttribute("width", "35");
            svgElement.setAttribute("height", "35");

            // 3. Serialisasi kembali ke string XML
            const serializer = new XMLSerializer();
            const newSvgStr = serializer.serializeToString(xmlDoc);

            // 4. Konversi ke Base64 Data URI (Bypass Blob issues)
            // Menggunakan btoa dengan unescape/encodeURIComponent untuk menangani karakter Unicode jika ada
            const base64SVG = window.btoa(unescape(encodeURIComponent(newSvgStr)));
            const dataURI = `data:image/svg+xml;base64,${base64SVG}`;

            // 5. Buat HTMLImageElement (Standard Browser Image)
            const img = new Image(35, 35);
            
            // Wrap onload dalam Promise agar kita bisa await
            await new Promise((resolve, reject) => {
                img.onload = () => {
                    if (!map.hasImage(id)) {
                        map.addImage(id, img, { sdf: isSDF });
                        // console.log(`Ikon OK: ${id}`);
                    }
                    resolve();
                };
                img.onerror = (e) => {
                    console.error(`Gagal render image ${id}`, e);
                    reject(e);
                };
                img.src = dataURI;
            });

        } catch (e) {
            console.error(`Error loading SVG ${id}:`, e);
        }
    },

    /**
     * Orkestrator untuk memuat semua aset marker yang dibutuhkan.
     */
    preloadMarkerAssets: async function(map) {
        console.log("🚧 Memulai Konstruksi Aset Marker (Phase A - Revisi)...");
        const basePath = "static/images/icons/"; 

        // 1. Muat Komponen Struktur Marker
        const structuralAssets = [
            { file: "wi-thermometer-exterior.svg", id: "marker-thermometer-exterior", sdf: false }, 
            { file: "wi-thermometer-internal.svg", id: "marker-thermometer-internal", sdf: true },  
            { file: "wi-raindrop.svg", id: "marker-raindrop", sdf: true }                           
        ];

        const promises = structuralAssets.map(asset => 
            this.loadSvgWithDimensions(map, `${basePath}${asset.file}`, asset.id, asset.sdf)
        );

        // 2. Muat Ikon Cuaca Unik
        const uniqueIcons = new Set();
        uniqueIcons.add("wi-na"); 
        
        Object.values(WMO_CODE_MAP).forEach(val => {
            if (val[1]) uniqueIcons.add(val[1]);
            if (val[2]) uniqueIcons.add(val[2]);
        });

        console.log(`Mendeteksi ${uniqueIcons.size} varian ikon cuaca unik.`);

        uniqueIcons.forEach(iconName => {
            promises.push(
                this.loadSvgWithDimensions(map, `${basePath}${iconName}.svg`, iconName, true)
            );
        });

        await Promise.all(promises);
        console.log("✅ Tahap A Selesai (Revisi): Aset marker aman di memori.");
    },

    // --- END SECTION ---

    // --- [NEW] SECTION: COLOR LOGIC (TAHAP B) ---
    
    /** Mengembalikan warna HEX berdasarkan suhu (untuk Termometer Internal) */
    getTempColor: function(temp) {
        if (temp === null || temp === undefined) return '#cccccc'; // Abu-abu jika null
        if (temp < 15) return '#3498db'; // Dingin (Biru)
        if (temp < 25) return '#2ecc71'; // Nyaman (Hijau)
        if (temp < 30) return '#f1c40f'; // Hangat (Kuning)
        if (temp < 34) return '#e67e22'; // Panas (Oranye)
        return '#e74c3c';                // Ekstrem (Merah)
    },

    /** Mengembalikan warna HEX berdasarkan probabilitas hujan (untuk Raindrop) */
    getPrecipColor: function(prob) {
        if (prob === null || prob === undefined) return '#bdc3c7'; // Abu-abu muda
        if (prob <= 10) return '#bdc3c7'; // Kering (Abu-abu)
        if (prob <= 40) return '#85c1e9'; // Potensi Rendah (Biru Pucat)
        if (prob <= 70) return '#3498db'; // Potensi Sedang (Biru)
        return '#2980b9';                 // Basah (Biru Tua)
    },
    // --- END SECTION ---

    // --- [NEW] ESTETIKA LOGIC (TAHAP E) ---
    
    /** * Menentukan TEMA warna marker berdasarkan kode cuaca & waktu.
     * Output class CSS: 'marker-theme-sunny', 'marker-theme-rain', dll.
     */
    getWeatherTheme: function(code, isDay) {
        // Jika malam hari dan cerah/berawan tipis -> Tema Malam
        if ((isDay === 0 || isDay === false) && [0, 1, 2].includes(code)) {
            return 'marker-theme-night';
        }

        // Mapping WMO Code ke Tema
        if ([0, 1].includes(code)) return 'marker-theme-sunny';      // Cerah
        if ([2, 3, 45, 48].includes(code)) return 'marker-theme-cloudy'; // Berawan/Kabut
        if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'marker-theme-rain'; // Hujan
        if ([71, 73, 75, 77, 85, 86].includes(code)) return 'marker-theme-rain'; // Salju (pakai biru rain dulu)
        if ([95, 96, 99].includes(code)) return 'marker-theme-storm';    // Badai
        
        return 'marker-theme-cloudy'; // Default
    },

    getTempColor: function(temp) {
        if (temp === null || temp === undefined) return '#cccccc'; 
        if (temp <= 16) return '#039BE5';      // Dingin (Biru)
        if (temp <= 24) return '#43A047';      // Nyaman (Hijau)
        if (temp <= 32) return '#FB8C00';      // Hangat (Oranye)
        return '#E53935';                      // Panas (Merah)
    },

    /** * Warna HSL untuk ikon hujan. 
     * 0% = Abu-abu, 100% = Biru Neon Terang 
     */
    getRainColor: function(prob) {
        if (prob === null || prob === undefined || prob === 0) return '#cccccc'; // Kering (Abu)
        
        // Logic HSL: Hue 210 (Biru Langit).
        // Saturasi naik dari 50% ke 100%.
        // Lightness turun dari 85% (pucat) ke 45% (pekat).
        const sat = 50 + (prob / 2); 
        const light = 85 - (prob * 0.4); 
        return `hsl(210, ${sat}%, ${light}%)`;
    },
    // --- END ESTETIKA LOGIC ---

    formatLocalTimestampString: function(localTimeString) {
        if (!localTimeString) return "Error Waktu";
        try {
            const date = new Date(localTimeString); 
            if (isNaN(date.getTime())) throw new Error("Invalid Date");
            const options = { 
                weekday: 'long', 
                day: 'numeric', 
                month: 'long', 
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: false 
            };
            return new Intl.DateTimeFormat('id-ID', options).format(date);
        } catch (e) { console.error("Error formatting real local timestamp:", localTimeString, e); return "Error Waktu"; }
    },
    formatPredictedDateObject: function(dateObject) {
        if (!dateObject || isNaN(dateObject.getTime())) return "Error Waktu";
        try {
            const options = { 
                weekday: 'long', 
                day: 'numeric', 
                month: 'long', 
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: false 
            };
            return new Intl.DateTimeFormat('id-ID', options).format(dateObject);
        } catch (e) { console.error("Error formatting predicted date object:", dateObject, e); return "Error Waktu"; }
    },
    formatDateDisplayFromString: function(localDateString) {
            if (!localDateString) return "Error Tgl";
        try {
            const date = new Date(localDateString + "T12:00:00"); 
            if (isNaN(date.getTime())) throw new Error("Invalid Date");
            return this.formatDateDisplayFromDateObject(date);
        } catch (e) { 
            console.error("Error formatting date display string:", localDateString, e); 
            return "Error Tgl"; 
        }
    },
    formatDateDisplayFromDateObject: function(dateObject) {
        if (!dateObject || isNaN(dateObject.getTime())) return "Error Tgl";
        try {
            const now = new Date();
            const getLocalDateString = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const todayStr = getLocalDateString(now);
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            const yesterdayStr = getLocalDateString(yesterday);
            const tomorrow = new Date(now);
            tomorrow.setDate(now.getDate() + 1);
            const tomorrowStr = getLocalDateString(tomorrow);
            const dateObjectStr = getLocalDateString(dateObject);

            if (dateObjectStr === todayStr) return "Hari Ini";
            if (dateObjectStr === yesterdayStr) return "Kemarin";
            if (dateObjectStr === tomorrowStr) return "Besok";

            const options = { weekday: 'long', day: 'numeric', month: 'short' };
            return new Intl.DateTimeFormat('id-ID', options).format(dateObject);
        } catch (e) { console.error("Error formatting date display object:", dateObject, e); return "Error Tgl"; }
    },
    formatDayOnly: function(dateString, timeZone) {
            if (!dateString) return "Error Tgl";
            const tz = timeZone || 'UTC';
            try {
            const dateParts = dateString.split('-');
            if (dateParts.length !== 3) throw new Error("Invalid format");
            const date = new Date(Date.UTC(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]), 12));
            if (isNaN(date.getTime())) throw new Error("Invalid Date");
            const options = { weekday: 'long', day: 'numeric', month: 'short', timeZone: tz };
            return new Intl.DateTimeFormat('id-ID', options).format(date);
        } catch (e) { console.error("Error formatting day:", dateString, tz, e); return dateString; }
    },
    debounce: function(func, delay) {
            let timeout;
            return (...args) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), delay);
            };
    },
    extractHourlyDataPoint: function(hourly, index) {
        if (!hourly || !hourly.time) {
            console.warn("extractHourlyDataPoint dipanggil dengan data hourly yang tidak valid.");
            return {}; 
        }
        return {
            is_day: hourly.is_day?.[index],
            weather_code: hourly.weather_code?.[index],
            suhu: hourly.temperature_2m?.[index],
            terasa: hourly.apparent_temperature?.[index],
            kelembapan: hourly.relative_humidity_2m?.[index],
            prob_presipitasi: hourly.precipitation_probability?.[index],
            kecepatan_angin_10m: hourly.wind_speed_10m?.[index],
            arah_angin_10m: hourly.wind_direction_10m?.[index],
        };
    }
};