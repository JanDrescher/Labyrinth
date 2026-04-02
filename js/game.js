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
  { name: 'Pfad',        duration: 5,  initialCount: 0, itemColor: '#4dd0e1', itemDiv: 12, minLevel: 1, description: 'zeigt den Lösungspfad für 5 Sekunden an' },
  { name: 'Sackgasse',   duration: 20, initialCount: 0, itemColor: '#66bb6a', itemDiv:  5, minLevel: 1, description: 'zeigt für 20 Sekunden Sackgassen im Sichtbereich an' },
  { name: 'Sprung',      duration: 5,  initialCount: 0, itemColor: '#ff7043', itemDiv:  8, minLevel: 2, description: 'zoomt die Kamera für 5 Sekunden heraus' },
  { name: 'Pforte',      duration: 5,  initialCount: 0, itemColor: '#a1887f', itemDiv:  9, minLevel: 3, description: 'öffnet eine Wand in Blickrichtung für 5 Sekunden' },
  { name: 'Geist',       duration: 6,  initialCount: 0, itemColor: '#ba68c8', itemDiv:  9, minLevel: 4, description: 'du kannst für 6 Sekunden durch Wände gehen' },
  { name: 'Leuchtfeuer', duration: 0,  initialCount: 0, itemColor: '#ffab40', itemDiv:  6, minLevel: 5, description: 'platziert einen dauerhaften Leuchtpunkt' },
  { name: 'Orakel',      duration: 4,  initialCount: 0, itemColor: '#fff176', itemDiv:  9, minLevel: 6, description: 'entfernt den Nebel für 4 Sekunden vollständig' },
  { name: 'Pfadmitte', duration: 0, initialCount: 0, itemColor: '#ffd54f', itemDiv: 10, minLevel: 7, description: 'teleportiert dich zur Mitte des kürzesten Lösungspfades' },
  { name: 'Waffe',    duration: 0, initialCount: 0, itemColor: '#e53935', itemDiv:  8, minLevel: 8, description: 'kommt bald…' },
  { name: 'Schild',   duration: 0, initialCount: 0, itemColor: '#42a5f5', itemDiv: 10, minLevel: 9, description: 'kommt bald…' },
];

// Sprung spell: how far the camera zooms out at peak (0 = no zoom, 1 = full)
const JUMP_ZOOM_OUT = 0.55;

// NPC
const NPC_MIN_LEVEL   = 1;
const NPC_FRAME_COUNT = 6;
const NPC_ANIM_MS     = 110;   // ms per animation frame
const NPC_DIR_DELTA   = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };
//                      speed   mapColor    glowColor   glowBlur  alpha  bgTol
const NPC_DEFS = [
  { src: 'img/npc1.png', speed: 1.5, mapColor: '#4fc3f7', glowColor: '#4fc3f7', glowBlur: 18, alpha: 1.0, bgTol: 50 },
  { src: 'img/npc2.png', speed: 1.5, mapColor: '#ffd740', glowColor: '#ffd740', glowBlur: 14, alpha: 1.0, bgTol: 30 },
  { src: 'img/npc3.png', speed: 1.0, mapColor: '#69f0ae', glowColor: '#69f0ae', glowBlur: 12, alpha: 0.9, bgTol: 30 },
];

