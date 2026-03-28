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

    this.visitedCells   = new Set();
    this.knownDeadCells = new Set();
    this.visitedCells.add((rows - 1) * cols + mid);
  }

  update(heldDirs) {
    if (this._done) return;

    for (const dir of heldDirs) {
      if      (dir === 'N') this._moveY(-this._speed);
      else if (dir === 'S') this._moveY( this._speed);
      else if (dir === 'E') this._moveX( this._speed);
      else if (dir === 'W') this._moveX(-this._speed);
      this._facing = dir;
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
    const cell = this.maze.cell;
    const r    = Math.max(4, cell * 0.30);

    const DIR_ANGLE = { N: -Math.PI / 2, S: Math.PI / 2, E: 0, W: Math.PI };
    const angle = DIR_ANGLE[this._facing];
    const perp  = angle + Math.PI / 2;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const cp = Math.cos(perp),  sp = Math.sin(perp);

    ctx.save();
    ctx.translate(this._cx, this._cy);

    // Pointed hat – drawn first so the robe circle covers its base
    ctx.fillStyle = '#311b92';
    ctx.beginPath();
    ctx.moveTo(ca * r * 1.85, sa * r * 1.85);                          // tip
    ctx.lineTo(ca * r * 0.1 + cp * r * 0.55, sa * r * 0.1 + sp * r * 0.55); // base left
    ctx.lineTo(ca * r * 0.1 - cp * r * 0.55, sa * r * 0.1 - sp * r * 0.55); // base right
    ctx.closePath();
    ctx.fill();

    // Robe body
    ctx.fillStyle = '#6a1b9a';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Subtle radial shine on robe
    const shine = ctx.createRadialGradient(-r * 0.25, -r * 0.25, 0, 0, 0, r);
    shine.addColorStop(0, 'rgba(186,104,200,0.45)');
    shine.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Golden stars on robe
    const SR = Math.max(1, r * 0.09);
    ctx.fillStyle = '#ffd740';
    for (const [fx, fy] of [[-0.45, 0.1], [0.35, -0.35], [0.1, 0.55], [-0.15, -0.55]]) {
      ctx.beginPath();
      ctx.arc(fx * r, fy * r, SR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Eyes – two white dots in facing direction
    const eD = r * 0.52, eS = r * 0.20;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(ca * eD + cp * eS * s, sa * eD + sp * eS * s, Math.max(1, r * 0.13), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
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
      if (newCx + hw >= wallX && walls[row][col].E) { this._cx = wallX - hw; return; }
    } else {
      const wallX = col * cell;
      if (newCx - hw <= wallX && walls[row][col].W) { this._cx = wallX + hw; return; }
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
      if (newCy + hw >= wallY && (walls[row][col].S || row >= rows - 1)) { this._cy = wallY - hw; return; }
    } else {
      const wallY = row * cell;
      if (newCy - hw <= wallY && walls[row][col].N) { this._cy = wallY + hw; return; }
    }

    this._cy = newCy;
  }
}
