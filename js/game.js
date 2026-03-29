import { Maze }   from './maze.js';
import { Player } from './player.js';

const KEY_DIR = {
  ArrowUp:    'N', KeyW: 'N',
  ArrowRight: 'E', KeyD: 'E',
  ArrowDown:  'S', KeyS: 'S',
  ArrowLeft:  'W', KeyA: 'W',
};

const FOG_COLOR = '13,13,26';

// index 0 → key "1", index 9 → key "0"
// initialCount: charges the player starts the whole game with (not reset between levels)
const SPELL_DEFS = [
  { name: 'Pfad',      duration: 5,  initialCount: 2, itemColor: '#4dd0e1' },
  { name: 'Sackgasse', duration: 15, initialCount: 3, itemColor: '#ffb300' },
  null, null, null, null, null, null, null, null,
];

// Items per maze scale with sqrt(area); divisors tune rarity
const ITEM_DIVISOR = [10, 5];  // Spell 1 very rare, Spell 2 more frequent

class Game {
  constructor() {
    this.canvas   = document.getElementById('maze-canvas');
    this.ctx      = this.canvas.getContext('2d');
    this.overlay  = document.getElementById('overlay');
    this.msgEl    = document.getElementById('overlay-msg');
    this.timerEl  = document.getElementById('timer');
    this.scoreEl  = document.getElementById('score');
    this.levelEl  = document.getElementById('level');
    this._wrap    = document.getElementById('canvas-wrap');

    this._heldDirs = new Set();
    this._seqIdx   = 0;
    this._spells   = SPELL_DEFS.map(d =>
      d ? { ...d, count: d.initialCount, activeUntil: 0 } : null
    );
    this._items    = [];

    this._sliders = {
      cols: { input: document.getElementById('inp-cols'), display: document.getElementById('val-cols') },
      rows: { input: document.getElementById('inp-rows'), display: document.getElementById('val-rows') },
      cell: { input: document.getElementById('inp-cell'), display: document.getElementById('val-cell') },
      fog:  { input: document.getElementById('inp-fog'),  display: document.getElementById('val-fog')  },
      fade: { input: document.getElementById('inp-fade'), display: document.getElementById('val-fade') },
    };

    for (const [key, { input, display }] of Object.entries(this._sliders)) {
      input.addEventListener('input', () => { display.textContent = input.value; });
      if (key === 'cols' || key === 'rows' || key === 'cell') {
        input.addEventListener('change', () => this._startNew());
      }
    }

    this._won          = false;
    this._startT       = null;
    this._rafId        = null;
    this._showSolution = false;
    this._level        = 1;
    this._score        = 0;

    this._btnSolution = document.getElementById('btn-solution');
    this._btnSolution.addEventListener('click', () => {
      this._showSolution = !this._showSolution;
      this._btnSolution.setAttribute('aria-pressed', this._showSolution);
      this._btnSolution.textContent = this._showSolution ? 'Lösung verbergen' : 'Lösung zeigen';
    });

    document.getElementById('btn-new').addEventListener('click', () => this._startNew());

    const ADMIN_SEQ = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'];
    window.addEventListener('keydown', e => {
      if (e.code === ADMIN_SEQ[this._seqIdx]) {
        this._seqIdx++;
        if (this._seqIdx === ADMIN_SEQ.length) {
          this._seqIdx = 0;
          this._toggleAdminUI();
        }
      } else {
        this._seqIdx = e.code === ADMIN_SEQ[0] ? 1 : 0;
      }

      const dir = KEY_DIR[e.code];
      if (dir) { e.preventDefault(); this._heldDirs.add(dir); return; }
      if (e.code.startsWith('Digit')) {
        const d = parseInt(e.code[5], 10);
        this._activateSpell(d === 0 ? 9 : d - 1);
      }
    });
    window.addEventListener('keyup',  e => { const d = KEY_DIR[e.code]; if (d) this._heldDirs.delete(d); });
    window.addEventListener('blur',   () => this._heldDirs.clear());

    new ResizeObserver(() => this._fitCanvas()).observe(this._wrap);

    this._startNew();
  }

  // ── Admin UI toggle (qwert) ──────────────────────────────

  _toggleAdminUI() {
    document.getElementById('settings').classList.toggle('hidden');
    document.getElementById('btn-new').classList.toggle('hidden');
    document.getElementById('btn-solution').classList.toggle('hidden');
  }