class Game {
  constructor() {
    this.canvas   = document.getElementById('maze-canvas');
    this.ctx      = this.canvas.getContext('2d');
    this.overlay  = document.getElementById('overlay');
    this.msgEl    = document.getElementById('overlay-msg');
    this.timerEl    = document.getElementById('timer');
    this.scoreEl    = document.getElementById('score');
    this.levelEl    = document.getElementById('level');
    this.itemsLeftEl = document.getElementById('items-left');
    this._wrap    = document.getElementById('canvas-wrap');

    this._heldDirs = new Set();
    this._seqIdx   = 0;
    this._spells   = SPELL_DEFS.map(d =>
      d ? { ...d, count: d.initialCount, activeUntil: 0 } : null
    );
    this._items           = [];
    this._itemPickups     = [];
    this._pendingRespawns = [];
    this._pickupCounts    = new Array(10).fill(0);  // per spell type, carries over between levels
    this._spriteSheet  = new Image();
    this._spriteSheet.src = 'img/spell-sprite.png';
    this._npcSprites = new Array(NPC_DEFS.length).fill(null);  // must exist before any onload fires
    NPC_DEFS.forEach((def, i) => {
      const img = new Image();
      img.onload = () => { this._npcSprites[i] = this._removeBackground(img, def.bgTol); };
      img.src = def.src;
    });
    this._npcs = [];
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
        const col = i % 5;
        const row = Math.floor(i / 5);
        slot.innerHTML =
          `<span class="sp-countdown"></span>` +
          `<div class="sp-icon" style="background-position:${col * 25}% ${row * 100}%;display:none"></div>` +
          `<span class="sp-charges"></span>`;
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

    this._won              = false;
    this._startT           = null;
    this._rafId            = null;
    this._showSolution     = false;
    this._level            = 1;
    this._score            = 0;
    this._discoveredSpells = new Set();
    this._discovery        = null;   // { spellIndex, startedAt }
    this._discoveryBtn     = null;   // { x, y, w, h } — OK-Button-Rect in Canvas-Koordinaten
    this._pausedMs         = 0;
    this._pauseStart       = null;

    this.canvas.addEventListener('click', e => {
      if (!this._discovery || !this._discoveryBtn) return;
      const { x, y } = this._clientToCanvas(e.clientX, e.clientY);
      const b = this._discoveryBtn;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) this._endDiscovery();
    });

    this._btnSolution = document.getElementById('btn-solution');
    this._btnSolution.addEventListener('click', () => {
      this._showSolution = !this._showSolution;
      this._btnSolution.setAttribute('aria-pressed', this._showSolution);
      this._btnSolution.textContent = this._showSolution ? 'Lösung verbergen' : 'Lösung zeigen';
    });

    document.getElementById('btn-new').addEventListener('click', () => this._startNew());

    document.getElementById('btn-jump-level').addEventListener('click', () => {
      const target = parseInt(document.getElementById('inp-jump-level').value, 10);
      if (!isFinite(target) || target < 1) return;
      this._level = target;
      // Sync maze size to match what the level progression would have reached
      const colsIn = this._sliders.cols.input;
      const rowsIn = this._sliders.rows.input;
      const newSize = Math.min(21 + (target - 1) * 2, 80);
      colsIn.value = newSize; this._sliders.cols.display.textContent = newSize;
      rowsIn.value = newSize; this._sliders.rows.display.textContent = newSize;
      this.levelEl.textContent = String(this._level);
      this._startNew();
    });

