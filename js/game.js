import { Maze }   from './maze.js';
import { Player } from './player.js';

const KEY_DIR = {
  ArrowUp:    'N', KeyW: 'N',
  ArrowRight: 'E', KeyD: 'E',
  ArrowDown:  'S', KeyS: 'S',
  ArrowLeft:  'W', KeyA: 'W',
};

const FOG_COLOR = '13,13,26';

class Game {
  constructor() {
    this.canvas   = document.getElementById('maze-canvas');
    this.ctx      = this.canvas.getContext('2d');
    this.overlay  = document.getElementById('overlay');
    this.msgEl    = document.getElementById('overlay-msg');
    this.timerEl  = document.getElementById('timer');
    this.sizeInfo = document.getElementById('size-info');
    this._wrap    = document.getElementById('canvas-wrap');

    this._heldDirs = new Set();

    this._sliders = {
      cols: { input: document.getElementById('inp-cols'), display: document.getElementById('val-cols') },
      rows: { input: document.getElementById('inp-rows'), display: document.getElementById('val-rows') },
      cell: { input: document.getElementById('inp-cell'), display: document.getElementById('val-cell') },
      fog:  { input: document.getElementById('inp-fog'),  display: document.getElementById('val-fog')  },
      fade: { input: document.getElementById('inp-fade'), display: document.getElementById('val-fade') },
    };

    for (const [key, { input, display }] of Object.entries(this._sliders)) {
      input.addEventListener('input', () => {
        display.textContent = input.value;
        this._updateSizeInfo();
      });
      if (key === 'cols' || key === 'rows' || key === 'cell') {
        input.addEventListener('change', () => this._startNew());
      }
    }

    this._won          = false;
    this._startT       = null;
    this._rafId        = null;
    this._showSolution = false;

    this._btnSolution = document.getElementById('btn-solution');
    this._btnSolution.addEventListener('click', () => {
      this._showSolution = !this._showSolution;
      this._btnSolution.setAttribute('aria-pressed', this._showSolution);
      this._btnSolution.textContent = this._showSolution ? 'Lösung verbergen' : 'Lösung zeigen';
    });

    document.getElementById('btn-new').addEventListener('click', () => this._startNew());

    window.addEventListener('keydown', e => {
      const dir = KEY_DIR[e.code];
      if (!dir) return;
      e.preventDefault();
      this._heldDirs.add(dir);
    });
    window.addEventListener('keyup',  e => { const d = KEY_DIR[e.code]; if (d) this._heldDirs.delete(d); });
    window.addEventListener('blur',   () => this._heldDirs.clear());

    new ResizeObserver(() => this._fitCanvas()).observe(this._wrap);

    this._startNew();
  }

  _settings() {
    return {
      cols: parseInt(this._sliders.cols.input.value, 10),
      rows: parseInt(this._sliders.rows.input.value, 10),
      cell: parseInt(this._sliders.cell.input.value, 10),
      fog:  parseInt(this._sliders.fog.input.value,  10),
      fade: parseInt(this._sliders.fade.input.value, 10),
    };
  }

  _updateSizeInfo() {
    const { cols, rows, cell } = this._settings();
    this.sizeInfo.textContent = `Labyrinth ${cols * cell} × ${rows * cell} px`;
  }

  _fitCanvas() {
    const w = Math.floor(this._wrap.clientWidth  * 0.9);
    const h = Math.floor(this._wrap.clientHeight * 0.9);
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width  = w;
    this.canvas.height = h;
  }

  _startNew() {
    this.overlay.classList.add('hidden');
    this._won    = false;
    this._startT = performance.now();
    this._heldDirs.clear();

    this._fitCanvas();
    this._updateSizeInfo();

    const { cols, rows, cell } = this._settings();
    this.maze   = new Maze(cols, rows, cell);
    this.player = new Player(this.maze);
    this.player.onGoal = () => this._win();

    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._loop();
  }

  _win() {
    if (this._won) return;
    this._won  = true;
    const secs = ((performance.now() - this._startT) / 1000).toFixed(1);
    this.msgEl.textContent = `Ziel erreicht! Zeit: ${secs} s`;
    this.overlay.classList.remove('hidden');
  }

  _loop() {
    this._rafId = requestAnimationFrame(() => this._loop());

    if (!this._won) {
      this.timerEl.textContent = ((performance.now() - this._startT) / 1000).toFixed(1) + ' s';
      this.player.update(this._heldDirs);
    }

    this._draw();
  }

  _draw() {
    const ctx = this.ctx;
    const vw  = this.canvas.width;
    const vh  = this.canvas.height;
    const vcx = vw / 2;
    const vcy = vh / 2;
    const px  = this.player._cx;
    const py  = this.player._cy;

    ctx.fillStyle = `rgb(${FOG_COLOR})`;
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.translate(Math.round(vcx - px), Math.round(vcy - py));
    this.maze.draw(ctx);
    const { fog, fade } = this._settings();
    this.maze.drawDeadEnds(ctx, this.player.visitedCells, this.player.knownDeadCells, px, py, fog + fade);
    if (this._showSolution) this.maze.drawSolution(ctx);
    this.player.draw(ctx);
    ctx.restore();

    this._drawFog(ctx, vcx, vcy);
  }

  _drawFog(ctx, cx, cy) {
    const { fog, fade } = this._settings();
    const vw = this.canvas.width;
    const vh = this.canvas.height;

    const g = ctx.createRadialGradient(cx, cy, fog, cx, cy, fog + fade);
    g.addColorStop(0, `rgba(${FOG_COLOR},0)`);
    g.addColorStop(1, `rgba(${FOG_COLOR},1)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.fillStyle = `rgb(${FOG_COLOR})`;
    ctx.beginPath();
    ctx.rect(0, 0, vw, vh);
    ctx.arc(cx, cy, fog + fade, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
  }
}

window.addEventListener('DOMContentLoaded', () => new Game());
