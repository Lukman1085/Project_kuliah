import { timeManager } from "./time_manager.js";

/** 🗓️ CALENDAR MANAGER: Mengelola semua logika kalender */
export const calendarManager = { 
    _displayMonth: new Date().getMonth(),
    _displayYear: new Date().getFullYear(),

    // FUNGSI BARU: Tempat menyimpan referensi elemen DOM
    elements: {},

    // FUNGSI BARU: Dipanggil oleh main.js untuk 'menyuntikkan' elemen DOM
    initDOM: function(domElements) {
        this.elements = domElements;
        // domElements: { calendarPopup, calendarGrid, calendarMonthYear }
        console.log("Elemen DOM Kalender telah di-set.");
    },

    toggleCalendar: function() {
        // Ambil elemen dari 'this.elements'
        const { calendarPopup } = this.elements;
        if (!calendarPopup) {
            console.error("calendarPopup belum di-init di calendarManager.");
            return;
        }

        const isOpen = calendarPopup.style.display === 'block';
        if (isOpen) {
            calendarPopup.style.display = 'none';
        } else {
            this.renderCalendar(); 
            calendarPopup.style.display = 'block';
        }
    },
    
    renderCalendar: function() {
            // Ambil elemen dari 'this.elements'
            const { calendarGrid, calendarMonthYear } = this.elements;
            if (!calendarGrid || !calendarMonthYear) {
                 console.error("calendarGrid atau calendarMonthYear belum di-init.");
                return;
            }

            const predictedStartDate = timeManager.getPredictedStartDate();
            if (!predictedStartDate) {
                calendarGrid.innerHTML = '<div style="grid-column: span 7; color: #f00; padding: 10px; text-align: center;">Error: Tanggal awal prediksi belum siap.</div>';
                return;
            }
            const displayMonth = this._displayMonth;
            const displayYear = this._displayYear;
            const displayDate = new Date(displayYear, displayMonth, 1);
            calendarMonthYear.textContent = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(displayDate);
            calendarGrid.innerHTML = '';
            this._buildCalendarHeaders();
            this._buildCalendarGrid();
    },

    _buildCalendarHeaders: function() {
            const { calendarGrid } = this.elements; // Ambil dari elements
            if (!calendarGrid) return;

            const daysHeader = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
            daysHeader.forEach(day => { 
                const h = document.createElement('div'); 
                h.className = 'calendar-day-header'; 
                h.textContent = day; 
                calendarGrid.appendChild(h); 
            });
    },

    _buildCalendarGrid: function() {
            const { calendarGrid } = this.elements; // Ambil dari elements
            if (!calendarGrid) return;

            const displayMonth = this._displayMonth;
            const displayYear = this._displayYear;
            const lookup = timeManager.getGlobalTimeLookup();
            const predictedStartDate = timeManager.getPredictedStartDate();
            const selectedTimeIndex = timeManager.getSelectedTimeIndex();
            const useRealData = lookup.length > 0;
            const getLocalDateString = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const startDate = useRealData ? new Date(lookup[0].split('T')[0] + "T00:00:00") : new Date(predictedStartDate);
            const endDate = useRealData ? new Date(lookup[lookup.length - 1].split('T')[0] + "T00:00:00") : new Date(predictedStartDate);
            
            if (!useRealData) {
                endDate.setHours(endDate.getHours() + 335); 
            }
            const startDateStr = getLocalDateString(startDate);
            const endDateStr = getLocalDateString(endDate);
            let selectedDateStr;
            if (useRealData && selectedTimeIndex >= 0 && selectedTimeIndex < lookup.length) {
                selectedDateStr = lookup[selectedTimeIndex].split('T')[0];
            } else {
                const predDate = timeManager.getPredictedDateFromIndex(selectedTimeIndex);
                selectedDateStr = predDate ? getLocalDateString(predDate) : null;
            }
            const todayStr = getLocalDateString(new Date());
            const firstOfMonth = new Date(displayYear, displayMonth, 1);
            const dayOfWeek = firstOfMonth.getDay(); 
            const lastDayPrevMonth = new Date(displayYear, displayMonth, 0).getDate();
            const fragment = document.createDocumentFragment();
            for (let i = dayOfWeek - 1; i >= 0; i--) {
                const day = lastDayPrevMonth - i;
                const cell = document.createElement('div');
                cell.className = 'calendar-date other-month disabled';
                cell.textContent = day;
                fragment.appendChild(cell);
            }
            const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = `${displayYear}-${String(displayMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dateButton = this._createCalendarCell(day, dateStr, startDateStr, endDateStr, todayStr, selectedDateStr, lookup, useRealData, predictedStartDate);
                fragment.appendChild(dateButton);
            }
            const totalCells = dayOfWeek + daysInMonth;
            const remainingCells = Math.max(0, (7 * 6) - totalCells); 
            for (let day = 1; day <= remainingCells; day++) {
                const cell = document.createElement('div');
                cell.className = 'calendar-date other-month disabled';
                cell.textContent = day;
                fragment.appendChild(cell);
                if (fragment.children.length >= 42) break;
            }
            calendarGrid.appendChild(fragment);
    },

    _createCalendarCell: function(day, dateStr, startDateStr, endDateStr, todayStr, selectedDateStr, lookup, useRealData, predictedStartDate) {
        // Fungsi ini tidak memiliki dependensi DOM global, jadi aman.
        const dateButton = document.createElement('button');
        dateButton.className = 'calendar-date';
        dateButton.textContent = day;
        if (dateStr >= startDateStr && dateStr <= endDateStr) {
            let targetIndex = -1;
            if (useRealData) {
                targetIndex = lookup.indexOf(`${dateStr}T12:00`);
                if (targetIndex === -1) targetIndex = lookup.indexOf(`${dateStr}T00:00`);
                if (targetIndex === -1) targetIndex = lookup.findIndex(ts => ts.startsWith(dateStr));
            } else {
                const dateForIndex = new Date(dateStr + "T12:00:00"); 
                const diffHours = Math.round((dateForIndex.getTime() - predictedStartDate.getTime()) / (1000 * 60 * 60));
                targetIndex = diffHours;
            }
            if (targetIndex >= 0 && targetIndex < 336) { 
                dateButton.dataset.index = targetIndex; 
                dateButton.addEventListener('click', (e) => { // Menggunakan addEventListener
                    e.stopPropagation(); 
                    this.handleCalendarDateClick(targetIndex); 
                });
            } else {
                dateButton.classList.add('disabled'); 
                dateButton.disabled = true;
            }
            if (dateStr === todayStr) {
                dateButton.classList.add('today');
            }
            if (selectedDateStr && dateStr === selectedDateStr) {
                dateButton.classList.add('selected');
            }
        } else {
            dateButton.classList.add('disabled');
            dateButton.disabled = true;
        }
        return dateButton;
    },

    handleCalendarDateClick: function(targetIndex) {
        // Fungsi ini aman
        console.log("Calendar date clicked, target index (predicted for ~12:00):", targetIndex);
        const currentHourInDay = timeManager.getSelectedTimeIndex() >= 0 ? (timeManager.getSelectedTimeIndex() % 24) : new Date().getHours(); 
        const targetDayIndex = Math.floor(targetIndex / 24); 
        const newIndex = (targetDayIndex * 24) + currentHourInDay;
        
        this.toggleCalendar(); // Panggil metode internal
        
        timeManager.handleTimeChange(newIndex); 
    },

    changeCalendarMonth: function(direction) {
        // Fungsi ini aman
        let newMonth = this._displayMonth + direction;
        let newYear = this._displayYear;
        if (newMonth < 0) {
            newMonth = 11; newYear--;
        } else if (newMonth > 11) {
            newMonth = 0; newYear++;
        }
        this._displayMonth = newMonth;
        this._displayYear = newYear;
        this.renderCalendar(); 
    }
};