    const ADMIN_SEQ = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'];
    window.addEventListener('keydown', e => {
      if (this._discovery) { if (e.code === 'Enter') this._endDiscovery(); return; }
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

  // ── Helpers ──────────────────────────────────────────────

  _clientToCanvas(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (this.canvas.width  / r.width),
      y: (clientY - r.top)  * (this.canvas.height / r.height),
    };
  }

  // ── Timer (pause-aware) ──────────────────────────────────

  _elapsedMs() {
    const paused = this._pausedMs + (this._pauseStart !== null ? performance.now() - this._pauseStart : 0);
    return performance.now() - this._startT - paused;
  }

  _endDiscovery() {
    if (!this._discovery) return;
    if (this._pauseStart !== null) {
      this._pausedMs  += performance.now() - this._pauseStart;
      this._pauseStart = null;
    }
    this._discovery = null;
  }

  // ── Spell trigger (keyboard + tap) ──────────────────────

  _triggerSpell(idx) {
    if      (idx === 3) this._activateWallSpell();
    else if (idx === 5) this._activateLightSpell();
    else if (idx === 7) this._activateReturnSpell();
    else if (idx === 8 || idx === 9) return;   // not yet implemented
    else                this._activateSpell(idx);
  }

  // ── Touch controls ───────────────────────────────────────

  _ovalGeometry() {
    const vw = this.canvas.width, vh = this.canvas.height;
    const rx = Math.min(vw, vh) * 0.30;
    return { cx: vw / 2, cy: vh * 0.70, rx, ry: rx * 0.60 };
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
      if (this._discovery) {
        e.preventDefault();
        if (this._discoveryBtn) {
          const { x, y } = toCanvas(e.changedTouches[0]);
          const b = this._discoveryBtn;
          if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) this._endDiscovery();
        }
        return;
      }
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

  // ── NPC ──────────────────────────────────────────────────

  // Removes a solid background color from a sprite by making matching pixels transparent.
  // Returns a canvas element usable as an image source for drawImage.
  _removeBackground(img, bgTol = 50) {
    const oc  = document.createElement('canvas');
    oc.width  = img.naturalWidth;
    oc.height = img.naturalHeight;
    const octx = oc.getContext('2d');
    octx.drawImage(img, 0, 0);
    const id = octx.getImageData(0, 0, oc.width, oc.height);
    const d  = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i+3] === 0) continue;
      const maxDiff = Math.max(Math.abs(d[i]-d[i+1]), Math.abs(d[i+1]-d[i+2]), Math.abs(d[i]-d[i+2]));
      if (maxDiff < bgTol) d[i+3] = 0;
    }
    octx.putImageData(id, 0, 0);
    return oc;
  }

  _spawnNpcs() {
    this._npcs = [];
    if (this._level < NPC_MIN_LEVEL) return;
    const { cols, rows, cell } = this.maze;
    const mid = Math.floor(cols / 2);
    const usedCells = new Set();
    usedCells.add((rows - 1) * cols + mid);  // entrance
    usedCells.add(mid);                       // exit

    for (let spriteIndex = 0; spriteIndex < 3; spriteIndex++) {
      let row, col;
      do {
        row = Math.floor(Math.random() * rows);
        col = Math.floor(Math.random() * cols);
      } while (usedCells.has(row * cols + col));
      usedCells.add(row * cols + col);

      const cx = (col + 0.5) * cell;
      const cy = (row + 0.5) * cell;
      this._npcs.push({ cx, cy, row, col, targetCx: cx, targetCy: cy,
                        animFrame: 0, animT: performance.now(), lastDir: null,
                        spriteIndex, speed: NPC_DEFS[spriteIndex].speed });
    }
  }

  _updateNpcs() {
    const { cell, walls, cols, rows } = this.maze;
    const now = performance.now();

    for (const npc of this._npcs) {
      // Animate
      if (now - npc.animT > NPC_ANIM_MS) {
        npc.animFrame = (npc.animFrame + 1) % NPC_FRAME_COUNT;
        npc.animT = now;
      }

      // Move toward target cell center
      const dx   = npc.targetCx - npc.cx;
      const dy   = npc.targetCy - npc.cy;
      const dist = Math.hypot(dx, dy);

      if (dist <= npc.speed) {
        // Snap to center, pick next direction
        npc.cx  = npc.targetCx;
        npc.cy  = npc.targetCy;
        npc.row = Math.round((npc.cy / cell) - 0.5);
        npc.col = Math.round((npc.cx / cell) - 0.5);

        // Available exits, preferring not to reverse unless forced
        const REVERSE = { N: 'S', S: 'N', E: 'W', W: 'E' };
        const dirs = Object.keys(NPC_DIR_DELTA).filter(d => {
          if (walls[npc.row][npc.col][d]) return false;
          const [dr, dc] = NPC_DIR_DELTA[d];
          const nr = npc.row + dr, nc = npc.col + dc;
          return nr >= 0 && nr < rows && nc >= 0 && nc < cols;
        });
        const forward = dirs.filter(d => d !== REVERSE[npc.lastDir]);
        const pool    = forward.length ? forward : dirs;
        if (pool.length) {
          const dir = pool[Math.floor(Math.random() * pool.length)];
          const [dr, dc] = NPC_DIR_DELTA[dir];
          npc.targetCx  = ((npc.col + dc) + 0.5) * cell;
          npc.targetCy  = ((npc.row + dr) + 0.5) * cell;
          npc.lastDir   = dir;
        }
      } else {
        npc.cx += (dx / dist) * npc.speed;
        npc.cy += (dy / dist) * npc.speed;
      }
    }
  }

  _drawNpcs(ctx) {
    const { cell } = this.maze;
    const size = cell * 0.85;

    for (const npc of this._npcs) {
      const img = this._npcSprites[npc.spriteIndex];
      if (!img) continue;
      const def = NPC_DEFS[npc.spriteIndex];
      const fw  = Math.floor(img.width / NPC_FRAME_COUNT);
      const fh  = img.height;
      ctx.save();
      ctx.globalAlpha = def.alpha;
      ctx.shadowColor = def.glowColor;
      ctx.shadowBlur  = def.glowBlur;
      ctx.drawImage(img, npc.animFrame * fw, 0, fw, fh,
                    npc.cx - size / 2, npc.cy - size / 2, size, size);
      ctx.restore();
    }
  }

  // ── Pfadmitte (Spell 8) — teleport to midpoint of solution path ───

  _activateReturnSpell() {
    const spell = this._spells[7];
    if (!spell || spell.count <= 0) return;

    const path = this.maze.solution();
    if (!path || path.length === 0) return;

    const [row, col] = path[Math.floor(path.length / 2)];
    const { cell } = this.maze;
    this.player._cx     = (col + 0.5) * cell;
    this.player._cy     = (row + 0.5) * cell;
    this.player._facing = 'N';

    spell.count--;
    spell.activeUntil   = performance.now() + 400;  // brief flash indicator
    this._teleportFlash = performance.now();
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
      if (!def?.itemDiv || !def.minLevel || def.minLevel > this._level) continue;
      const count = Math.max(1, Math.floor(side / def.itemDiv));
      for (let n = 0; n < count && idx < available.length; n++, idx++) {
        this._items.push({ ...available[idx], spellIndex: si });
      }
    }
    this._updateItemsLeft();
  }

  _updateItemsLeft() {
    this.itemsLeftEl.textContent = String(this._items.length);
  }

  _randomFreeCell() {
    const { cols, rows } = this.maze;
    const mid      = Math.floor(cols / 2);
    const occupied = new Set(this._items.map(it => it.row * cols + it.col));
    occupied.add((rows - 1) * cols + mid);  // entrance
    occupied.add(mid);                       // exit (row 0)

    const candidates = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (!occupied.has(r * cols + c)) candidates.push({ row: r, col: c });

    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  _tickRespawns() {
    const now = performance.now();
    for (let i = this._pendingRespawns.length - 1; i >= 0; i--) {
      const p = this._pendingRespawns[i];
      if (now >= p.respawnAt) {
        const cell = this._randomFreeCell();
        if (cell) {
          this._items.push({ ...cell, spellIndex: p.spellIndex });
          this._updateItemsLeft();
        }
        this._pendingRespawns.splice(i, 1);
      }
    }
  }

  _flashScore() {
    this.scoreEl.classList.remove('flash');
    void this.scoreEl.offsetWidth; // reflow to restart animation
    this.scoreEl.classList.add('flash');
    this.scoreEl.addEventListener('animationend', () => {
      this.scoreEl.classList.remove('flash');
    }, { once: true });
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
        if (spell) {
          spell.count++;
          if (!this._discoveredSpells.has(item.spellIndex) && !this._discovery) {
            this._discoveredSpells.add(item.spellIndex);
            this._discovery  = { spellIndex: item.spellIndex, startedAt: performance.now() };
            this._pauseStart = performance.now();
          }
        }
        this._itemPickups.push({
          cx: (item.col + 0.5) * this.maze.cell,
          cy: (item.row + 0.5) * this.maze.cell,
          spellIndex: item.spellIndex,
          startedAt: performance.now(),
        });
        const n = ++this._pickupCounts[item.spellIndex];
        this._pendingRespawns.push({
          spellIndex: item.spellIndex,
          respawnAt: performance.now() + this._level * 60 * 1000 * Math.pow(1.5, n - 1),
        });
        this._items.splice(i, 1);
        this._updateItemsLeft();
        this._score += 10;
        this.scoreEl.textContent = String(this._score);
        this._flashScore();
      }
    }
  }

  _drawItems(ctx) {
    const img = this._spriteSheet;
    if (!img.complete || !img.naturalWidth) return;

    const { cell } = this.maze;
    const now  = performance.now();
    const sw     = Math.floor(img.naturalWidth  / 5);
    const sh     = Math.floor(img.naturalHeight / 2);
    const aspect = sw / sh;
    const size   = Math.max(14, Math.round(cell * 0.55));
    const dw     = aspect >= 1 ? size : size * aspect;
    const dh     = aspect >= 1 ? size / aspect : size;

    for (const item of this._items) {
      const cx    = (item.col + 0.5) * cell;
      const cy    = (item.row + 0.5) * cell;
      const col   = item.spellIndex % 5;
      const row   = Math.floor(item.spellIndex / 5);
      const pulse = 0.65 + 0.35 * Math.sin(now / 450 + item.col * 1.9 + item.row * 2.7);

      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.drawImage(img, col * sw, row * sh, sw, sh,
                    cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
    }

    // Pickup pop animations
    const POP_DUR = 480;
    this._itemPickups = this._itemPickups.filter(p => now - p.startedAt < POP_DUR);
    for (const p of this._itemPickups) {
      const t     = (now - p.startedAt) / POP_DUR; // 0→1
      const scale = 1 + 0.7 * Math.sin(t * Math.PI);
      const alpha = 1 - t;
      const pcol  = p.spellIndex % 5;
      const prow  = Math.floor(p.spellIndex / 5);
      const pdw   = dw * scale;
      const pdh   = dh * scale;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, pcol * sw, prow * sh, sw, sh,
                    p.cx - pdw / 2, p.cy - pdh / 2, pdw, pdh);
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

      const discovered = this._discoveredSpells.has(i);
      const remaining  = spell.activeUntil > now ? (spell.activeUntil - now) / 1000 : 0;
      const active     = remaining > 0;
      const depleted   = discovered && spell.count === 0 && !active;

      slot.classList.toggle('active',   active);
      slot.classList.toggle('depleted', depleted);

      const icon = slot.querySelector('.sp-icon');
      if (icon) icon.style.display = discovered ? 'block' : 'none';

      slot.querySelector('.sp-countdown').textContent = (discovered && active) ? remaining.toFixed(1) : '';
      slot.querySelector('.sp-charges').textContent   = discovered ? String(spell.count) : '';
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
    this._won        = false;
    this._startT     = performance.now();
    this._pausedMs   = 0;
    this._pauseStart = null;
    this._discovery  = null;
    this._heldDirs.clear();
    this._touchDir     = null;
    this._touchActive  = false;
    this._touchFromTap = false;

    // Only cancel active spell effects; counts carry over between levels
    for (const spell of this._spells) {
      if (spell) spell.activeUntil = 0;
    }
    this._openedWall      = null;
    this._beacons         = [];
    this._fogCanvas       = null;
    this._pendingRespawns = [];

    this._fitCanvas();

    const { cols, rows, cell } = this._settings();
    this.maze   = new Maze(cols, rows, cell);
    this.player = new Player(this.maze);
    this.player.onGoal  = () => this._win();
    if (!this._robeColor) this._robeColor = `hsl(${Math.floor(Math.random() * 360)},65%,42%)`;
    this.player.robeColor = this._robeColor;

    this._placeItems();
    this._spawnNpcs();

    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._loop();
  }

  _win() {
    if (this._won) return;
    this._won = true;

    const elapsed   = this._elapsedMs() / 1000;
    const { cols, rows } = this._settings();
    const threshold = (cols - 1) * (rows - 1) / 2;
    const bonus     = elapsed < threshold;

    this._score += 20 + (bonus ? 50 : 0);
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
    this.msgEl.innerHTML = `Ziel erreicht! Zeit: ${secsStr} s (+20${bonusPart})`;
    document.getElementById('btn-start').textContent = 'next Level';
    this.overlay.classList.remove('hidden');
  }

  _loop() {
    this._rafId = requestAnimationFrame(() => this._loop());

    if (!this._won) {
      this.timerEl.textContent = (this._elapsedMs() / 1000).toFixed(1) + ' s';
      if (!this._discovery) {
        const ghostSpell = this._spells[4];
        this.player.phasing = !!(ghostSpell && ghostSpell.activeUntil > performance.now());
        this.player.update(this._heldDirs);
        this._updateNpcs();
        this._checkItemPickup();
        this._checkOpenedWall();
        this._tickRespawns();
      }
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
    this._drawNpcs(ctx);

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

    this._drawMiniMap(ctx, solutionAlpha);
    this._drawDiscovery(ctx);
    this._drawTouchControls(ctx);
    this._updateSpellBar();
  }

  _drawMiniMap(ctx, solutionAlpha = 0) {
    const { cols, rows, cell: mazeCell, walls } = this.maze;
    const vw = this.canvas.width;
    const vh = this.canvas.height;

    const maxSize = Math.min(vw * 0.22, vh * 0.22, 160);
    const cs   = Math.max(2, Math.floor(maxSize / Math.max(cols, rows)));
    const gap  = cs >= 4 ? 1 : 0;
    const mapW = cols * cs;
    const mapH = rows * cs;
    const ox   = 10;
    const oy   = 10;

    ctx.save();

    // Background + border
    ctx.fillStyle   = 'rgba(5,5,15,0.75)';
    ctx.fillRect(ox - 2, oy - 2, mapW + 4, mapH + 4);
    ctx.strokeStyle = 'rgba(80,80,120,0.6)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(ox - 2, oy - 2, mapW + 4, mapH + 4);

    // Visited corridors
    ctx.fillStyle = '#6a6a8a';
    const visited = this.player.visitedCells;
    for (const key of visited) {
      const r = Math.floor(key / cols);
      const c = key % cols;
      ctx.fillRect(ox + c * cs, oy + r * cs, cs - gap, cs - gap);
      if (gap) {
        if (c + 1 < cols && !walls[r][c].E && visited.has(r * cols + c + 1))
          ctx.fillRect(ox + (c + 1) * cs - gap, oy + r * cs, gap, cs - gap);
        if (r + 1 < rows && !walls[r][c].S && visited.has((r + 1) * cols + c))
          ctx.fillRect(ox + c * cs, oy + (r + 1) * cs - gap, cs - gap, gap);
      }
    }

    // Solution path overlay
    if (solutionAlpha > 0) {
      const path = this.maze.solution();
      const lineW = cs / 5;
      if (lineW >= 0.5) {
        ctx.save();
        ctx.strokeStyle = '#e53935';
        ctx.lineWidth   = lineW;
        ctx.lineJoin    = 'round';
        ctx.lineCap     = 'round';
        ctx.globalAlpha = solutionAlpha;
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
          const [r, c] = path[i];
          const x = ox + (c + 0.5) * cs;
          const y = oy + (r + 0.5) * cs;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // Items — langsam blinkende farbige Punkte
    const now = performance.now();
    for (const item of this._items) {
      const color = SPELL_DEFS[item.spellIndex]?.itemColor ?? '#ffffff';
      const blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 900 + item.col + item.row));
      ctx.globalAlpha = blink;
      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.arc(ox + (item.col + 0.5) * cs, oy + (item.row + 0.5) * cs,
              Math.max(1, cs * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // NPC-Dots
    for (const npc of this._npcs) {
      const npcColor  = NPC_DEFS[npc.spriteIndex].mapColor;
      ctx.fillStyle   = npcColor;
      ctx.shadowColor = npcColor;
      ctx.shadowBlur  = 5;
      ctx.beginPath();
      ctx.arc(ox + (npc.cx / mazeCell) * cs,
              oy + (npc.cy / mazeCell) * cs,
              Math.max(1.5, cs * 0.65), 0, Math.PI * 2);
      ctx.fill();
    }

    // Spieler-Dot in Roben-Farbe
    ctx.fillStyle   = this._robeColor ?? '#ffffff';
    ctx.shadowColor = this._robeColor ?? '#ffffff';
    ctx.shadowBlur  = 5;
    ctx.beginPath();
    ctx.arc(ox + (this.player._cx / mazeCell) * cs,
            oy + (this.player._cy / mazeCell) * cs,
            Math.max(1.5, cs * 0.65), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawDiscovery(ctx) {
    if (!this._discovery) return;
    const def = SPELL_DEFS[this._discovery.spellIndex];
    if (!def) return;

    const age   = performance.now() - this._discovery.startedAt;
    const alpha = Math.min(age / 250, 1);

    const vw  = this.canvas.width;
    const vh  = this.canvas.height;
    const boxW      = Math.min(vw * 0.80, 460);
    const titleSize = Math.max(18, Math.round(boxW * 0.085));
    const descSize  = Math.max(12, Math.round(boxW * 0.052));
    const btnSize   = Math.max(12, Math.round(boxW * 0.052));
    const pad       = titleSize;
    const lineH     = descSize * 1.5;
    const btnH      = Math.round(btnSize * 2.2);
    const btnW      = Math.round(boxW * 0.35);

    // Word-wrap description
    ctx.font = `${descSize}px "Segoe UI",system-ui,sans-serif`;
    const words = def.description.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > boxW - pad * 2 && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);

    const subSize = Math.max(10, Math.round(boxW * 0.040));
    const subH    = subSize * 1.6;
    const boxH = pad + subH + titleSize + pad * 0.5 + lines.length * lineH + pad * 0.75 + btnH + pad;
    const bx   = (vw - boxW) / 2;
    let   by   = (vh - boxH) / 2;
    if (this._hasTouch) {
      const ry      = Math.min(vw, vh) * 0.30 * 0.60;
      const ovalTop = vh * 0.70 - ry;
      by = Math.max(8, ovalTop - boxH - 16);
    }

    // Store OK-button rect for hit-testing
    const okX = (vw - btnW) / 2;
    const okY = by + boxH - pad - btnH;
    this._discoveryBtn = { x: okX, y: okY, w: btnW, h: btnH };

    ctx.save();
    ctx.globalAlpha = alpha;

    // Panel background + border
    ctx.fillStyle   = 'rgba(10,10,22,0.93)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = def.itemColor;
    ctx.lineWidth   = 2;
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';

    // Subtitle
    ctx.font      = `${subSize}px "Segoe UI",system-ui,sans-serif`;
    ctx.fillStyle = 'rgba(180,180,210,0.75)';
    ctx.fillText('Du hast einen neuen Spell gefunden:', vw / 2, by + pad);

    // Title
    ctx.font        = `bold ${titleSize}px "Segoe UI",system-ui,sans-serif`;
    ctx.fillStyle   = def.itemColor;
    ctx.shadowColor = def.itemColor;
    ctx.shadowBlur  = 14;
    ctx.fillText(def.name.toUpperCase(), vw / 2, by + pad + subH);

    // Description lines
    ctx.shadowBlur = 0;
    ctx.font       = `${descSize}px "Segoe UI",system-ui,sans-serif`;
    ctx.fillStyle  = '#d0d0e8';
    const descY    = by + pad + subH + titleSize + pad * 0.5;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], vw / 2, descY + i * lineH);
    }

    // OK button
    ctx.fillStyle   = def.itemColor;
    ctx.fillRect(okX, okY, btnW, btnH);
    ctx.fillStyle   = '#0a0a16';
    ctx.font        = `bold ${btnSize}px "Segoe UI",system-ui,sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText('OK', vw / 2, okY + btnH / 2);

    ctx.restore();
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