  // ── Spell logic ──────────────────────────────────────────

  _activateSpell(index) {
    const spell = this._spells[index];
    if (!spell) return;
    if (spell.count <= 0) return;
    if (spell.activeUntil > performance.now()) return;
    spell.count--;
    spell.activeUntil = performance.now() + spell.duration * 1000;
  }

  _getSpellAlpha(index, fadeSecs) {
    const spell = this._spells[index];
    if (!spell || spell.activeUntil <= 0) return 0;
    const remaining = (spell.activeUntil - performance.now()) / 1000;
    if (remaining <= 0) return 0;
    return remaining > fadeSecs ? 1 : remaining / fadeSecs;
  }

  // ── Items ────────────────────────────────────────────────

  _placeItems() {
    const { cols, rows } = this._settings();
    const mid  = Math.floor(cols / 2);
    const side = Math.sqrt(cols * rows);

    // Build shuffled list of valid cells (exclude entrance and exit)
    const available = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === rows - 1 && c === mid) continue;  // entrance
        if (r === 0        && c === mid) continue;  // exit
        available.push({ row: r, col: c });
      }
    }
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }

    this._items = [];
    let idx = 0;
    for (let si = 0; si < ITEM_DIVISOR.length; si++) {
      const count = Math.max(1, Math.floor(side / ITEM_DIVISOR[si]));
      for (let n = 0; n < count && idx < available.length; n++, idx++) {
        this._items.push({ ...available[idx], spellIndex: si });
      }
    }
  }

  _checkItemPickup() {
    const { cell, cols, rows } = this.maze;
    const row = Math.floor(this.player._cy / cell);
    const col = Math.floor(this.player._cx / cell);
    if (row < 0 || row >= rows || col < 0 || col >= cols) return;

    for (let i = this._items.length - 1; i >= 0; i--) {
      const item = this._items[i];
      if (item.row === row && item.col === col) {
        const spell = this._spells[item.spellIndex];
        if (spell) spell.count++;
        this._items.splice(i, 1);
      }
    }
  }

  _drawItems(ctx) {
    const { cell } = this.maze;
    const now = performance.now();

    for (const item of this._items) {
      const cx    = (item.col + 0.5) * cell;
      const cy    = (item.row + 0.5) * cell;
      const r     = Math.max(3, cell * 0.13);
      const pulse = 0.65 + 0.35 * Math.sin(now / 450 + item.col * 1.9 + item.row * 2.7);
      const color = SPELL_DEFS[item.spellIndex]?.itemColor ?? '#ffffff';

      ctx.save();
      ctx.globalAlpha  = pulse;
      ctx.fillStyle    = color;
      ctx.shadowColor  = color;
      ctx.shadowBlur   = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Spell bar (canvas, screen space) ────────────────────

  _drawSpellBar(ctx) {
    const SLOT = 52, GAP = 5, N = 10;
    const totalW = N * SLOT + (N - 1) * GAP;
    const x0 = Math.round((this.canvas.width - totalW) / 2);
    const y0 = GAP;
    const now = performance.now();

    for (let i = 0; i < N; i++) {
      const spell     = this._spells[i];
      const sx        = x0 + i * (SLOT + GAP);
      const sy        = y0;
      const remaining = spell && spell.activeUntil > now
        ? (spell.activeUntil - now) / 1000 : 0;
      const active    = remaining > 0;
      const depleted  = spell && spell.count === 0 && !active;
      const baseAlpha = !spell ? 0.22 : depleted ? 0.38 : 1;

      ctx.save();
      ctx.globalAlpha = baseAlpha;

      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(sx, sy, SLOT, SLOT);

      if (active) { ctx.shadowColor = 'rgba(21,101,192,0.75)'; ctx.shadowBlur = 14; }
      ctx.strokeStyle = active ? '#1565c0' : '#2e3060';
      ctx.lineWidth   = active ? 1.5 : 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, SLOT - 1, SLOT - 1);
      ctx.shadowBlur  = 0;

      if (spell) {
        const keyLabel = i < 9 ? String(i + 1) : '0';

        ctx.fillStyle    = active ? '#e0e0e0' : '#7986cb';
        ctx.font         = 'bold 17px "Segoe UI",system-ui,sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(keyLabel, sx + SLOT / 2, sy + SLOT / 2 - 1);

        ctx.globalAlpha = baseAlpha * 0.65;
        ctx.font        = '8px "Segoe UI",system-ui,sans-serif';
        ctx.fillStyle   = '#7986cb';
        ctx.fillText(spell.name.toUpperCase(), sx + SLOT / 2, sy + SLOT / 2 + 11);
        ctx.globalAlpha = baseAlpha;

        if (active) {
          ctx.fillStyle    = '#ffffff';
          ctx.font         = 'bold 10px "Segoe UI",system-ui,sans-serif';
          ctx.textAlign    = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(remaining.toFixed(1), sx + 4, sy + 3);
        }

        ctx.fillStyle    = active ? '#e0e0e0' : '#7986cb';
        ctx.font         = '10px "Segoe UI",system-ui,sans-serif';
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(spell.count), sx + SLOT - 4, sy + SLOT - 3);
      }

      ctx.restore();
    }
  }

  // ── Core ─────────────────────────────────────────────────

  _settings() {
    return {
      cols: parseInt(this._sliders.cols.input.value, 10),
      rows: parseInt(this._sliders.rows.input.value, 10),
      cell: parseInt(this._sliders.cell.input.value, 10),
      fog:  parseInt(this._sliders.fog.input.value,  10),
      fade: parseInt(this._sliders.fade.input.value, 10),
    };
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

    // Only cancel active spell effects; counts carry over between levels
    for (const spell of this._spells) {
      if (spell) spell.activeUntil = 0;
    }

    this._fitCanvas();

    const { cols, rows, cell } = this._settings();
    this.maze   = new Maze(cols, rows, cell);
    this.player = new Player(this.maze);
    this.player.onGoal = () => this._win();

    this._placeItems();

    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._loop();
  }

  _win() {
    if (this._won) return;
    this._won = true;

    const elapsed   = (performance.now() - this._startT) / 1000;
    const { cols, rows } = this._settings();
    const threshold = (cols - 1) * (rows - 1) / 2;
    const bonus     = elapsed < threshold;

    this._score += 10 + (bonus ? 50 : 0);
    this.scoreEl.textContent = String(this._score);

    this._level++;
    this.levelEl.textContent = String(this._level);

    // Grow next maze
    const colsIn = this._sliders.cols.input;
    const rowsIn = this._sliders.rows.input;
    const fogIn  = this._sliders.fog.input;
    colsIn.value = Math.min(parseInt(colsIn.value, 10) + 2, parseInt(colsIn.max, 10));
    rowsIn.value = Math.min(parseInt(rowsIn.value, 10) + 2, parseInt(rowsIn.max, 10));
    fogIn.value  = Math.min(parseInt(fogIn.value,  10) + 5, parseInt(fogIn.max,  10));
    this._sliders.cols.display.textContent = colsIn.value;
    this._sliders.rows.display.textContent = rowsIn.value;
    this._sliders.fog.display.textContent  = fogIn.value;

    const secsStr   = elapsed.toFixed(1);
    const bonusPart = bonus
      ? ` <span style="color:#00c853">+50 Zeitbonus</span>`
      : '';
    this.msgEl.innerHTML = `Ziel erreicht! Zeit: ${secsStr} s (+10${bonusPart})`;
    this.overlay.classList.remove('hidden');
  }

  _loop() {
    this._rafId = requestAnimationFrame(() => this._loop());

    if (!this._won) {
      this.timerEl.textContent = ((performance.now() - this._startT) / 1000).toFixed(1) + ' s';
      this.player.update(this._heldDirs);
      this._checkItemPickup();
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
    this._drawItems(ctx);

    const { fog, fade } = this._settings();
    const deadAlpha = this._getSpellAlpha(1, 3);
    this.maze.drawDeadEnds(ctx, this.player.visitedCells, this.player.knownDeadCells, px, py, fog + fade, deadAlpha);

    let solutionAlpha = this._showSolution ? 0.75 : 0;
    solutionAlpha = Math.max(solutionAlpha, this._getSpellAlpha(0, 2) * 0.75);
    if (solutionAlpha > 0) this.maze.drawSolution(ctx, solutionAlpha);

    this.player.draw(ctx);
    ctx.restore();

    this._drawFog(ctx, vcx, vcy);
    this._drawSpellBar(ctx);
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
