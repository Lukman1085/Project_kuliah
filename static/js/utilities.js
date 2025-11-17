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
        const icon_class = useDayIcon ? (info[1] || info[2]) : (info[2] || info[1]);
        return { deskripsi: deskripsi, ikon: `wi ${icon_class || default_info[1]}` };
    },
    // getPredictedDateFromIndex: function(index) {
    //     const startDate = timeManager.getPredictedStartDate();
    //     if (index < 0 || index > 335 || !startDate) {
    //         return null;
    //     }
    //     const predictedDate = new Date(startDate);
    //     predictedDate.setHours(predictedDate.getHours() + index);
    //     return predictedDate;
    // },
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