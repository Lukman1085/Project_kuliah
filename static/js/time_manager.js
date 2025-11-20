import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { sidebarManager } from "./sidebar_manager.js";
import { mapManager } from "./map_manager.js";

/** ⏰ TIME MANAGER: Mengelola state waktu dan update UI terkait waktu */
export const timeManager = {
    _selectedTimeIndex: -1, 
    _globalTimeLocalLookup: [], 
    _predictedStartDate: null,
    _userHasChangedTime: false, 

    elements: {},

    initDOM: function(domElements) {
        this.elements = domElements;
        console.log("Elemen DOM Waktu telah di-set di timeManager.");
    },

    getPredictedDateFromIndex: function(index) {
        const startDate = this.getPredictedStartDate(); 
        if (index < 0 || index > 335 || !startDate) { return null; }
        const predictedDate = new Date(startDate);
        predictedDate.setHours(predictedDate.getHours() + index);
        return predictedDate;
    },
    
    calculateCurrentHourIndex: function(startDate) {
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

    initializeOrSync: function(realStartDate) {
        console.log(`Menyinkronkan waktu dengan data asli...`);
        this.setPredictedStartDate(realStartDate);
        if (!this._userHasChangedTime) {
            console.log("Menyinkronkan jam ke data asli.");
            const correctedIndex = this.calculateCurrentHourIndex(realStartDate);
            this._selectedTimeIndex = correctedIndex;
            this.updateUIWithRealData(); 
        } else {
            console.log("Data asli dimuat, pilihan pengguna (Indeks " + this.getSelectedTimeIndex() + ") dipertahankan.");
            this.updateUIWithRealData();
        }
    },
    
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
        const { prevDayBtn, nextDayBtn, prevThreeHourBtn, prevHourBtn, nextHourBtn, nextThreeHourBtn } = this.elements;
        if (prevDayBtn) prevDayBtn.disabled = (currentIndex < 24);
        if (nextDayBtn) nextDayBtn.disabled = (currentIndex >= 312); 
        if (prevThreeHourBtn) prevThreeHourBtn.disabled = (currentIndex < 3);
        if (prevHourBtn) prevHourBtn.disabled = (currentIndex <= 0);
        if (nextHourBtn) nextHourBtn.disabled = (currentIndex >= 335);
        if (nextThreeHourBtn) nextThreeHourBtn.disabled = (currentIndex >= 333); 
    },
    updateTimePickerDisplayOnly: function(useRealData = false) {
            const { dateDisplay, hourDisplay } = this.elements;
            if (!dateDisplay || !hourDisplay) return;
            const idx = this._selectedTimeIndex;
            let dateToShow; let hourToShow = "--:--";
            if (useRealData && this._globalTimeLocalLookup.length > idx && idx >= 0) {
                const realTimeString = this._globalTimeLocalLookup[idx];
                const [datePart, timePart] = realTimeString.split('T');
                dateToShow = utils.formatDateDisplayFromString(datePart); hourToShow = timePart;
            } else {
                const predictedDate = this.getPredictedDateFromIndex(idx); 
                if (predictedDate) {
                    dateToShow = utils.formatDateDisplayFromDateObject(predictedDate); 
                    hourToShow = String(predictedDate.getHours()).padStart(2, '0') + ":00";
                } else { dateToShow = "Memuat..."; }
            }
            dateDisplay.textContent = dateToShow; hourDisplay.textContent = hourToShow;
    },

    /** * [REVISI] Update Feature State DAN Source Property */
    updateMapFeaturesForTime: function(idxGlobal) {
        const map = mapManager.getMap();
        if (this._globalTimeLocalLookup.length === 0) { return; }
        if (!map || !map.getSource('data-cuaca-source')) return; 
        
        if (idxGlobal === undefined || idxGlobal < 0 || idxGlobal >= this._globalTimeLocalLookup.length) {
            idxGlobal = this._selectedTimeIndex; 
        }
        if (idxGlobal < 0 || idxGlobal >= this._globalTimeLocalLookup.length) return; 
        
        // 1. Update Warna & Angka (Feature State - Paint Properties)
        const visibleFeatures = map.querySourceFeatures('data-cuaca-source', { filter: ['!', ['has', 'point_count']] });
        const activeIdStr = String(mapManager.getActiveLocationId());

        for (const feature of visibleFeatures) {
            const featureId = feature.id;
            const featureIdStr = String(featureId);
            const cachedData = cacheManager.get(featureId);
            const isActive = (featureIdStr === activeIdStr);
            let stateData = { hasData: false, active: isActive }; 
            
            if (cachedData && cachedData.hourly?.time && idxGlobal < cachedData.hourly.time.length) {
                const hourly = cachedData.hourly;
                const rawTemp = hourly.temperature_2m?.[idxGlobal];
                const rawPrecip = hourly.precipitation_probability?.[idxGlobal];
                const tempColor = utils.getTempColor(rawTemp);
                const precipColor = utils.getPrecipColor(rawPrecip);

                stateData = {
                    hasData: true,
                    suhu: rawTemp ?? -999,
                    precip: rawPrecip ?? -1,
                    temp_color: tempColor,    // Paint Property
                    precip_color: precipColor, // Paint Property
                    active: isActive 
                };
            }
            try { map.setFeatureState({ source: 'data-cuaca-source', id: featureId }, stateData); } catch(e) { }
        }

        // 2. [BARU] Update Bentuk Ikon (Source Data - Layout Property Workaround)
        // Kita memanggil fungsi baru di mapManager
        mapManager.updateIconsForTime(idxGlobal);
    },
    
    updateUIWithRealData: function() {
        const idx = this._selectedTimeIndex;
        console.log(`UI Update (Real Data) triggered for Index: ${idx}`);
        if (this._globalTimeLocalLookup.length === 0) { console.error("updateUIWithRealData dipanggil secara tidak benar (data belum siap)."); return; }
        if (idx < 0 || idx >= this._globalTimeLocalLookup.length) { console.error(`Indeks ${idx} tidak valid untuk globalTimeLocalLookup`); return; }
        const localTimeString = this._globalTimeLocalLookup[idx];
        const activeData = mapManager.getActiveLocationData();
        this.updateTimePickerDisplayOnly(true); 
        this.updateMapFeaturesForTime(idx); 
        popupManager.updateUIForTime(idx, localTimeString); 
        sidebarManager.updateUIForTime(idx, localTimeString, activeData); 
        this.updateNavigationButtonsState(idx); 
    },

    handleTimeChange: function(newIndex) {
        newIndex = Math.max(0, Math.min(335, newIndex)); 
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