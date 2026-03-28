export class Player {
  constructor(maze) {
    this.maze   = maze;
    const { cell, cols, rows } = maze;
    const mid   = Math.floor(cols / 2);

    this._cx     = (mid + 0.5) * cell;
    this._cy     = (rows - 0.5) * cell;
    this._speed  = 1.5;
    this._facing = 'N';
    this.onGoal  = null;
    this._done   = false;

    this.visitedCells = new Set();
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
    const r    = Math.max(2, cell * 0.28);

    const DIR_ANGLE = { N: -Math.PI / 2, S: Math.PI / 2, E: 0, W: Math.PI };
    const angle     = DIR_ANGLE[this._facing];

    ctx.fillStyle = '#1565c0';
    ctx.beginPath();
    ctx.arc(this._cx, this._cy, r, 0, Math.PI * 2);
    ctx.fill();

    const dotR    = Math.max(1, r * 0.28);
    const dotDist = r * 0.48;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(
      this._cx + Math.cos(angle) * dotDist,
      this._cy + Math.sin(angle) * dotDist,
      dotR, 0, Math.PI * 2
    );
    ctx.fill();
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
