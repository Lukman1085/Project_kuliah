import { cacheManager } from "./cache_manager";
import { utils } from "./utilities";
import { popupManager } from "./popup_manager";
import { sidebarManager } from "./sidebar_manager";
import { mapManager } from "./map_manager";

/** ⏰ TIME MANAGER: Mengelola state waktu dan update UI terkait waktu */
export const timeManager = {
    _selectedTimeIndex: -1, 
    _globalTimeLocalLookup: [], 
    _predictedStartDate: null,
    _userHasChangedTime: false, 
    
    /** [BARU] Menghitung indeks jam saat ini (disentralisasi) */
    calculateCurrentHourIndex: function(startDate) {
        // (Logika yang sebelumnya ada di init)
        const now = new Date();
        let hourOfDay = now.getHours();
        if (now.getMinutes() >= 30) { hourOfDay = (hourOfDay + 1); } 
        const roundedHour = hourOfDay % 24;
        const todayAtMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startAtMidnight = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const diffDays = Math.round((todayAtMidnight.getTime() - startAtMidnight.getTime()) / (1000 * 60 * 60 * 24));
        const correctedIndex = (diffDays * 24) + roundedHour;
        return Math.max(0, Math.min(335, correctedIndex));
    },

    // --- REFAKTOR (Proyek 2.1) ---
    /** [BARU] Logika terpusat untuk menyinkronkan waktu saat data asli tiba */
    initializeOrSync: function(realStartDate) {
        console.log(`Menyinkronkan waktu dengan data asli...`);
        // Selalu sinkronkan tanggal mulai
        timeManager.setPredictedStartDate(realStartDate);
        
        // Cek apakah pengguna sudah mengubah waktu
        if (!timeManager._userHasChangedTime) {
            // Belum, jadi sinkronkan ke jam saat ini
            console.log("Menyinkronkan jam ke data asli.");
            const correctedIndex = timeManager.calculateCurrentHourIndex(realStartDate);
            // Gunakan _selectedTimeIndex secara langsung alih-alih handleTimeChange
            // untuk menghindari penandaan _userHasChangedTime = true
            this._selectedTimeIndex = correctedIndex;
            this.updateUIWithRealData(); // Perbarui semua UI ke indeks yang baru disinkronkan
        } else {
            // Sudah, hormati pilihan pengguna
            console.log("Data asli dimuat, pilihan pengguna (Indeks " + timeManager.getSelectedTimeIndex() + ") dipertahankan.");
            // Cukup perbarui UI dengan data baru di indeks yang sudah dipilih pengguna.
            this.updateUIWithRealData();
        }
    },
    // --- Akhir Refaktor ---
    
    init: function() {
        const now = new Date();
        this._predictedStartDate = new Date(now);
        this._predictedStartDate.setDate(now.getDate() - 7); 
        this._predictedStartDate.setHours(0, 0, 0, 0); 
        console.log(`Tanggal mulai prediksi dihitung: ${this._predictedStartDate.toISOString()}`);
        
        this._selectedTimeIndex = this.calculateCurrentHourIndex(this._predictedStartDate);
        
        console.log(`Indeks awal diprediksi: ${this._selectedTimeIndex}`);
        this.updateTimePickerDisplayOnly(); 
        this.updateNavigationButtonsState(this._selectedTimeIndex); 
    },
    getSelectedTimeIndex: function() { return this._selectedTimeIndex; },
    getGlobalTimeLookup: function() { return this._globalTimeLocalLookup; },
    getPredictedStartDate: function() { return this._predictedStartDate; },
    setGlobalTimeLookup: function(lookupArray) {
        this._globalTimeLocalLookup = lookupArray;
        console.log(`Lookup waktu asli di-set (Total: ${this._globalTimeLocalLookup.length} jam)`);
    },
    setPredictedStartDate: function(date) {
        this._predictedStartDate = date;
        console.log(`Tanggal mulai prediksi DISINKRONKAN ke data asli: ${date.toISOString()}`);
    },
    updateNavigationButtonsState: function(currentIndex) {
        if (prevDayBtn) prevDayBtn.disabled = (currentIndex < 24);
        if (nextDayBtn) nextDayBtn.disabled = (currentIndex >= 312); 
        if (prevThreeHourBtn) prevThreeHourBtn.disabled = (currentIndex < 3);
        if (prevHourBtn) prevHourBtn.disabled = (currentIndex <= 0);
        if (nextHourBtn) nextHourBtn.disabled = (currentIndex >= 335);
        if (nextThreeHourBtn) nextThreeHourBtn.disabled = (currentIndex >= 333); 
    },
    updateTimePickerDisplayOnly: function(useRealData = false) {
            if (!dateDisplay || !hourDisplay) return;
            const idx = this._selectedTimeIndex;
            let dateToShow;
            let hourToShow = "--:--";
            if (useRealData && this._globalTimeLocalLookup.length > idx && idx >= 0) {
                const realTimeString = this._globalTimeLocalLookup[idx];
                const [datePart, timePart] = realTimeString.split('T');
                dateToShow = utils.formatDateDisplayFromString(datePart); 
                hourToShow = timePart;
            } else {
                const predictedDate = utils.getPredictedDateFromIndex(idx); 
                if (predictedDate) {
                    dateToShow = utils.formatDateDisplayFromDateObject(predictedDate); 
                    hourToShow = String(predictedDate.getHours()).padStart(2, '0') + ":00";
                } else {
                    dateToShow = "Memuat..."; 
                }
            }
            dateDisplay.textContent = dateToShow;
            hourDisplay.textContent = hourToShow;
    },

    /** Memperbarui state fitur peta berdasarkan waktu (loop efisien) */
    updateMapFeaturesForTime: function(idxGlobal) {
        // (Tidak ada perubahan, sudah direfaktor di Proyek 1)
        if (this._globalTimeLocalLookup.length === 0) {
                return;
        }
        if (!map || !map.getSource('data-cuaca-source')) return; 
        if (idxGlobal === undefined || idxGlobal < 0 || idxGlobal >= this._globalTimeLocalLookup.length) {
            idxGlobal = this._selectedTimeIndex; 
        }
        if (idxGlobal < 0 || idxGlobal >= this._globalTimeLocalLookup.length) return; 
        const visibleFeatures = map.querySourceFeatures('data-cuaca-source', { 
            filter: ['!', ['has', 'point_count']] 
        });
        const activeIdStr = String(mapManager.getActiveLocationId());
        for (const feature of visibleFeatures) {
            const featureId = feature.id;
            const featureIdStr = String(featureId);
            const cachedData = cacheManager.get(featureId);
            const isActive = (featureIdStr === activeIdStr);
            let stateData = { hasData: false, active: isActive }; 
            if (cachedData && cachedData.hourly?.time && idxGlobal < cachedData.hourly.time.length) {
                const hourly = cachedData.hourly;
                stateData = {
                    hasData: true,
                    suhu: hourly.temperature_2m?.[idxGlobal] ?? -999, 
                    precip: hourly.precipitation_probability?.[idxGlobal] ?? -1, 
                    active: isActive 
                };
            }
            try {
                map.setFeatureState({ source: 'data-cuaca-source', id: featureId }, stateData); 
            } catch(e) {
                    // console.warn(`Gagal set state (updateMapFeaturesForTime) untuk ${featureId}:`, e.message);
            }
        }
    },
    
    /** Memperbarui semua UI yang bergantung pada waktu */
    updateUIWithRealData: function() {
        // (Tidak ada perubahan)
        const idx = this._selectedTimeIndex;
        console.log(`UI Update (Real Data) triggered for Index: ${idx}`);
        if (this._globalTimeLocalLookup.length === 0) { 
            console.error("updateUIWithRealData dipanggil secara tidak benar (data belum siap).");
            return;
        }
        if (idx < 0 || idx >= this._globalTimeLocalLookup.length) {
                console.error(`Indeks ${idx} tidak valid untuk globalTimeLocalLookup`);
                return;
        }
        const localTimeString = this._globalTimeLocalLookup[idx];
        const activeData = mapManager.getActiveLocationData();
        this.updateTimePickerDisplayOnly(true); 
        this.updateMapFeaturesForTime(idx); 
        popupManager.updateUIForTime(idx, localTimeString); 
        sidebarManager.updateUIForTime(idx, localTimeString, activeData); 
        this.updateNavigationButtonsState(idx); 
    },

    /** Handler utama saat waktu diubah oleh pengguna */
    handleTimeChange: function(newIndex) {
        newIndex = Math.max(0, Math.min(335, newIndex)); // Clamp
        if (newIndex !== this._selectedTimeIndex) {
            this._userHasChangedTime = true;
            this._selectedTimeIndex = newIndex;
            console.log(`Indeks waktu diubah ke: ${newIndex}`);
            this.updateTimePickerDisplayOnly(this._globalTimeLocalLookup.length > 0); 
            this.updateNavigationButtonsState(newIndex); 
            if (this._globalTimeLocalLookup.length > 0) {
                this.updateUIWithRealData(); 
            }
        }
    }
};