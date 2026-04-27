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
  { name: 'Pfad',        duration: 5,  initialCount: 0, itemColor: '#4dd0e1', itemDiv: 10, minLevel: 1, description: 'zeigt den Lösungspfad für 5 Sekunden an' },
  { name: 'Sackgasse',   duration: 20, initialCount: 0, itemColor: '#66bb6a', itemDiv:  5, minLevel: 1, description: 'zeigt für 20 Sekunden Sackgassen im Sichtbereich an' },
  { name: 'Sprung',      duration: 5,  initialCount: 0, itemColor: '#ff7043', itemDiv:  8, minLevel: 2, description: 'zoomt die Kamera für 5 Sekunden heraus, überspringt Gegner' },
  { name: 'Pforte',      duration: 5,  initialCount: 0, itemColor: '#a1887f', itemDiv:  9, minLevel: 3, description: 'öffnet eine Wand in Blickrichtung für 5 Sekunden, undurchlässig für Gegner' },
  { name: 'Geist',       duration: 6,  initialCount: 0, itemColor: '#ba68c8', itemDiv:  9, minLevel: 4, description: 'du kannst für 6 Sekunden durch Wände und Gegner gehen' },
  { name: 'Teleport',    duration: 0,  initialCount: 0, itemColor: '#ffab40', itemDiv:  6, minLevel: 5, description: 'Ein zufälliger Teleport, den Gegner nicht nutzen können. Zweiter Teleport führt zurück' },
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
    this._portalSprite = new Image();
    this._portalSprite.src = 'img/portal6.png';
    this._npcSprites = new Array(NPC_DEFS.length).fill(null);  // must exist before any onload fires
    NPC_DEFS.forEach((def, i) => {
      const img = new Image();
      img.onload = () => { this._npcSprites[i] = this._removeBackground(img, def.bgTol); };
      img.src = def.src;
    });
    this._npcs = [];
    this._openedWall        = null;
    this._revealedDeadCells = new Set();
    this._teleportFlash = 0;
    this._glitchUntil  = 0;     // NPC1-Glitch-Effekt Ende
    this._glitchNextAt = 0;     // nächster Glitch-Teleport
    this._confuseUntil = 0;     // NPC2-Konfusions-Effekt Ende
    this._slowUntil    = 0;     // NPC3-Verlangsamungs-Effekt Ende
    this._flickerUntil  = 0;
    this._portalPairs      = [];   // [{ a:{cx,cy,animFrame,animT}, b:{...}|null }, ...]
    this._portalStandStart = null; // { pairIndex, portal:'a'|'b', startedAt }
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
        const keyLabel = i === 9 ? '0' : String(i + 1);
        slot.dataset.tooltip = spell.name;
        slot.innerHTML =
          `<span class="sp-countdown"></span>` +
          `<span class="sp-key">${keyLabel}</span>` +
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

    // Debug: give 10 charges to every spell and mark all as discovered
    document.getElementById('btn-dbg-spells').addEventListener('click', () => {
      this._spells.forEach((spell, i) => {
        if (spell) { spell.count += 10; this._discoveredSpells.add(i); }
      });
      this._updateSpellBar();
    });

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
    const els = ['settings', 'btn-new', 'btn-solution', 'btn-dbg-spells'];
    els.forEach(id => document.getElementById(id).classList.toggle('hidden'));
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
    else if (idx === 5) this._activateTeleportSpell();
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

  // ── Teleport (Spell 6) — portal pairs ───────────────────

  _activateTeleportSpell() {
    const spell = this._spells[5];
    if (!spell) return;

    const pendingIdx = this._portalPairs.findIndex(p => p.b === null);

    if (pendingIdx !== -1) {
      // Complete the pair: place B at current position, teleport back to A instantly
      const pair = this._portalPairs[pendingIdx];
      pair.b = { cx: this.player._cx, cy: this.player._cy, animFrame: 0, animT: performance.now() };
      this.player._cx     = pair.a.cx;
      this.player._cy     = pair.a.cy;
      this.player._facing = 'N';
      this._teleportFlash = performance.now();
    } else {
      // Start new pair — costs 1 charge
      if (spell.count <= 0) return;
      spell.count--;
      spell.activeUntil = performance.now() + 350;

      const aCx = this.player._cx;
      const aCy = this.player._cy;

      const dest = this._randomTeleportCell();
      if (dest) {
        const { cell } = this.maze;
        this.player._cx     = (dest.col + 0.5) * cell;
        this.player._cy     = (dest.row + 0.5) * cell;
        this.player._facing = 'N';
        this._teleportFlash = performance.now();
      }

      this._portalPairs.push({ a: { cx: aCx, cy: aCy, animFrame: 0, animT: performance.now() }, b: null });
    }
  }

  _randomTeleportCell() {
    const { cols, rows, cell } = this.maze;
    const mid    = Math.floor(cols / 2);
    const px     = this.player._cx;
    const py     = this.player._cy;
    const minD   = cell * 5;

    const candidates = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === rows - 1 && c === mid) continue;  // entrance
        if (r === 0        && c === mid) continue;  // exit
        const dx = (c + 0.5) * cell - px;
        const dy = (r + 0.5) * cell - py;
        if (Math.sqrt(dx * dx + dy * dy) >= minD) candidates.push({ row: r, col: c });
      }
    }
    // Fallback if maze too small
    if (!candidates.length) {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (!(r === rows - 1 && c === mid) && !(r === 0 && c === mid))
            candidates.push({ row: r, col: c });
    }
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  _checkPortalTeleport() {
    const { cell } = this.maze;
    const px       = this.player._cx;
    const py       = this.player._cy;
    const CONTACT  = cell * 0.5;
    const STAND_MS = 3000;
    const now      = performance.now();

    let standingOn = null;
    for (let pi = 0; pi < this._portalPairs.length; pi++) {
      const pair = this._portalPairs[pi];
      if (!pair.b) continue;
      for (const key of ['a', 'b']) {
        const portal = pair[key];
        const dx = portal.cx - px, dy = portal.cy - py;
        if (Math.sqrt(dx * dx + dy * dy) < CONTACT) { standingOn = { pi, key }; break; }
      }
      if (standingOn) break;
    }

    if (standingOn) {
      const s = this._portalStandStart;
      if (!s || s.pi !== standingOn.pi || s.key !== standingOn.key) {
        this._portalStandStart = { ...standingOn, startedAt: now };
      } else if (now - s.startedAt >= STAND_MS) {
        const pair = this._portalPairs[standingOn.pi];
        const dest = standingOn.key === 'a' ? pair.b : pair.a;
        this.player._cx     = dest.cx;
        this.player._cy     = dest.cy;
        this.player._facing = 'N';
        this._teleportFlash = now;
        this._portalStandStart = null;
      }
    } else {
      this._portalStandStart = null;
    }
  }

  _drawPortals(ctx) {
    if (!this._portalPairs.length) return;
    const img = this._portalSprite;
    if (!img || !img.complete || !img.naturalWidth) return;
    const FRAMES   = 7;
    const FRAME_MS = 120;
    const fw       = Math.floor(img.naturalWidth / FRAMES);
    const fh       = img.naturalHeight;
    const size     = Math.max(16, this.maze.cell * 0.6375);
    const now      = performance.now();

    const drawOne = (portal, pulsing) => {
      if (now - portal.animT > FRAME_MS) {
        portal.animFrame = (portal.animFrame + 1) % FRAMES;
        portal.animT     = now;
      }
      ctx.save();
      if (pulsing) ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 280);
      ctx.drawImage(img, portal.animFrame * fw, 0, fw, fh,
                    portal.cx - size / 2, portal.cy - size / 2, size, size);
      ctx.restore();
    };

    for (const pair of this._portalPairs) {
      drawOne(pair.a, pair.b === null);
      if (pair.b) drawOne(pair.b, false);
    }

    // Progress arc while player stands on a complete portal
    if (this._portalStandStart) {
      const pair = this._portalPairs[this._portalStandStart.pi];
      if (pair?.b) {
        const portal   = pair[this._portalStandStart.key];
        const progress = Math.min(1, (now - this._portalStandStart.startedAt) / 3000);
        const r        = size * 0.72;
        ctx.save();
        ctx.strokeStyle = '#ffab40';
        ctx.lineWidth   = Math.max(2, size * 0.08);
        ctx.lineCap     = 'round';
        ctx.shadowColor = '#ffab40';
        ctx.shadowBlur  = 10;
        ctx.beginPath();
        ctx.arc(portal.cx, portal.cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
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
                        spriteIndex, speed: NPC_DEFS[spriteIndex].speed,
                        mode: 'wander', chaseLostAt: null, cooldownUntil: 0 });
    }
  }

  // Returns true when npc has clear line-of-sight to the player in its current
  // movement direction AND the player is within the fog radius.
  // Returns true if the direction d from (row,col) is blocked for NPCs.
  // Treats the player's opened Pforte-wall as impassable for NPCs.
  _isNpcWall(row, col, d) {
    if (this.maze.walls[row][col][d]) return true;
    const ow = this._openedWall;
    if (!ow) return false;
    if (row === ow.row && col === ow.col && d === ow.dir) return true;
    if (row === ow.nr  && col === ow.nc  && d === ow.opp) return true;
    return false;
  }

  _npcHasLos(npc, fogRadius) {
    if (!npc.lastDir) return false;
    const { cell, cols, rows } = this.maze;
    if (Math.hypot(npc.cx - this.player._cx, npc.cy - this.player._cy) > fogRadius) return false;
    const pr = Math.floor(this.player._cy / cell);
    const pc = Math.floor(this.player._cx / cell);
    const [dr, dc] = NPC_DIR_DELTA[npc.lastDir];
    let r = npc.row, c = npc.col;
    while (true) {
      if (this._isNpcWall(r, c, npc.lastDir)) break;
      r += dr; c += dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) break;
      if (r === pr && c === pc) return true;
    }
    return false;
  }

  // BFS from npc's cell to player's cell; returns the first direction to take.
  // Treats the player's Pforte as blocked (NPCs cannot use it).
  _npcBfsNext(npc) {
    const { cols, rows, cell } = this.maze;
    const pr = Math.floor(this.player._cy / cell);
    const pc = Math.floor(this.player._cx / cell);
    const sr = npc.row, sc = npc.col;
    if (sr === pr && sc === pc) return null;
    const key   = (r, c) => r * cols + c;
    const prev  = new Map();
    const queue = [[sr, sc]];
    prev.set(key(sr, sc), null);
    let found = false;
    outer: while (queue.length) {
      const [r, c] = queue.shift();
      for (const [dir, [dr, dc]] of Object.entries(NPC_DIR_DELTA)) {
        if (this._isNpcWall(r, c, dir)) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const k = key(nr, nc);
        if (prev.has(k)) continue;
        prev.set(k, { r, c, dir });
        if (nr === pr && nc === pc) { found = true; break outer; }
        queue.push([nr, nc]);
      }
    }
    if (!found) return null;
    // Trace back to NPC start to find first step
    let cur = [pr, pc];
    while (true) {
      const p = prev.get(key(cur[0], cur[1]));
      if (!p) return null;
      if (p.r === sr && p.c === sc) return p.dir;
      cur = [p.r, p.c];
    }
  }

  // BFS vom Spieler aus, liefert alle Zellen in 1–maxSteps Schritten (wandkonform)
  _glitchBfsCells(maxSteps) {
    const { cols, rows, cell } = this.maze;
    const pr = Math.floor(this.player._cy / cell);
    const pc = Math.floor(this.player._cx / cell);
    const key    = (r, c) => r * cols + c;
    const dist   = new Map([[key(pr, pc), 0]]);
    const queue  = [[pr, pc, 0]];
    const result = [];
    while (queue.length) {
      const [r, c, d] = queue.shift();
      if (d > 0) result.push({ row: r, col: c });
      if (d >= maxSteps) continue;
      for (const [dir, [dr, dc]] of Object.entries(NPC_DIR_DELTA)) {
        if (this.maze.walls[r][c][dir]) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const k = key(nr, nc);
        if (dist.has(k)) continue;
        dist.set(k, d + 1);
        queue.push([nr, nc, d + 1]);
      }
    }
    return result;
  }

  _tickGlitch() {
    const now = performance.now();
    if (now >= this._glitchUntil || now < this._glitchNextAt) return;
    const cells = this._glitchBfsCells(3);
    if (cells.length === 0) return;
    const dest = cells[Math.floor(Math.random() * cells.length)];
    const cell = this.maze.cell;
    this.player._cx = (dest.col + 0.5) * cell;
    this.player._cy = (dest.row + 0.5) * cell;
    this._glitchNextAt = now + 300 + Math.random() * 500;
  }

  _updateNpcs() {
    const { cell, cols, rows } = this.maze;
    const now = performance.now();
    const { fog } = this._settings();
    const REVERSE = { N: 'S', S: 'N', E: 'W', W: 'E' };
    const playerImmune = (this._spells[2]?.activeUntil > now)   // Sprung
                      || (this._spells[4]?.activeUntil > now);  // Geist

    for (const npc of this._npcs) {
      // Animate
      if (now - npc.animT > NPC_ANIM_MS) {
        npc.animFrame = (npc.animFrame + 1) % NPC_FRAME_COUNT;
        npc.animT = now;
      }

      // ── Sight / mode transitions ──────────────────────────
      const inCooldown = now < npc.cooldownUntil;
      if (!inCooldown) {
        const hasLos = this._npcHasLos(npc, fog);
        if (npc.mode === 'wander') {
          if (hasLos) {
            npc.mode        = 'chase';
            npc.chaseLostAt = null;
            npc.speed       = NPC_DEFS[npc.spriteIndex].speed * 2;
          }
        } else { // chase
          if (hasLos) {
            npc.chaseLostAt = null;
          } else {
            if (npc.chaseLostAt === null) npc.chaseLostAt = now;
            if (now - npc.chaseLostAt > 10000) {
              npc.mode        = 'wander';
              npc.chaseLostAt = null;
              npc.speed       = NPC_DEFS[npc.spriteIndex].speed;
            }
          }
        }
      }

      // ── Collision (only while chasing) ───────────────────
      if (npc.mode === 'chase') {
        const contactDist = Math.hypot(npc.cx - this.player._cx, npc.cy - this.player._cy);
        if (contactDist < cell * 0.5) {
          npc.mode        = 'wander';
          npc.chaseLostAt = null;
          npc.speed       = NPC_DEFS[npc.spriteIndex].speed;
          if (playerImmune) {
            // Sprung / Geist: NPC breaks off silently, no penalty for player
          } else {
            npc.cooldownUntil  = now + 10000;
            this._flickerUntil = now + 600;
            if (npc.spriteIndex === 0) {
              this._glitchUntil  = now + 15000;
              this._glitchNextAt = now + 300 + Math.random() * 500;
            } else if (npc.spriteIndex === 1) {
              this._confuseUntil = now + 15000;
            } else if (npc.spriteIndex === 2) {
              this._slowUntil = now + 15000;
            }
          }
        }
      }

      // ── Move toward target cell center ────────────────────
      const dx   = npc.targetCx - npc.cx;
      const dy   = npc.targetCy - npc.cy;
      const dist = Math.hypot(dx, dy);

      if (dist <= npc.speed) {
        // Snap to center, pick next direction
        npc.cx  = npc.targetCx;
        npc.cy  = npc.targetCy;
        npc.row = Math.round((npc.cy / cell) - 0.5);
        npc.col = Math.round((npc.cx / cell) - 0.5);

        let dir = null;
        if (npc.mode === 'chase') dir = this._npcBfsNext(npc);

        if (!dir) {
          // Wander: random direction, preferring not to reverse
          const dirs = Object.keys(NPC_DIR_DELTA).filter(d => {
            if (this._isNpcWall(npc.row, npc.col, d)) return false;
            const [dr, dc] = NPC_DIR_DELTA[d];
            const nr = npc.row + dr, nc = npc.col + dc;
            return nr >= 0 && nr < rows && nc >= 0 && nc < cols;
          });
          const forward = dirs.filter(d => d !== REVERSE[npc.lastDir]);
          const pool    = forward.length ? forward : dirs;
          if (pool.length) dir = pool[Math.floor(Math.random() * pool.length)];
        }

        if (dir) {
          const [dr, dc] = NPC_DIR_DELTA[dir];
          npc.targetCx = ((npc.col + dc) + 0.5) * cell;
          npc.targetCy = ((npc.row + dr) + 0.5) * cell;
          npc.lastDir  = dir;
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
      ctx.shadowColor = npc.mode === 'chase' ? '#ff1744' : def.glowColor;
      ctx.shadowBlur  = npc.mode === 'chase' ? 28 : def.glowBlur;
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
    const chased = this._npcs.some(n => n.mode === 'chase');
    this._spellBarEl.classList.toggle('chased', chased);

    // NPC hit effect — border duration directly coupled to the active effect
    const npcEffects = [
      { until: this._glitchUntil,  color: NPC_DEFS[0].mapColor },
      { until: this._confuseUntil, color: NPC_DEFS[1].mapColor },
      { until: this._slowUntil,    color: NPC_DEFS[2].mapColor },
    ].filter(e => now < e.until);
    if (npcEffects.length > 0) {
      const active = npcEffects.reduce((a, b) => a.until > b.until ? a : b);
      const pulse  = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now / 500));
      const col    = active.color;
      const r = parseInt(col.slice(1, 3), 16);
      const g = parseInt(col.slice(3, 5), 16);
      const b = parseInt(col.slice(5, 7), 16);
      this._spellBarEl.style.boxShadow =
        `0 0 0 2px rgba(${r},${g},${b},${pulse.toFixed(2)}), ` +
        `0 0 8px rgba(${r},${g},${b},${(pulse * 0.4).toFixed(2)})`;
    } else {
      this._spellBarEl.style.boxShadow = '';
    }
    const hasPendingPortal = this._portalPairs.some(p => p.b === null);
    this._spellSlotEls[5]?.classList.toggle('portal-pending', hasPendingPortal);

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
    this._openedWall        = null;
    this._portalPairs       = [];
    this._portalStandStart  = null;
    this._fogCanvas         = null;
    this._pendingRespawns   = [];
    this._flickerUntil      = 0;
    this._revealedDeadCells = new Set();
    this._glitchUntil  = 0;
    this._glitchNextAt = 0;
    this._confuseUntil = 0;
    this._slowUntil    = 0;
    this._mmViewCol    = null;   // Minimap-Viewport, lazy initialisiert beim ersten Draw
    this._mmViewRow    = null;

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
        this.player._speed = performance.now() < this._slowUntil ? 1.5 : 3;
        let activeDirs = this._heldDirs;
        if (performance.now() < this._confuseUntil) {
          const FLIP = { N: 'S', S: 'N', E: 'W', W: 'E' };
          activeDirs = new Set([...this._heldDirs].map(d => FLIP[d] ?? d));
        }
        this.player.update(activeDirs);
        this._updateNpcs();
        this._tickGlitch();
        this._checkItemPickup();
        this._checkOpenedWall();
        this._checkPortalTeleport();
        this._tickRespawns();
      }
    }

    this._draw();
  }

  _draw() {
    const ctx = this.ctx;
    const now = performance.now();
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
    this._drawPortals(ctx);
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
    if (this._flickerUntil > now) {
      ctx.globalAlpha = Math.floor(now / 70) % 2 === 0 ? 0.15 : 1.0;
    } else if (this.player.phasing) {
      const pulse = 0.42 + 0.22 * Math.sin(now / 170);
      ctx.globalAlpha = pulse;
      ctx.shadowColor = '#90caf9';
      ctx.shadowBlur  = 24;
    }
    if (now < this._glitchUntil) {
      const pulse = Math.sin(now / 100);
      ctx.shadowColor = '#4fc3f7';
      ctx.shadowBlur  = 38 + 28 * pulse;
    } else if (now < this._confuseUntil) {
      const pulse = Math.sin(now / 100);
      ctx.shadowColor = '#ffd740';
      ctx.shadowBlur  = 38 + 28 * pulse;
    } else if (now < this._slowUntil) {
      const pulse = Math.sin(now / 100);
      ctx.shadowColor = '#69f0ae';
      ctx.shadowBlur  = 38 + 28 * pulse;
    }
    this.player.draw(ctx);
    ctx.restore();

    // Orakel: fog fades to 0 when active, returns over last 1 s
    const orakelAlpha = this._getSpellAlpha(6, 1);
    this._drawFog(ctx, vcx, psy, 1 - orakelAlpha, zoom);

    // NPC3-Slow: grünes Overlay über Map
    if (now < this._slowUntil) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 250);
      ctx.save();
      ctx.globalAlpha = 0.08 + 0.10 * pulse;
      ctx.fillStyle   = '#69f0ae';
      ctx.fillRect(0, 0, vw, vh);
      ctx.restore();
    }

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

    // While Sackgasse spell is active, permanently record dead ends for minimap
    if (deadAlpha > 0) {
      for (const key of this.player.knownDeadCells) this._revealedDeadCells.add(key);
    }

    this._drawMiniMap(ctx, solutionAlpha);
    this._drawDiscovery(ctx);
    this._drawTouchControls(ctx);
    this._updateSpellBar();
  }

  _drawMiniMap(ctx, solutionAlpha = 0) {
    const { cols, rows, cell: mazeCell, walls } = this.maze;

    const CS     = this._hasTouch ? 5 : 8;   // minimap px pro Maze-Zelle — fix, unabhängig von Maze-Größe
    const HALF   = this._hasTouch ? 8 : 12;  // Zellen vom Spieler bis zum Rand → 25×25 Sichtfenster
    const N      = HALF * 2 + 1;  // 25
    const GAP    = 1;              // 1-px Wandlücke zwischen Zellen
    const MARGIN = 2;              // Zellen Puffer zum Rand bevor Viewport nachrutscht

    // Spieler-Gitterposition (ganzzahlig)
    const pCol = Math.floor(this.player._cx / mazeCell);
    const pRow = Math.floor(this.player._cy / mazeCell);

    // Lazy-Init: Spieler unten-mitte, wie die Hauptansicht
    if (this._mmViewCol === null) {
      this._mmViewCol = pCol - HALF;
      this._mmViewRow = pRow - (N - 1);
    }

    // Viewport nachrutschen, sobald Spieler den Randbereich erreicht
    if (pCol < this._mmViewCol + MARGIN)           this._mmViewCol = pCol - MARGIN;
    if (pCol > this._mmViewCol + N - 1 - MARGIN)   this._mmViewCol = pCol - (N - 1 - MARGIN);
    if (pRow < this._mmViewRow + MARGIN)           this._mmViewRow = pRow - MARGIN;
    if (pRow > this._mmViewRow + N - 1 - MARGIN)   this._mmViewRow = pRow - (N - 1 - MARGIN);

    // Viewport auf Maze-Grenzen clippen — kein dunkler Rand außerhalb des Labyrinths
    const vc0 = Math.max(0, this._mmViewCol);
    const vr0 = Math.max(0, this._mmViewRow);
    const vc1 = Math.min(cols, this._mmViewCol + N);
    const vr1 = Math.min(rows, this._mmViewRow + N);

    // Minimap-Ursprung und tatsächliche Pixelgröße (variabel je nach Clipping)
    const ox    = 10;
    const oy    = 10;
    const mapW  = (vc1 - vc0) * CS;
    const mapH  = (vr1 - vr0) * CS;

    // Welt-Pixel → Minimap-Pixel (für kontinuierliche Positionen: NPCs, Portale, Spieler)
    const wToMx = wx => ox + (wx / mazeCell - vc0) * CS;
    const wToMy = wy => oy + (wy / mazeCell - vr0) * CS;

    // Gitterzelle → Minimap-Pixel (obere linke Ecke der Zelle)
    const cToMx = c => ox + (c - vc0) * CS;
    const cToMy = r => oy + (r - vr0) * CS;

    // Prüft, ob eine Gitterzelle im geclippten Viewport liegt
    const cellInView = (r, c) => c >= vc0 && c < vc1 && r >= vr0 && r < vr1;

    // Prüft, ob ein Minimap-Pixel innerhalb der Kartenfläche liegt
    const pixInView = (mx, my) =>
      mx >= ox && mx < ox + mapW && my >= oy && my < oy + mapH;

    ctx.save();

    // Hintergrund + Rahmen — exakt um den sichtbaren Maze-Bereich
    ctx.fillStyle   = 'rgba(5,5,15,0.75)';
    ctx.fillRect(ox, oy, mapW, mapH);
    ctx.strokeStyle = 'rgba(80,80,120,0.6)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(ox, oy, mapW, mapH);

    // Sackgassen (Sackgasse-Spell) — dunkles Grau
    ctx.fillStyle = '#3e3e52';
    for (const key of this._revealedDeadCells) {
      const r = Math.floor(key / cols);
      const c = key % cols;
      if (!cellInView(r, c)) continue;
      const mx = cToMx(c), my = cToMy(r);
      ctx.fillRect(mx, my, CS - GAP, CS - GAP);
      if (c + 1 < cols && !walls[r][c].E && this._revealedDeadCells.has(r * cols + c + 1) && cellInView(r, c + 1))
        ctx.fillRect(mx + CS - GAP, my, GAP, CS - GAP);
      if (r + 1 < rows && !walls[r][c].S && this._revealedDeadCells.has((r + 1) * cols + c) && cellInView(r + 1, c))
        ctx.fillRect(mx, my + CS - GAP, CS - GAP, GAP);
    }

    // Besuchte Gänge — helles Grau (übermalt Sackgassen)
    ctx.fillStyle = '#6a6a8a';
    const visited = this.player.visitedCells;
    for (const key of visited) {
      const r = Math.floor(key / cols);
      const c = key % cols;
      if (!cellInView(r, c)) continue;
      const mx = cToMx(c), my = cToMy(r);
      ctx.fillRect(mx, my, CS - GAP, CS - GAP);
      if (c + 1 < cols && !walls[r][c].E && visited.has(r * cols + c + 1) && cellInView(r, c + 1))
        ctx.fillRect(mx + CS - GAP, my, GAP, CS - GAP);
      if (r + 1 < rows && !walls[r][c].S && visited.has((r + 1) * cols + c) && cellInView(r + 1, c))
        ctx.fillRect(mx, my + CS - GAP, CS - GAP, GAP);
    }

    // Lösungspfad — nur sichtbare Segmente zeichnen
    if (solutionAlpha > 0) {
      const path = this.maze.solution();
      ctx.save();
      ctx.strokeStyle = '#e53935';
      ctx.lineWidth   = Math.max(1, CS / 5);
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.globalAlpha = solutionAlpha;
      ctx.beginPath();
      let penDown = false;
      for (const [r, c] of path) {
        if (!cellInView(r, c)) { penDown = false; continue; }
        const x = cToMx(c) + CS / 2;
        const y = cToMy(r) + CS / 2;
        if (!penDown) { ctx.moveTo(x, y); penDown = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Items — blinkende Punkte in Spell-Farbe
    const now = performance.now();
    for (const item of this._items) {
      if (!cellInView(item.row, item.col)) continue;
      const color = SPELL_DEFS[item.spellIndex]?.itemColor ?? '#ffffff';
      const blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 900 + item.col + item.row));
      ctx.globalAlpha = blink;
      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.arc(cToMx(item.col) + CS / 2, cToMy(item.row) + CS / 2,
              Math.max(1, CS * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Portal-Dots
    for (const pair of this._portalPairs) {
      for (const portal of [pair.a, pair.b]) {
        if (!portal) continue;
        const mx = wToMx(portal.cx);
        const my = wToMy(portal.cy);
        if (!pixInView(mx, my)) continue;
        ctx.globalAlpha = pair.b === null ? 0.5 + 0.5 * Math.sin(now / 280) : 1;
        ctx.fillStyle   = '#ffab40';
        ctx.shadowColor = '#ffab40';
        ctx.shadowBlur  = 5;
        ctx.beginPath();
        ctx.arc(mx, my, Math.max(1.5, CS * 0.65), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;

    // NPC-Dots
    for (const npc of this._npcs) {
      const mx = wToMx(npc.cx);
      const my = wToMy(npc.cy);
      if (!pixInView(mx, my)) continue;
      const npcColor  = NPC_DEFS[npc.spriteIndex].mapColor;
      ctx.fillStyle   = npcColor;
      ctx.shadowColor = npcColor;
      ctx.shadowBlur  = 5;
      ctx.beginPath();
      ctx.arc(mx, my, Math.max(1.5, CS * 0.65), 0, Math.PI * 2);
      ctx.fill();
    }

    // Spieler-Dot — folgt der echten Position, wandert frei im Viewport
    ctx.fillStyle   = this._robeColor ?? '#ffffff';
    ctx.shadowColor = this._robeColor ?? '#ffffff';
    ctx.shadowBlur  = 5;
    ctx.beginPath();
    ctx.arc(wToMx(this.player._cx), wToMy(this.player._cy),
            Math.max(1.5, CS * 0.65), 0, Math.PI * 2);
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
    let { fog, fade } = this._settings();
    if (performance.now() < this._slowUntil) fog = Math.round(fog * 0.5);
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

    const allPortals = this._portalPairs.flatMap(p => p.b ? [p.a, p.b] : [p.a]);
    if (allPortals.length > 0) {
      const ppx = this.player._cx;
      const ppy = this.player._cy;
      const br  = Math.max(30, fog * 0.5);
      const bf  = Math.min(fade, 40);
      fc.globalAlpha = 0.25;
      for (const portal of allPortals) {
        punchLight(cx + (portal.cx - ppx) * zoom, cy + (portal.cy - ppy) * zoom, br * zoom, bf * zoom);
      }
      fc.globalAlpha = 1;
    }

    ctx.save();
    ctx.globalAlpha = fogMult;
    ctx.drawImage(this._fogCanvas, 0, 0);
    ctx.restore();
  }
}

window.addEventListener('DOMContentLoaded', () => { window._game = new Game(); });
