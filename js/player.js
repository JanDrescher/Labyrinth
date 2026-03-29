function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h, s, l) {
  h /= 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h)       * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
}

export class Player {
  constructor(maze) {
    this.maze   = maze;
    const { cell, cols, rows } = maze;
    const mid   = Math.floor(cols / 2);

    this._cx     = (mid + 0.5) * cell;
    this._cy     = (rows - 0.5) * cell;
    this._speed  = 3;
    this._facing = 'N';
    this.onGoal  = null;
    this._done   = false;

    this.phasing        = false;
    this.visitedCells   = new Set();
    this.knownDeadCells = new Set();
    this.visitedCells.add((rows - 1) * cols + mid);

    // Animation state
    this._animFrame = 0;
    this._animT     = 0;
    this._moving    = false;

    // Robe color: hex string, e.g. '#cc2200' for red. Default matches original sprite blue.
    this.robeColor = '#2b5aa8';

    // Color sheet cache — one per direction
    this._colorSheets     = {};
    this._colorSheetColor = null;

    // Sprites: one file per direction, 4 walk frames each
    this._spriteImgs = {};
    for (const [dir, file] of [['N','mage-n'],['S','mage-s'],['E','mage-e'],['W','mage-w']]) {
      const img = new Image();
      img.onload = () => { this._colorSheets = {}; };
      img.src    = `img/${file}.png`;
      this._spriteImgs[dir] = img;
    }
  }

  update(heldDirs) {
    if (this._done) return;

    this._moving = heldDirs.size > 0;

    for (const dir of heldDirs) {
      if      (dir === 'N') this._moveY(-this._speed);
      else if (dir === 'S') this._moveY( this._speed);
      else if (dir === 'E') this._moveX( this._speed);
      else if (dir === 'W') this._moveX(-this._speed);
      this._facing = dir;
    }

    // Advance walk animation
    if (this._moving) {
      const now = performance.now();
      if (now - this._animT > 150) {
        this._animFrame = (this._animFrame + 1) % 4;
        this._animT     = now;
      }
    } else {
      this._animFrame = 0;
    }

    const { cell, cols, rows } = this.maze;
    const row = Math.floor(this._cy / cell);
    const col = Math.floor(this._cx / cell);
    if (row >= 0 && row < rows && col >= 0 && col < cols) {
      this.visitedCells.add(row * cols + col);
    }

    if (this._cy < 0) {
      this._done = true;
      if (this.onGoal) this.onGoal();
    }
  }

  draw(ctx) {
    const img = this._spriteImgs[this._facing];
    if (!img.complete || !img.naturalWidth) return;

    if (this._colorSheetColor !== this.robeColor) {
      this._colorSheets     = {};
      this._colorSheetColor = this.robeColor;
    }
    if (!this._colorSheets[this._facing]) {
      this._colorSheets[this._facing] = this._buildColorSheet(img);
    }

    const sheet = this._colorSheets[this._facing];
    const FW    = Math.round(img.naturalWidth / 4);
    const FH    = img.naturalHeight;
    const cell  = this.maze.cell;
    const size  = Math.max(8, cell * 0.80);

    ctx.save();
    ctx.translate(this._cx, this._cy);
    ctx.drawImage(sheet, this._animFrame * FW, 0, FW, FH, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  // Pre-render sprite with robe/hat recolored via HSL hue substitution.
  // All pixels whose hue falls in the original blue range (~195–250°) get their
  // hue replaced with the target color's hue; saturation and lightness are kept.
  _buildColorSheet(img) {

    // Parse target color — accepts #rrggbb or hsl(H,S%,L%)
    let targetHue = 215;
    const mHex = this.robeColor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    const mHsl = this.robeColor.match(/^hsl\((\d+)/i);
    if (mHex) targetHue = rgbToHsl(parseInt(mHex[1],16), parseInt(mHex[2],16), parseInt(mHex[3],16))[0];
    else if (mHsl) targetHue = parseInt(mHsl[1], 10);

    // Draw full sprite onto offscreen canvas and read pixels
    const oc = document.createElement('canvas');
    oc.width  = img.naturalWidth;
    oc.height = img.naturalHeight;
    const c   = oc.getContext('2d');
    c.drawImage(img, 0, 0);

    const id   = c.getImageData(0, 0, oc.width, oc.height);
    const data = id.data;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;              // skip transparent

      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s < 0.15 || h < 195 || h > 250) continue; // not in robe-blue range

      const [r, g, b] = hslToRgb(targetHue, s, l);
      data[i]     = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }

    c.putImageData(id, 0, 0);
    return oc;
  }

  _moveX(dx) {
    const { cell, rows, cols, walls } = this.maze;
    const hw  = cell / 2 - 1;
    const row = Math.floor(this._cy / cell);
    const col = Math.floor(this._cx / cell);

    if (row < 0 || row >= rows || col < 0 || col >= cols) return;

    const newCx = this._cx + dx;

    if (dx > 0) {
      const wallX = (col + 1) * cell;
      if (!this.phasing && newCx + hw >= wallX && walls[row][col].E) { this._cx = wallX - hw; return; }
    } else {
      const wallX = col * cell;
      if (!this.phasing && newCx - hw <= wallX && walls[row][col].W) { this._cx = wallX + hw; return; }
    }

    this._cx = newCx;
  }

  _moveY(dy) {
    const { cell, rows, cols, walls } = this.maze;
    const hw  = cell / 2 - 1;
    const row = Math.floor(this._cy / cell);
    const col = Math.floor(this._cx / cell);

    if (row < 0 || row >= rows || col < 0 || col >= cols) return;

    const newCy = this._cy + dy;

    if (dy > 0) {
      const wallY = (row + 1) * cell;
      const blocked = (!this.phasing && walls[row][col].S) || row >= rows - 1;
      if (newCy + hw >= wallY && blocked) { this._cy = wallY - hw; return; }
    } else {
      const wallY = row * cell;
      if (!this.phasing && newCy - hw <= wallY && walls[row][col].N) { this._cy = wallY + hw; return; }
    }

    this._cy = newCy;
  }
}
