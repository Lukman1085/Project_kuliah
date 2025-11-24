import { utils } from "./utilities.js";
import { popupManager } from "./popup_manager.js";
import { timeManager } from "./time_manager.js";
import { mapManager } from "./map_manager.js";
import { cacheManager } from "./cache_manager.js"; 

/** ➡️ SIDEBAR MANAGER: Mengelola logika buka/tutup dan render sidebar */
export const sidebarManager = { 
    _isSidebarOpen: false,
    _subRegionData: null, 
    _observer: null, 

    // [STATE MANAGEMENT]
    _activeContentMode: 'weather', // 'weather' | 'gempa'
    _lastGempaData: null,          // Cache data gempa terakhir

    elements: {},

    initDOM: function(domElements) {
        this.elements = domElements;
        console.log("Elemen DOM Sidebar telah di-set di sidebarManager.");
        this._initIntersectionObserver();
    },

    _initIntersectionObserver: function() {
        const options = {
            root: this.elements.sidebarContentEl, 
            rootMargin: '50px', 
            threshold: 0.1
        };

        this._observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const target = entry.target;
                    const id = target.dataset.id;
                    if (id && !target.dataset.loaded) {
                        this._fetchSingleSubRegionWeather(id, target);
                        observer.unobserve(target);
                    }
                }
            });
        }, options);
    },

    _timeEl: null, _iconEl: null, _tempEl: null, _descEl: null,
    _feelsLikeEl: null, _humidityEl: null, _precipEl: null, _windEl: null,
    _dailyListEl: null,

    initWeatherElements: function(weatherElements) {
        this._timeEl = weatherElements.timeEl;
        this._iconEl = weatherElements.iconEl;
        this._tempEl = weatherElements.tempEl;
        this._descEl = weatherElements.descEl;
        this._feelsLikeEl = weatherElements.feelsLikeEl;
        this._humidityEl = weatherElements.humidityEl;
        this._precipEl = weatherElements.precipEl;
        this._windEl = weatherElements.windEl;
        this._dailyListEl = weatherElements.dailyListEl;
        console.log("Elemen Cuaca Sidebar telah di-set di sidebarManager.");
    },

    isOpen: function() {
        return this._isSidebarOpen;
    },

    openSidebar: function() {
        const { sidebarEl, toggleBtnEl } = this.elements;
        if (!sidebarEl || !toggleBtnEl || this._isSidebarOpen) return;
        
        sidebarEl.classList.add('sidebar-open');
        this._isSidebarOpen = true;
        toggleBtnEl.innerHTML = '&lt;';
        toggleBtnEl.setAttribute('aria-label', 'Tutup detail lokasi');
        
        this.renderSidebarContent(); 
        
        // Jika mode cuaca, pastikan highlight marker aktif kembali
        if (this._activeContentMode === 'weather') {
            const activeId = mapManager.getActiveLocationId();
            if(activeId) mapManager.setActiveMarkerHighlight(activeId); 
        }
    },

    closeSidebar: function() {
        const { sidebarEl, toggleBtnEl } = this.elements;
        if (!sidebarEl || !toggleBtnEl || !this._isSidebarOpen) return;
        
        sidebarEl.classList.remove('sidebar-open');
        this._isSidebarOpen = false;
        toggleBtnEl.innerHTML = '&gt;';
        toggleBtnEl.setAttribute('aria-label', 'Buka detail lokasi');
        
        const activeId = mapManager.getActiveLocationId();
        if (!activeId) { return } 
        
        mapManager.removeActiveMarkerHighlight(activeId, false); 
    },

    toggleSidebar: function() { 
        if (this._isSidebarOpen) this.closeSidebar(); else this.openSidebar(); 
    },

    openSidebarFromPopup: function() {
        const { sidebarContentEl } = this.elements;
        if (!this._isSidebarOpen) { this.openSidebar(); } 
        else { if (sidebarContentEl) sidebarContentEl.scrollTop = 0; }
        popupManager.close(true); 
    },

    /**
     * [FITUR BARU] Explicit Mode Switching (Dipanggil oleh Tombol Gempa / Map Manager)
     * @param {string} mode - 'weather' atau 'gempa'
     */
    switchToMode: function(mode) {
        if (mode !== 'weather' && mode !== 'gempa') return;
        
        console.log(`Sidebar switching mode to: ${mode}`);
        this._activeContentMode = mode;

        // Jika sidebar terbuka, render ulang konten sesuai mode baru
        if (this.isOpen()) {
            this.renderSidebarContent();
        }
    },

    resetContentMode: function() {
        this.switchToMode('weather');
    },

    _hideAllSidebarSections: function() {
        const { sidebarPlaceholderEl, sidebarLoadingEl, sidebarWeatherDetailsEl, sidebarProvinceDetailsEl, subRegionContainerEl, subRegionListEl } = this.elements;
        if (sidebarPlaceholderEl) sidebarPlaceholderEl.style.display = 'none';
        if (sidebarLoadingEl) sidebarLoadingEl.style.display = 'none';
        if (sidebarWeatherDetailsEl) sidebarWeatherDetailsEl.style.display = 'none';
        if (sidebarProvinceDetailsEl) sidebarProvinceDetailsEl.style.display = 'none';
        if (subRegionContainerEl) subRegionContainerEl.style.display = 'none';
        if (subRegionListEl) subRegionListEl.innerHTML = '';
        
        const gempaContainer = document.getElementById('sidebar-gempa-container');
        if (gempaContainer) {
            gempaContainer.style.display = 'none';
        }
    },

    _renderSidebarLoadingState: function() {
        const { sidebarLoadingEl, sidebarLocationNameEl } = this.elements;
        if (sidebarLoadingEl) sidebarLoadingEl.style.display = 'block';
        if (sidebarLocationNameEl) sidebarLocationNameEl.textContent = `Memuat ${mapManager.getActiveLocationSimpleName() || 'lokasi'}...`;
    },

    _renderSidebarPlaceholderState: function(customMessage = null) {
        const { sidebarPlaceholderEl, sidebarLocationNameEl } = this.elements;
        if (sidebarPlaceholderEl) {
            sidebarPlaceholderEl.textContent = customMessage || 'Pilih satu wilayah di peta.';
            sidebarPlaceholderEl.style.display = 'block';
        }
        if (sidebarLocationNameEl) sidebarLocationNameEl.textContent = 'Detail Lokasi';
    },

    _renderSidebarErrorState: function(message) {
        const { sidebarPlaceholderEl, sidebarLocationNameEl } = this.elements;
        if (sidebarPlaceholderEl) {
            sidebarPlaceholderEl.textContent = message || `Data tidak tersedia.`;
            sidebarPlaceholderEl.style.display = 'block';
        }
        if (sidebarLocationNameEl) {
            sidebarLocationNameEl.textContent = mapManager.getActiveLocationSimpleName() || 'Info';
        }
    },

    // [MODIFIKASI] Helper tombol Pindah Lokasi dengan Ikon Baru & Class CSS
    _createFlyToButton: function() {
        const btn = document.createElement('button');
        btn.className = 'sidebar-fly-btn'; // Class khusus untuk styling
        
        // Ikon: Pin Lokasi dengan Peta terlipat di bawahnya
        btn.innerHTML = `
            <svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="100%" viewBox="0 0 1024 1024" enable-background="new 0 0 1024 1024" xml:space="preserve">
            <path fill="none" stroke="#000000" stroke-width="20" opacity="1.000000" d="M152.368332,798.493469C134.708344,803.578796 117.434280,808.544800 100.172729,813.553955C97.013718,814.470764 93.969872,815.140015 91.441986,812.206543C88.876167,809.229126 90.296799,806.413879 91.569649,803.401855C122.817062,729.460999 153.393158,655.241638 183.708313,580.914612C193.204254,557.632324 202.670181,534.336548 211.910889,510.952484C213.935867,505.828125 217.507751,503.628571 222.471741,502.221832C258.009827,492.150421 293.501740,481.916290 329.013031,471.750214C336.368439,469.644531 343.802887,467.793274 351.086090,465.465576C355.128357,464.173645 358.831848,464.490082 362.793732,465.636414C376.221069,469.521332 389.706268,473.206207 403.170837,476.962311C404.094574,477.219971 405.016815,477.885254 406.612701,476.526154C402.636230,469.139984 398.500488,461.632782 394.526276,454.040985C385.193695,436.213287 374.121307,419.157867 368.514160,399.613342C356.646912,358.248291 361.412415,318.786713 383.902802,281.987183C406.008911,245.816452 437.923553,222.365280 479.385315,213.395874C529.696350,202.512100 574.907593,214.094498 613.850464,247.975464C640.350342,271.030884 656.254700,300.477478 661.878662,334.985016C666.555359,363.681122 663.559509,391.840027 650.444214,418.198639C641.171753,436.834076 631.112061,455.077759 621.405701,473.497284C620.872559,474.509186 620.357056,475.530396 619.532837,477.130676C624.485962,477.062500 628.601868,475.427917 632.768555,474.321075C643.542542,471.458984 654.266724,468.407562 664.991028,465.362030C668.137390,464.468506 671.174072,464.505219 674.318176,465.407959C714.786438,477.027130 755.145325,489.059998 795.821472,499.901642C807.199951,502.934418 813.168701,508.392151 817.466125,519.304565C836.805969,568.415100 856.977539,617.200500 877.098755,666.000244C895.886780,711.566345 914.989136,757.002808 933.954651,802.495789C934.275146,803.264648 934.661255,804.009399 934.935669,804.793823C935.829163,807.347534 936.663574,809.880737 934.459106,812.280029C932.194153,814.744934 929.498047,814.618469 926.634155,813.779419C914.499329,810.224426 902.373901,806.636902 890.228088,803.119751C837.966370,787.986023 785.694519,772.887512 733.443665,757.716736C730.284241,756.799438 727.381470,756.862305 724.206848,757.768738C656.213501,777.183594 588.187744,796.485107 520.201965,815.926270C515.355591,817.312195 510.887543,817.290894 506.047089,815.914246C448.920593,799.666992 391.754974,783.557251 334.602844,767.399963C323.716980,764.322449 312.815613,761.293579 301.983215,758.036499C298.325500,756.936584 294.898071,756.851318 291.241974,757.922058C259.144684,767.321899 227.021820,776.634277 194.913864,785.997620C180.853333,790.098022 166.809784,794.256714 152.368332,798.493469M408.113220,777.235535C441.017181,786.409119 473.921143,795.582764 506.692627,804.719421C508.067078,801.952637 507.642822,799.919067 507.643738,797.959167C507.661346,759.794373 507.641907,721.629639 507.634308,683.464844C507.633972,681.798889 507.555878,680.120972 507.722809,678.469727C508.004486,675.683472 509.491547,673.660522 512.369019,673.437134C515.452881,673.197693 517.415833,675.050537 518.100403,677.947754C518.475586,679.535767 518.324890,681.260071 518.325378,682.922913C518.336914,721.421021 518.321838,759.919128 518.380127,798.417175C518.383179,800.433899 517.481995,802.797119 519.910339,804.601379C524.888123,803.183716 529.976074,801.667969 535.100037,800.285645C596.314087,783.770752 657.137756,765.875000 718.135071,748.593506C721.558838,747.623474 723.037720,746.395386 722.034790,742.289551C719.471680,731.796326 717.588501,721.138672 715.342773,710.566040C700.800476,642.102661 686.241699,573.642761 671.666382,505.186462C669.667114,495.796112 667.545837,486.431793 665.488953,477.091705C664.226990,477.091705 663.539185,476.948303 662.935059,477.112640C646.558838,481.568207 630.191467,486.056305 613.821655,490.535706C611.759888,491.099884 610.425537,492.416779 609.417175,494.294250C606.186401,500.309662 602.887085,506.289062 599.550842,512.246826C573.585144,558.615479 546.861816,604.549438 520.151672,650.490417C515.601562,658.316467 510.086426,658.233459 505.633148,650.392822C476.344299,598.825500 445.756042,547.996643 417.709869,495.724121C416.103119,492.729492 413.993713,490.951355 410.614929,490.087463C399.656647,487.285583 388.770111,484.202118 377.862366,481.203918C372.284607,479.670746 366.720428,478.088287 360.959473,476.474670C358.653992,482.572388 358.182892,488.569519 356.948730,494.387329C347.392517,539.434937 337.868225,584.489319 328.275879,629.529175C320.207184,667.414856 312.137421,705.300781 303.839996,743.136536C302.915680,747.351379 304.933167,747.914429 307.923065,748.758972C341.074097,758.123230 374.207031,767.551697 408.113220,777.235535M414.894867,468.680328C446.365387,526.491882 479.145966,583.548462 513.032837,641.067017C523.221619,623.465576 532.657959,607.012451 542.237427,590.643005C573.533386,537.164490 603.847839,483.137909 633.062866,428.493835C642.294983,411.226044 650.034241,393.541534 652.050598,373.697571C654.547363,349.127197 651.891052,325.196106 641.132812,303.055145C617.276123,253.957092 577.957092,226.354095 523.261169,220.994980C502.383575,218.949417 482.138611,221.863312 463.067810,229.760178C412.056061,250.883163 381.462189,288.602966 374.092041,343.892731C371.297150,364.859741 373.734222,385.518463 381.832703,405.127563C390.877197,427.027313 403.491547,447.141266 414.894867,468.680328M685.662659,519.964233C689.024292,536.063660 692.338806,552.173157 695.755981,568.260803C707.874634,625.313721 720.116028,682.340881 732.024719,739.437561C733.141113,744.790039 735.346924,747.188721 740.521667,748.670349C793.144714,763.737610 845.690491,779.074951 898.272766,794.285217C905.516968,796.380737 912.842041,798.196655 920.937378,800.357666C919.994507,797.793701 919.481323,796.237366 918.857910,794.726501C907.301147,766.720032 895.669312,738.744324 884.176392,710.711670C857.716553,646.172729 831.312012,581.611145 804.948120,517.032959C804.045471,514.821899 802.898071,513.646057 800.511414,512.962219C765.493896,502.928589 730.526306,492.720764 695.509033,482.686462C689.676331,481.015106 683.993042,478.651245 677.087891,477.811554C679.950073,491.945648 682.703186,505.541199 685.662659,519.964233M315.661957,636.325134C326.841125,583.635498 338.020294,530.945862 349.362122,477.489624C346.467590,478.056824 344.989227,478.230011 343.579620,478.639679C304.600861,489.967773 265.635101,501.340668 226.642746,512.621582C224.010803,513.383057 222.424576,514.647034 221.367874,517.245483C208.950378,547.780579 196.459290,578.285828 183.921844,608.771912C158.594009,670.359253 133.219147,731.927124 107.902130,793.518921C107.060150,795.567261 105.384621,797.408386 105.676872,799.882507C107.483841,800.453796 108.840973,799.634216 110.221718,799.235291C123.167747,795.494995 136.092865,791.682373 149.036591,787.934021C195.219559,774.559937 241.383667,761.119263 287.630066,747.968140C292.263916,746.650452 292.891632,743.656677 293.659210,740.044067C300.945953,705.748962 308.256256,671.458923 315.661957,636.325134z"/>
            <path fill="none" stroke="#000000" stroke-width="20" opacity="1.000000" d="M444.913879,338.195190C456.206207,306.067261 484.404602,287.805176 519.305664,289.715240C548.767639,291.327637 575.826355,313.940308 582.549866,343.741669C594.058655,394.753662 554.595520,434.815552 509.516449,432.058777C461.473083,429.120758 431.252655,384.887421 444.913879,338.195190M453.355743,371.168365C461.112061,413.026764 505.803741,433.218201 541.947632,413.853546C565.904358,401.018372 576.089539,377.851471 573.317932,353.967468C569.238525,318.812714 539.179810,296.587006 503.652313,301.212708C470.821228,305.487305 447.348358,337.681732 453.355743,371.168365z"/>
            </svg>
        `;
        
        btn.title = "Pindahkan peta ke lokasi ini";
        btn.onclick = (e) => {
            e.stopPropagation();
            mapManager.flyToActiveLocation();
        };
        return btn;
    },

    _renderSidebarProvinceState: function() {
        const { sidebarProvinceDetailsEl, sidebarLocationNameEl } = this.elements;
        if (!sidebarProvinceDetailsEl || !sidebarLocationNameEl) return;

        // Pastikan mode sinkron
        this._activeContentMode = 'weather';

        const container = sidebarProvinceDetailsEl;
        container.innerHTML = ''; 
        
        // [PERBAIKAN TATA LETAK] Gunakan Wrapper CSS Class, bukan inline style
        sidebarLocationNameEl.innerHTML = '';
        
        const headerWrapper = document.createElement('div');
        headerWrapper.className = 'sidebar-title-wrapper'; // Gunakan Class CSS
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'sidebar-title-text'; // Gunakan Class CSS
        nameSpan.textContent = mapManager.getActiveLocationSimpleName();
        
        const flyToBtn = this._createFlyToButton();
        
        headerWrapper.appendChild(nameSpan);
        headerWrapper.appendChild(flyToBtn);
        
        sidebarLocationNameEl.appendChild(headerWrapper);


        const now = new Date();
        const formattedDate = now.toLocaleDateString('id-ID', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        const svgPin = `
            <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
        `;

        const cardHTML = `
            <div class="location-label-subtitle">
                ${mapManager.getActiveLocationLabel()}
            </div>
            
            <div class="weather-card-main" style="background: linear-gradient(135deg, #455A64 0%, #263238 100%); margin-bottom: 24px;">
                <div class="weather-header-time">${formattedDate}</div>
                
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 0;">
                    <div style="width: 70px; height: 70px; border-radius: 50%; background: rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; margin-bottom: 10px; color: white;">
                        ${svgPin}
                    </div>
                    <div style="font-size: 1.3rem; font-weight: 700;">PROVINSI</div>
                    <div style="font-size: 0.85rem; opacity: 0.8; margin-top: 5px;">Wilayah Administratif Tingkat I</div>
                </div>

                <div style="margin-top: 15px; text-align: center; font-size: 0.75rem; opacity: 0.8; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.2);">
                    Data Batas Wilayah: <strong>Badan Informasi Geospasial</strong><br>
                    Data Cuaca Sub-Wilayah: <strong>Open-Meteo</strong><br>
                    Selalu pantau informasi resmi dari otoritas setempat.
                </div>
            </div>
        `;
        
        container.innerHTML = cardHTML;
        container.style.display = 'block';

        const activeData = mapManager.getActiveLocationData();
        this._subRegionData = null;
        this._fetchAndRenderSubRegions(activeData);
    },

    _createDailyForecastItem: function(date, code, maxT, minT, timeZone) {
        const { deskripsi, ikon } = utils.getWeatherInfo(code, 1);
        const item = document.createElement('div');
        item.className = 'daily-forecast-item';
        const daySpan = document.createElement('span');
        daySpan.className = 'daily-day';
        daySpan.textContent = utils.formatDayOnly(date, timeZone);
        const iconEl = document.createElement('i');
        iconEl.className = `daily-icon ${ikon}`;
        const descSpan = document.createElement('span');
        descSpan.className = 'daily-desc';
        descSpan.textContent = deskripsi;
        const tempSpan = document.createElement('span');
        tempSpan.className = 'daily-temp';
        tempSpan.textContent = `${maxT.toFixed(1)}° / ${minT.toFixed(1)}°`;
        item.appendChild(daySpan);
        item.appendChild(iconEl);
        item.appendChild(descSpan);
        item.appendChild(tempSpan);
        return item;
    },

    _renderSidebarWeatherState: function() {
        const { sidebarWeatherDetailsEl, sidebarLocationNameEl, sidebarEl } = this.elements;
        if (!sidebarWeatherDetailsEl || !sidebarLocationNameEl || !sidebarEl) return;
        
        // Pastikan mode sinkron
        this._activeContentMode = 'weather';

        const activeData = mapManager.getActiveLocationData();
        if (!activeData) {
            this._renderSidebarErrorState("Data lokasi aktif tidak ditemukan.");
            return;
        }

        sidebarWeatherDetailsEl.style.display = 'block';
        
        // [PERBAIKAN TATA LETAK] Gunakan Wrapper CSS Class, bukan inline style
        sidebarLocationNameEl.innerHTML = '';
        
        const headerWrapper = document.createElement('div');
        headerWrapper.className = 'sidebar-title-wrapper'; // Class CSS
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'sidebar-title-text'; // Class CSS
        nameSpan.textContent = mapManager.getActiveLocationSimpleName();
        
        const flyToBtn = this._createFlyToButton();
        
        headerWrapper.appendChild(nameSpan);
        headerWrapper.appendChild(flyToBtn);
        
        sidebarLocationNameEl.appendChild(headerWrapper);

        const labelEl = sidebarEl.querySelector('#sidebar-location-label-weather');
        if (labelEl) labelEl.textContent = mapManager.getActiveLocationLabel();

        const isProvinsi = (activeData.tipadm === 1);
        const currentConditionsEl = sidebarEl.querySelector('#sidebar-current-conditions');
        const dailyForecastTitleEl = sidebarEl.querySelector('#sidebar-daily-forecast-title');
        const dailyForecastListEl = sidebarEl.querySelector('#sidebar-daily-forecast-list');

        if (isProvinsi) {
            if (currentConditionsEl) currentConditionsEl.style.display = 'none';
            if (dailyForecastTitleEl) dailyForecastTitleEl.style.display = 'none';
            if (dailyForecastListEl) dailyForecastListEl.style.display = 'none';
            
            this._subRegionData = null;
            this._fetchAndRenderSubRegions(activeData);
            return; 
        } 
        
        if (currentConditionsEl) currentConditionsEl.style.display = 'block'; 
        if (dailyForecastTitleEl) dailyForecastTitleEl.style.display = 'block';
        if (dailyForecastListEl) dailyForecastListEl.style.display = 'flex';

        const daily = activeData.daily;
        const timeZone = activeData.timezone;
        const listContainer = this._dailyListEl;
        
        if (listContainer) {
            listContainer.innerHTML = ''; 
            if (daily?.time) {
                 const endIndex = Math.min(7, daily.time.length);
                 const fragment = document.createDocumentFragment();
                 for (let i = 0; i < endIndex; i++) {
                     const date = daily.time[i], code = daily.weather_code?.[i], maxT = daily.temperature_2m_max?.[i], minT = daily.temperature_2m_min?.[i];
                     if (date === undefined) continue;
                     const itemEl = this._createDailyForecastItem(date, code, maxT, minT, timeZone);
                     fragment.appendChild(itemEl);
                 }
                 listContainer.appendChild(fragment);
            } else { 
                const p = document.createElement('p'); p.textContent = 'Data harian tidak tersedia.'; listContainer.appendChild(p);
            }
        }

        const idx = timeManager.getSelectedTimeIndex();
        const lookup = timeManager.getGlobalTimeLookup();
        
        if (idx >= 0 && idx < lookup.length) {
            const timeStr = lookup[idx];
            this.updateUIForTime(idx, timeStr, activeData);
        } else {
            this.updateCurrentConditions(null, null, null);
        }
        
        this._subRegionData = null; 
        this._fetchAndRenderSubRegions(activeData); 
    },

    _fetchAndRenderSubRegions: async function(activeData) {
        const { subRegionContainerEl, subRegionLoadingEl, subRegionListEl, subRegionTitleEl } = this.elements;
        
        if (!activeData || !activeData.id) {
            return; 
        }

        const tipadm = Number(activeData.tipadm);
        if (tipadm >= 4) {
            if (subRegionContainerEl) subRegionContainerEl.style.display = 'none';
            return; 
        }

        if (subRegionContainerEl) subRegionContainerEl.style.display = 'block';
        if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'block';
        if (subRegionListEl) subRegionListEl.innerHTML = '';

        const titles = { 1: "Kab/Kota", 2: "Kecamatan", 3: "Kel/Desa" };
        const titleKey = tipadm; 
        if (subRegionTitleEl) subRegionTitleEl.textContent = `Prakiraan per ${titles[titleKey] || 'Wilayah Bawahan'}`;

        try {
            const protocol = window.location.protocol;
            const hostname = window.location.hostname;
            const port = '5000';
            const baseUrl = `${protocol}//${hostname}:${port}`;
            
            const url = `${baseUrl}/api/sub-wilayah-cuaca?id=${encodeURIComponent(activeData.id)}&tipadm=${tipadm}&view=simple`;

            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
            
            const simpleData = await resp.json();
            this._subRegionData = simpleData; 

            if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'none';

            if (!simpleData || simpleData.length === 0) {
                if (subRegionTitleEl) subRegionTitleEl.textContent = `Tidak ada data ${titles[titleKey] || 'sub-wilayah'}`;
                if (subRegionListEl) subRegionListEl.innerHTML = '<div style="padding:10px; text-align:center; color:#777;">Data sub-wilayah tidak tersedia.</div>';
                return;
            }
            
            this._renderSubRegionListSkeleton(simpleData);

            if (timeManager.getGlobalTimeLookup().length === 0 && simpleData.length > 0) {
                const firstId = simpleData[0].id;
                const firstEl = document.getElementById(`sub-region-${firstId}`);
                if (firstEl) {
                    this._fetchSingleSubRegionWeather(firstId, firstEl);
                }
            }

        } catch (e) {
            console.error("Gagal fetch sub-wilayah:", e);
            if (subRegionLoadingEl) subRegionLoadingEl.style.display = 'none';
            if (subRegionTitleEl) subRegionTitleEl.textContent = "Gagal memuat data";
            
            // [IMPLEMENTASI BARU] Error Card State
            if (subRegionListEl) {
                subRegionListEl.innerHTML = `
                    <div class="error-state-card">
                        <i class="wi wi-cloud-refresh error-state-icon"></i>
                        <div>
                            <strong>Gagal Memuat Data</strong><br>
                            <span style="font-size:0.8rem; opacity:0.8;">${e.message}</span>
                        </div>
                    </div>
                `;
            }
        }
    },

    _renderSubRegionListSkeleton: function(simpleData) {
        const { subRegionListEl } = this.elements;
        if (!subRegionListEl) return;
        
        subRegionListEl.innerHTML = ''; 
        const fragment = document.createDocumentFragment();
        
        simpleData.forEach(item => {
            const div = document.createElement('div');
            div.className = 'sub-region-item skeleton-mode'; 
            div.id = `sub-region-${item.id}`;
            div.dataset.id = item.id; 
            
            const cached = cacheManager.get(item.id);
            if (cached) {
                this._fillSubRegionItem(div, cached);
                div.dataset.loaded = "true";
            } else {
                div.innerHTML = `
                    <div class="sub-region-info-col">
                        <span class="sub-region-item-name">${item.nama_simpel}</span>
                        <span class="sub-region-item-desc skeleton-loading"></span>
                    </div>
                    <i class="sub-region-item-icon skeleton-loading"></i>
                    <span class="sub-region-item-temp skeleton-loading"></span>
                `;
                if (this._observer) {
                    this._observer.observe(div);
                }
            }
            
            fragment.appendChild(div);
        });
        
        subRegionListEl.appendChild(fragment);
    },

    _fetchSingleSubRegionWeather: async function(id, element) {
        const cached = cacheManager.get(id);
        if (cached) {
            this._fillSubRegionItem(element, cached);
            element.dataset.loaded = "true";
            return;
        }

        try {
            const protocol = window.location.protocol;
            const hostname = window.location.hostname;
            const port = '5000';
            const baseUrl = `${protocol}//${hostname}:${port}`;
            
            const resp = await fetch(`${baseUrl}/api/data-by-ids?ids=${id}`);
            if (!resp.ok) throw new Error("Err");
            
            const dataMap = await resp.json();
            const data = dataMap[id];
            
            if (data) {
                cacheManager.set(id, data);
                if (timeManager.getGlobalTimeLookup().length === 0 && data.hourly?.time) {
                     timeManager.setGlobalTimeLookup(data.hourly.time);
                     timeManager.initializeOrSync(new Date(data.hourly.time[0]));
                }
                this._fillSubRegionItem(element, data);
                element.dataset.loaded = "true";
            }
        } catch (e) {
            console.warn(`Lazy load failed for ${id}`, e);
            const descEl = element.querySelector('.sub-region-item-desc');
            if (descEl) {
                descEl.classList.remove('skeleton-loading');
                descEl.textContent = "Gagal";
                descEl.style.color = "red";
            }
        }
    },

    _fillSubRegionItem: function(element, data) {
        const timeIndex = timeManager.getSelectedTimeIndex();
        if (!data.hourly || timeIndex < 0) return;

        element.classList.remove('skeleton-mode');
        
        const dataPoint = {
            is_day: data.hourly.is_day?.[timeIndex],
            weather_code: data.hourly.weather_code?.[timeIndex],
            suhu: data.hourly.temperature_2m?.[timeIndex],
        };
        const { deskripsi, ikon } = utils.getWeatherInfo(dataPoint.weather_code, dataPoint.is_day);

        element.innerHTML = `
            <div class="sub-region-info-col">
                <span class="sub-region-item-name">${data.nama_simpel || 'N/A'}</span>
                <span class="sub-region-item-desc">${deskripsi}</span>
            </div>
            <i class="sub-region-item-icon ${ikon}"></i>
            <span class="sub-region-item-temp">${dataPoint.suhu?.toFixed(1) ?? '-'}°C</span>
        `;
    },

    _renderSubRegionList: function(timeIndex) {
        const { subRegionListEl } = this.elements;
        if (!subRegionListEl) return;

        const items = subRegionListEl.querySelectorAll('.sub-region-item');
        items.forEach(item => {
            if (item.dataset.loaded === "true") {
                const id = item.dataset.id;
                const data = cacheManager.get(id);
                if (data) {
                    this._fillSubRegionItem(item, data);
                }
            }
        });
    },

    renderSidebarContent: function() {
        const { sidebarContentEl, sidebarLocationNameEl, sidebarEl } = this.elements;
        
        if (!this._isSidebarOpen || !sidebarContentEl) { return; }
        
        this._hideAllSidebarSections(); 

        // [LOGIKA BARU] Branching berdasarkan Mode
        
        // MODE GEMPA
        if (this._activeContentMode === 'gempa') {
            // [PERBAIKAN TATA LETAK] Gunakan Wrapper CSS Class
            this.elements.sidebarLocationNameEl.innerHTML = '';
            
            const headerWrapper = document.createElement('div');
            headerWrapper.className = 'sidebar-title-wrapper';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'sidebar-title-text';
            nameSpan.textContent = 'Info Gempa';
            
            const flyToBtn = this._createFlyToButton();
            
            headerWrapper.appendChild(nameSpan);
            headerWrapper.appendChild(flyToBtn);
            
            this.elements.sidebarLocationNameEl.appendChild(headerWrapper);

            const lblWeather = sidebarEl.querySelector('#sidebar-location-label-weather');
            if (lblWeather) lblWeather.textContent = '';

            if (this._lastGempaData) {
                // Render data gempa terakhir
                this.renderSidebarGempa(this._lastGempaData);
            } else {
                // Placeholder Gempa
                this._renderSidebarPlaceholderState("Mode Gempa Aktif. Pilih titik gempa di peta untuk detail.");
            }
            return;
        }

        // MODE CUACA (Default)
        if (sidebarLocationNameEl) sidebarLocationNameEl.textContent = 'Detail Lokasi'; 
        const lblWeather = sidebarEl.querySelector('#sidebar-location-label-weather');
        const lblProvince = sidebarEl.querySelector('#sidebar-location-label-province');
        if (lblWeather) lblWeather.textContent = '';
        if (lblProvince) lblProvince.textContent = '';
        
        if (mapManager.getIsClickLoading()) { 
            this._renderSidebarLoadingState();
        } else if (!mapManager.getActiveLocationId()) { 
            this._renderSidebarPlaceholderState();
        } else if (mapManager.getActiveLocationData()?.type === 'provinsi') { 
            this._renderSidebarProvinceState();
        } else if (mapManager.getActiveLocationData()?.hourly && timeManager.getGlobalTimeLookup().length > 0) { 
            this._renderSidebarWeatherState();
        } else if (mapManager.getActiveLocationId()) { 
            const msg = (timeManager.getGlobalTimeLookup().length > 0) 
                ? `Data cuaca untuk ${mapManager.getActiveLocationLabel()} tidak lengkap atau rusak.`
                : `Data cuaca untuk ${mapManager.getActiveLocationLabel()} belum dimuat.`; 
            this._renderSidebarErrorState(msg);
        } else { 
            this._renderSidebarErrorState('Terjadi kesalahan.');
        }
    },

    updateCurrentConditions: function(dataPoint, formattedTime, weatherInfo) {
        if (dataPoint && formattedTime && weatherInfo) {
            if (this._timeEl) this._timeEl.textContent = formattedTime;
            if (this._iconEl) this._iconEl.className = weatherInfo.ikon;
            if (this._tempEl) this._tempEl.textContent = `${dataPoint.suhu?.toFixed(1) ?? '-'}°C`;
            if (this._descEl) this._descEl.textContent = weatherInfo.deskripsi;
            if (this._feelsLikeEl) this._feelsLikeEl.textContent = `Terasa ${dataPoint.terasa?.toFixed(1) ?? '-'}°C`;
            if (this._humidityEl) this._humidityEl.textContent = `Kelembapan: ${dataPoint.kelembapan ?? '-'}%`;
            if (this._precipEl) this._precipEl.textContent = `Presipitasi: ${dataPoint.prob_presipitasi ?? '-'}%`;
            if (this._windEl) this._windEl.textContent = `Angin: ${dataPoint.kecepatan_angin_10m ?? '-'} m/s dari arah ${dataPoint.arah_angin_10m ?? '-'}°`;
        } else {
            if (this._timeEl) this._timeEl.textContent = '...';
            if (this._iconEl) this._iconEl.className = 'wi wi-na';
            if (this._tempEl) this._tempEl.textContent = '-°C';
            if (this._descEl) this._descEl.textContent = '...';
            if (this._feelsLikeEl) this._feelsLikeEl.textContent = 'Terasa ...°C';
            if (this._humidityEl) this._humidityEl.textContent = 'Kelembapan: ...%';
            if (this._precipEl) this._precipEl.textContent = 'Presipitasi: ...%';
            if (this._windEl) this._windEl.textContent = 'Angin: ... m/s';
        }
    },

    updateUIForTime: function(idxGlobal, localTimeString, activeData) {
        if (!this._isSidebarOpen) {
            return;
        }
        
        // Jangan update UI jika sedang di mode gempa
        if (this._activeContentMode === 'gempa') return;

        if (activeData && activeData.hourly?.time) {
            try {
                const hourly = activeData.hourly;
                if (idxGlobal >= hourly.time.length) {
                    this._renderSubRegionList(idxGlobal);
                    return;
                }
                const formattedTime = utils.formatLocalTimestampString(localTimeString); 
                const dataPoint = utils.extractHourlyDataPoint(hourly, idxGlobal);
                const { deskripsi, ikon } = utils.getWeatherInfo(dataPoint.weather_code, dataPoint.is_day); 
                this.updateCurrentConditions(dataPoint, formattedTime, { deskripsi, ikon });
            } catch (e) { 
                console.warn("Error updating sidebar DOM:", e); 
            }
        }

        this._renderSubRegionList(idxGlobal);
    },

    renderSidebarGempa: function(gempaData) {
        if (!this.elements.sidebarContentEl) return;
        
        // Update State Internal
        this._activeContentMode = 'gempa';
        this._lastGempaData = gempaData;

        this._hideAllSidebarSections();
        
        // [PERBAIKAN TATA LETAK] Header dengan tombol FlyTo untuk Gempa
        this.elements.sidebarLocationNameEl.innerHTML = '';
        
        const headerWrapper = document.createElement('div');
        headerWrapper.className = 'sidebar-title-wrapper'; // Class CSS
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'sidebar-title-text'; // Class CSS
        nameSpan.textContent = 'Detail Gempa Bumi';
        
        const flyToBtn = this._createFlyToButton();
        
        headerWrapper.appendChild(nameSpan);
        headerWrapper.appendChild(flyToBtn);
        
        this.elements.sidebarLocationNameEl.appendChild(headerWrapper);

        this.elements.sidebarEl.querySelector('#sidebar-location-label-weather').textContent = '';
        
        let gempaContainer = document.getElementById('sidebar-gempa-container');
        if (!gempaContainer) {
            gempaContainer = document.createElement('div');
            gempaContainer.id = 'sidebar-gempa-container';
            this.elements.sidebarContentEl.appendChild(gempaContainer);
        }
        gempaContainer.style.display = 'block';
        
        const dateObj = new Date(gempaData.time);
        const formattedTime = dateObj.toLocaleDateString('id-ID', { 
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', 
            hour: '2-digit', minute: '2-digit' 
        }) + ' WIB';

        let themeClass = 'gempa-card-safe'; 
        const color = gempaData.status_color || '';
        
        if (color.toLowerCase().includes('d32f2f') || color.toLowerCase().includes('e53935') || gempaData.tsunami) {
            themeClass = 'gempa-card-danger'; 
        } else if (color.toLowerCase().includes('ffc107') || color.toLowerCase().includes('orange')) {
            themeClass = 'gempa-card-warning'; 
        }

        const isTsunami = gempaData.tsunami;
        const statusLabel = gempaData.status_label || (isTsunami ? "POTENSI TSUNAMI" : "INFO GEMPA");
        const sourceName = gempaData.source ? gempaData.source.toUpperCase() : 'BMKG';

        gempaContainer.innerHTML = `
            <!-- Kartu Informasi Gempa -->
            <div class="weather-card-main ${themeClass}" style="margin-bottom: 24px;">
                
                <div class="weather-header-time">${formattedTime}</div>
                
                <div style="font-size: 1.2rem; font-weight: 700; line-height: 1.3; margin-bottom: 15px; opacity: 0.95;">
                    ${gempaData.place}
                </div>

                ${isTsunami ? `
                <div style="background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.5); padding:8px; border-radius:8px; margin-bottom:15px; text-align:center; font-weight:800; color:#fff; display:flex; align-items:center; justify-content:center; gap:8px;">
                    <i class="wi wi-tsunami" style="font-size:1.4rem;"></i> BERPOTENSI TSUNAMI
                </div>` : ''}
                
                <div class="weather-main-row">
                    <div class="weather-temp-big">
                        ${gempaData.mag.toFixed(1)}<span style="font-size:0.5em; opacity:0.8; font-weight:600; margin-left:5px;">M</span>
                    </div>
                    <div class="weather-icon-container">
                        <i class="wi wi-earthquake weather-icon-big"></i>
                    </div>
                </div>
                
                <div class="weather-desc-main" style="margin-bottom:20px; font-size:1.2rem;">
                    ${statusLabel}
                </div>

                <div class="weather-details-grid">
                    <div class="detail-item">
                        <i class="wi wi-direction-down detail-icon"></i>
                        <span>${gempaData.depth}</span>
                    </div>
                    <div class="detail-item">
                        <i class="wi wi-alien detail-icon"></i> 
                        <span>MMI ${gempaData.mmi || '-'}</span>
                    </div>
                    <div class="detail-item" style="grid-column: span 2; display: flex; align-items: flex-start;">
                        <i class="wi wi-info detail-icon" style="margin-top:2px;"></i>
                        <span style="font-size:0.9rem; line-height:1.4;">${gempaData.status_desc || 'Tidak ada data dampak.'}</span>
                    </div>
                </div>

                <div style="margin-top: 20px; text-align: center; font-size: 0.8rem; opacity: 0.8; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2);">
                    Data Batas Wilayah: <strong>Badan Informasi Geospasial</strong><br>
                    Data cuaca bersumber dari <strong>${sourceName}</strong>.<br>
                    Selalu pantau informasi resmi dari otoritas setempat.
                </div>
            </div>
        `;
    }
};