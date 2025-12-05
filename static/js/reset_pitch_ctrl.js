/**
    * @class ResetPitchControl
    * Kontrol kustom MapLibre untuk menambahkan tombol yang me-reset pitch (kemiringan) peta.
    */
export class ResetPitchControl {
    // (Tidak ada perubahan)
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const button = document.createElement('button');
        button.type = 'button';
        button.title = 'Reset pitch (Tampilan atas)';
        button.className = 'maplibregl-ctrl-pitch-reset'; 
        button.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display: block; margin: auto;">
            <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"></path>
            <line x1="8" y1="2" x2="8" y2="18"></line>
            <line x1="16" y1="2" x2="16" y2="18"></line>
            </svg>
        `;
        button.onclick = (e) => {
            e.stopPropagation();
            this._map.easeTo({ pitch: 0 });
        };
        this._container.appendChild(button);
        return this._container;
    }
    onRemove() {
        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._map = undefined;
    }
}
