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
// itemDiv: items per maze = floor(sqrt(area) / itemDiv); omit → no items
const SPELL_DEFS = [
  { name: 'Pfad',      duration: 5,  initialCount: 2, itemColor: '#4dd0e1', itemDiv: 10 },
  { name: 'Sackgasse', duration: 15, initialCount: 3, itemColor: '#ffb300', itemDiv:  5 },
  { name: 'Sprung',    duration: 5,  initialCount: 2, itemColor: '#69f0ae', itemDiv:  8 },
  { name: 'Pforte',    duration: 5,  initialCount: 2, itemColor: '#ce93d8', itemDiv:  9 },
  { name: 'Geist',     duration: 6,  initialCount: 2, itemColor: '#90caf9', itemDiv:  9 },
  { name: 'Leuchtfeuer', duration: 0, initialCount: 3, itemColor: '#ffab40', itemDiv:  6 },
  { name: 'Orakel',     duration: 4, initialCount: 2, itemColor: '#fff176', itemDiv: 12 },
  { name: 'Rückkehr',  duration: 0,  initialCount: 3, itemColor: '#ffd54f', itemDiv:  7 },
  null,
  null,
];

// Sprung spell: how far the camera zooms out at peak (0 = no zoom, 1 = full)
const JUMP_ZOOM_OUT = 0.55;

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
    this._items        = [];
    this._openedWall   = null;
    this._teleportFlash = 0;
    this._beacons      = [];
    this._fogCanvas    = null;
    this._hasTouch     = navigator.maxTouchPoints > 0;
    this._touchDir     = null;
    this._touchActive  = false;
    this._touchFromTap = false;

    // Build spell-bar DOM slots
    this._spellBarEl   = document.getElementById('spell-bar');
    this._spellSlotEls = [];
    for (let i = 0; i < 10; i++) {
      const slot  = document.createElement('div');
      const spell = this._spells[i];
      slot.className = 'spell-slot' + (spell ? '' : ' empty');
      if (spell) {
        const keyLabel = i < 9 ? String(i + 1) : '0';
        slot.innerHTML =
          `<span class="sp-countdown"></span>` +
          `<span class="sp-key">${keyLabel}</span>` +
          `<span class="sp-name">${spell.name}</span>` +
          `<span class="sp-charges">${spell.count}</span>`;
        slot.addEventListener('click', () => this._triggerSpell(i));
      }
      this._spellBarEl.appendChild(slot);
      this._spellSlotEls.push(slot);
    }

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
        const d   = parseInt(e.code[5], 10);
        const idx = d === 0 ? 9 : d - 1;
        this._triggerSpell(idx);
      }
    });
    window.addEventListener('keyup',  e => { const d = KEY_DIR[e.code]; if (d) this._heldDirs.delete(d); });
    window.addEventListener('blur',   () => this._heldDirs.clear());
    window.addEventListener('keydown', e => {
      if (e.code === 'Enter' && !this.overlay.classList.contains('hidden')) {
        e.preventDefault();
        this._startNew();
      }
    });

    new ResizeObserver(() => this._fitCanvas()).observe(this._wrap);

    if (this._hasTouch) this._initTouchControls();

    this._startNew();
  }

  // ── Admin UI toggle (qwert) ──────────────────────────────

  _toggleAdminUI() {
    document.getElementById('settings').classList.toggle('hidden');
    document.getElementById('btn-new').classList.toggle('hidden');
    document.getElementById('btn-solution').classList.toggle('hidden');
  }

  // ── Spell trigger (keyboard + tap) ──────────────────────

  _triggerSpell(idx) {
    if      (idx === 3) this._activateWallSpell();
    else if (idx === 5) this._activateLightSpell();
    else if (idx === 7) this._activateReturnSpell();
    else                this._activateSpell(idx);
  }

  // ── Touch controls ───────────────────────────────────────

  _ovalGeometry() {
    const vw = this.canvas.width, vh = this.canvas.height;
    const rx = Math.min(vw, vh) * 0.30;
    return { cx: vw / 2, cy: vh * 0.75, rx, ry: rx * 0.60 };
  }

  _initTouchControls() {
    const THRESHOLD = 12;

    const toCanvas = t => {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: (t.clientX - r.left) * (this.canvas.width  / r.width),
        y: (t.clientY - r.top)  * (this.canvas.height / r.height),
      };
    };

    const inOval = (x, y) => {
      const { cx, cy, rx, ry } = this._ovalGeometry();
      return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    };

    const dirFromPos = (x, y) => {
      const { cx, cy, rx, ry } = this._ovalGeometry();
      const ndx = (x - cx) / rx, ndy = (y - cy) / ry;
      return Math.abs(ndx) > Math.abs(ndy) ? (ndx > 0 ? 'E' : 'W') : (ndy > 0 ? 'S' : 'N');
    };

    const clearDir = () => {
      if (this._touchDir) this._heldDirs.delete(this._touchDir);
      this._touchDir     = null;
      this._touchFromTap = false;
    };

    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const { x, y } = toCanvas(e.changedTouches[0]);
      if (inOval(x, y)) {
        clearDir();
        // Start moving immediately in the direction of the touched arrow
        const dir      = dirFromPos(x, y);
        this._touchDir = dir;
        this._heldDirs.add(dir);
        this._touchActive = true;
        this._touchOriX   = e.changedTouches[0].clientX;
        this._touchOriY   = e.changedTouches[0].clientY;
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (!this._touchActive) return;
      const t  = e.changedTouches[0];
      const dx = t.clientX - this._touchOriX;
      const dy = t.clientY - this._touchOriY;
      if (Math.hypot(dx, dy) < THRESHOLD) return;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
      if (dir !== this._touchDir) {
        if (this._touchDir) this._heldDirs.delete(this._touchDir);
        this._touchDir = dir;
        this._heldDirs.add(dir);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => {
      clearDir();
      this._touchActive = false;
    }, { passive: true });

    this.canvas.addEventListener('touchcancel', () => {
      clearDir();
      this._touchActive = false;
    }, { passive: true });
  }

  _drawTouchControls(ctx) {
    if (!this._hasTouch) return;
    const { cx, cy, rx, ry } = this._ovalGeometry();
    const aw = Math.max(6, rx * 0.18);

    ctx.save();

    // Oval background
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,10,30,0.50)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,130,200,0.40)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Directional arrows
    const arrow = dir => {
      ctx.fillStyle = this._touchDir === dir ? '#ffffff' : 'rgba(180,180,220,0.75)';
      ctx.beginPath();
      switch (dir) {
        case 'N':
          ctx.moveTo(cx,            cy - ry * 0.65);
          ctx.lineTo(cx - aw,       cy - ry * 0.65 + aw * 1.4);
          ctx.lineTo(cx + aw,       cy - ry * 0.65 + aw * 1.4);
          break;
        case 'S':
          ctx.moveTo(cx,            cy + ry * 0.65);
          ctx.lineTo(cx - aw,       cy + ry * 0.65 - aw * 1.4);
          ctx.lineTo(cx + aw,       cy + ry * 0.65 - aw * 1.4);
          break;
        case 'W':
          ctx.moveTo(cx - rx * 0.70,            cy);
          ctx.lineTo(cx - rx * 0.70 + aw * 1.4, cy - aw);
          ctx.lineTo(cx - rx * 0.70 + aw * 1.4, cy + aw);
          break;
        case 'E':
          ctx.moveTo(cx + rx * 0.70,            cy);
          ctx.lineTo(cx + rx * 0.70 - aw * 1.4, cy - aw);
          ctx.lineTo(cx + rx * 0.70 - aw * 1.4, cy + aw);
          break;
      }
      ctx.closePath();
      ctx.fill();
    };

    ['N', 'S', 'W', 'E'].forEach(arrow);
    ctx.restore();
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

  // ── Pforte (Spell 4) — single wall removal ───────────────

  _activateWallSpell() {
    const spell = this._spells[3];
    if (!spell || spell.count <= 0) return;
    if (spell.activeUntil > performance.now()) return;   // already active

    const { cell, cols, rows, walls } = this.maze;
    const row = Math.floor(this.player._cy / cell);
    const col = Math.floor(this.player._cx / cell);
    const dir = this.player._facing;
    if (row < 0 || row >= rows || col < 0 || col >= cols) return;
    if (!walls[row][col][dir]) return;   // no wall here — don't consume charge

    const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
    const DR       = { N: -1,  S: 1,   E: 0,   W: 0  };
    const DC       = { N: 0,   S: 0,   E: 1,   W: -1 };
    const nr = row + DR[dir];
    const nc = col + DC[dir];

    walls[row][col][dir] = false;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols)
      walls[nr][nc][OPPOSITE[dir]] = false;

    spell.count--;
    spell.activeUntil = performance.now() + spell.duration * 1000;
    this._openedWall  = { row, col, dir, nr, nc, opp: OPPOSITE[dir] };
  }

  _checkOpenedWall() {
    if (!this._openedWall) return;
    const spell = this._spells[3];
    if (spell && spell.activeUntil > performance.now()) return;  // still ticking

    const { walls, rows, cols } = this.maze;
    const { row, col, dir, nr, nc, opp } = this._openedWall;
    walls[row][col][dir] = true;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols)
      walls[nr][nc][opp] = true;
    this._openedWall = null;
  }

  _drawOpenedWall(ctx) {
    if (!this._openedWall) return;
    const { cell } = this.maze;
    const W = Math.max(3, Math.round(cell * 0.10));
    const s = cell - 2 * W;
    const { row, col, dir } = this._openedWall;
    const spell     = this._spells[3];
    const remaining = spell ? Math.max(0, (spell.activeUntil - performance.now()) / 1000) : 0;
    const pulse     = 0.55 + 0.35 * Math.sin(performance.now() / 130);

    ctx.save();
    ctx.globalAlpha = pulse * Math.min(1, remaining);
    ctx.fillStyle   = '#ce93d8';
    ctx.shadowColor = '#ce93d8';
    ctx.shadowBlur  = 14;

    if      (dir === 'N') ctx.fillRect(col * cell + W,          row * cell - W,       s,     2 * W);
    else if (dir === 'S') ctx.fillRect(col * cell + W,    (row + 1) * cell - W,       s,     2 * W);
    else if (dir === 'E') ctx.fillRect((col + 1) * cell - W,    row * cell + W,  2 * W,          s);
    else if (dir === 'W') ctx.fillRect(col * cell - W,           row * cell + W,  2 * W,          s);

    ctx.restore();
  }

  // ── Leuchtfeuer (Spell 6) — persistent beacon ───────────

  _activateLightSpell() {
    const spell = this._spells[5];
    if (!spell || spell.count <= 0) return;
    const { cx, cy } = { cx: this.player._cx, cy: this.player._cy };
    if (this._beacons.some(b => Math.abs(b.cx - cx) < 4 && Math.abs(b.cy - cy) < 4)) return;
    spell.count--;
    spell.activeUntil = performance.now() + 350;  // brief flash in spell bar
    this._beacons.push({ cx, cy });
  }

  _drawBeacons(ctx) {
    if (!this._beacons.length) return;
    const r   = Math.max(4, this.maze.cell * 0.12);
    const now = performance.now();
    for (const b of this._beacons) {
      const flicker = 0.65 + 0.35 * Math.sin(now / 210 + b.cx * 0.013 + b.cy * 0.017);
      ctx.save();
      ctx.globalAlpha = flicker;
      ctx.fillStyle   = '#ffab40';
      ctx.shadowColor = '#ff6d00';
      ctx.shadowBlur  = 18;
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Rückkehr (Spell 8) — instant teleport to entrance ───

  _activateReturnSpell() {
    const spell = this._spells[7];
    if (!spell || spell.count <= 0) return;

    const { cell, cols, rows } = this.maze;
    const mid = Math.floor(cols / 2);
    this.player._cx     = (mid + 0.5) * cell;
    this.player._cy     = (rows - 0.5) * cell;
    this.player._facing = 'N';

    spell.count--;
    spell.activeUntil    = performance.now() + 400;  // brief flash indicator
    this._teleportFlash  = performance.now();
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
    for (let si = 0; si < SPELL_DEFS.length; si++) {
      const def = SPELL_DEFS[si];
      if (!def?.itemDiv) continue;
      const count = Math.max(1, Math.floor(side / def.itemDiv));
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

      const keyLabel = item.spellIndex < 9 ? String(item.spellIndex + 1) : '0';

      ctx.save();
      ctx.globalAlpha  = pulse;
      ctx.fillStyle    = color;
      ctx.shadowColor  = color;
      ctx.shadowBlur   = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur   = 0;
      ctx.fillStyle    = '#0d0d1a';
      ctx.font         = `bold ${Math.max(6, Math.round(r * 1.1))}px "Segoe UI",system-ui,sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(keyLabel, cx, cy);
      ctx.restore();
    }
  }

  // ── Spell bar (HTML, above canvas) ──────────────────────

  _updateSpellBar() {
    const now = performance.now();
    for (let i = 0; i < 10; i++) {
      const slot  = this._spellSlotEls[i];
      const spell = this._spells[i];
      if (!spell) continue;

      const remaining = spell.activeUntil > now ? (spell.activeUntil - now) / 1000 : 0;
      const active    = remaining > 0;
      const depleted  = spell.count === 0 && !active;

      slot.classList.toggle('active',   active);
      slot.classList.toggle('depleted', depleted);

      slot.querySelector('.sp-countdown').textContent = active ? remaining.toFixed(1) : '';
      slot.querySelector('.sp-charges').textContent   = String(spell.count);
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
    this._touchDir     = null;
    this._touchActive  = false;
    this._touchFromTap = false;

    // Only cancel active spell effects; counts carry over between levels
    for (const spell of this._spells) {
      if (spell) spell.activeUntil = 0;
    }
    this._openedWall = null;
    this._beacons    = [];
    this._fogCanvas  = null;

    this._fitCanvas();

    const { cols, rows, cell } = this._settings();
    this.maze   = new Maze(cols, rows, cell);
    this.player = new Player(this.maze);
    this.player.onGoal  = () => this._win();
    if (!this._robeColor) this._robeColor = `hsl(${Math.floor(Math.random() * 360)},65%,42%)`;
    this.player.robeColor = this._robeColor;

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
      const ghostSpell = this._spells[4];
      this.player.phasing = !!(ghostSpell && ghostSpell.activeUntil > performance.now());
      this.player.update(this._heldDirs);
      this._checkItemPickup();
      this._checkOpenedWall();
    }

    this._draw();
  }

  _draw() {
    const ctx = this.ctx;
    const vw  = this.canvas.width;
    const vh  = this.canvas.height;
    const vcx = vw / 2;
    const vcy = vh / 2;
    const psy = this._hasTouch ? Math.round(vh * 0.40) : vcy; // player screen-y
    const px  = this.player._cx;
    const py  = this.player._cy;

    // Spell 3 – Sprung: organic zoom-out via sin curve (fast → slow at peak → fast)
    let zoom = 1;
    const jumpSpell = this._spells[2];
    if (jumpSpell && jumpSpell.activeUntil > 0) {
      const remaining = (jumpSpell.activeUntil - performance.now()) / 1000;
      if (remaining > 0) {
        const progress = 1 - remaining / jumpSpell.duration;   // 0 → 1
        zoom = 1 - JUMP_ZOOM_OUT * Math.sin(Math.PI * progress);
      }
    }

    ctx.fillStyle = `rgb(${FOG_COLOR})`;
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    if (zoom === 1) {
      // Math.round prevents subpixel tile gaps at normal scale
      ctx.translate(Math.round(vcx - px), Math.round(psy - py));
    } else {
      ctx.translate(vcx, psy);
      ctx.scale(zoom, zoom);
      ctx.translate(-px, -py);
    }
    this.maze.draw(ctx);
    this._drawBeacons(ctx);
    this._drawOpenedWall(ctx);
    this._drawItems(ctx);

    const { fog, fade } = this._settings();
    // During jump the screen fog circle covers more world pixels → scale radius
    const fogRadius = (fog + fade) / zoom;
    const deadAlpha = this._getSpellAlpha(1, 3);
    this.maze.drawDeadEnds(ctx, this.player.visitedCells, this.player.knownDeadCells, px, py, fogRadius, deadAlpha);

    let solutionAlpha = this._showSolution ? 0.75 : 0;
    solutionAlpha = Math.max(solutionAlpha, this._getSpellAlpha(0, 2) * 0.75);
    if (solutionAlpha > 0) this.maze.drawSolution(ctx, solutionAlpha);

    ctx.restore();

    // Player drawn in screen space so it stays full-size during Sprung zoom-out
    ctx.save();
    ctx.translate(vcx - px, psy - py);
    if (this.player.phasing) {
      const pulse = 0.42 + 0.22 * Math.sin(performance.now() / 170);
      ctx.globalAlpha = pulse;
      ctx.shadowColor = '#90caf9';
      ctx.shadowBlur  = 24;
    }
    this.player.draw(ctx);
    ctx.restore();

    // Orakel: fog fades to 0 when active, returns over last 1 s
    const orakelAlpha = this._getSpellAlpha(6, 1);
    this._drawFog(ctx, vcx, psy, 1 - orakelAlpha, zoom);

    // Rückkehr flash
    if (this._teleportFlash > 0) {
      const alpha = Math.max(0, 1 - (performance.now() - this._teleportFlash) / 350);
      if (alpha > 0) {
        ctx.save();
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle   = '#ffd54f';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.restore();
      }
    }

    this._drawTouchControls(ctx);
    this._updateSpellBar();
  }

  _drawFog(ctx, cx, cy, fogMult = 1, zoom = 1) {
    if (fogMult <= 0) return;
    const { fog, fade } = this._settings();
    const vw = this.canvas.width;
    const vh = this.canvas.height;

    // Offscreen canvas lets us punch multiple light holes via destination-out
    if (!this._fogCanvas || this._fogCanvas.width !== vw || this._fogCanvas.height !== vh) {
      if (!this._fogCanvas) this._fogCanvas = document.createElement('canvas');
      this._fogCanvas.width  = vw;
      this._fogCanvas.height = vh;
    }
    const fc = this._fogCanvas.getContext('2d');

    // Solid fog base
    fc.globalCompositeOperation = 'source-over';
    fc.globalAlpha = 1;
    fc.fillStyle   = `rgb(${FOG_COLOR})`;
    fc.fillRect(0, 0, vw, vh);

    // Cut transparent holes
    fc.globalCompositeOperation = 'destination-out';

    const punchLight = (lx, ly, r, f) => {
      fc.fillStyle = 'black';
      fc.beginPath();
      fc.arc(lx, ly, r, 0, Math.PI * 2);
      fc.fill();
      const g = fc.createRadialGradient(lx, ly, r, lx, ly, r + f);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      fc.fillStyle = g;
      fc.fillRect(0, 0, vw, vh);
    };

    punchLight(cx, cy, fog, fade);

    if (this._beacons.length > 0) {
      const px  = this.player._cx;
      const py  = this.player._cy;
      const vcx = vw / 2;
      const vcy = vh / 2;
      const br  = Math.max(40, fog * 0.75);
      const bf  = Math.min(fade, 55);
      for (const b of this._beacons) {
        punchLight(vcx + (b.cx - px) * zoom, vcy + (b.cy - py) * zoom, br * zoom, bf * zoom);
      }
    }

    ctx.save();
    ctx.globalAlpha = fogMult;
    ctx.drawImage(this._fogCanvas, 0, 0);
    ctx.restore();
  }
}

window.addEventListener('DOMContentLoaded', () => { window._game = new Game(); });
