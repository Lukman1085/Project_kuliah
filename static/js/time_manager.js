import { cacheManager } from "./cache_manager.js";
import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { sidebarManager } from "./sidebar_manager.js";
import { mapManager } from "./map_manager.js";

/** ⏰ TIME MANAGER */
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

    /**
     * [FITUR BARU] Mengatur status aktif/non-aktif Time Picker (Lockdown Mode).
     * @param {boolean} isDisabled - True untuk mengunci, False untuk membuka.
     */
    setDisabledState: function(isDisabled) {
        const container = document.getElementById('datetime-picker-container');
        const allButtons = container ? container.querySelectorAll('button') : [];

        if (isDisabled) {
            // Lockdown: Matikan semua interaksi
            if(container) container.classList.add('disabled-mode');
            allButtons.forEach(btn => btn.disabled = true);
        } else {
            // Restore: Hidupkan kembali
            if(container) container.classList.remove('disabled-mode');
            // Aktifkan tombol kembali, TAPI perhatikan logika batas waktu (prev/next)
            // Kita panggil updateNavigationButtonsState untuk memastikan tombol yang seharusnya disabled (misal di ujung waktu) tetap disabled
            this.updateNavigationButtonsState(this._selectedTimeIndex);
            
            // Calendar btn selalu aktif jika tidak lockdown
            const calBtn = document.getElementById('calendar-btn');
            if(calBtn) calBtn.disabled = false;
        }
    },

    // ... (Fungsi Helper Date & Index SAMA) ...
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

    /** * [TAHAP D] Update UI Map (HTML Marker)
     * Menggunakan logika DOM Manipulation, bukan GL Feature State
     */
    updateMapFeaturesForTime: function(idxGlobal) {
        // Cukup panggil fungsi update di mapManager
        mapManager.updateAllMarkersForTime();
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