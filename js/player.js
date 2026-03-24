/**
 * Player – pixel-precise movement with AABB collision against maze walls.
 *
 * Position: (this._cx, this._cy) = centre of the player in pixels (floats).
 * Hitbox   : square with half-width  hw = cell/2 - 1
 *            → always fits inside a corridor with 1 px to spare on each side.
 *
 * Called every frame with the Set of currently-held direction keys.
 * Axes are resolved independently so the player "slides" along walls.
 */
export class Player {
  constructor(maze) {
    this.maze   = maze;
    const { cell, cols, rows } = maze;
    const mid   = Math.floor(cols / 2);

    // Start centred in the entry cell (bottom-centre)
    this._cx   = (mid + 0.5) * cell;
    this._cy   = (rows - 0.5) * cell;
    this._speed  = 1.5;          // px per frame
    this._facing = 'N';          // last movement direction
    this.onGoal  = null;
    this._done   = false;
  }

  // ── public ───────────────────────────────────────────────────────────────

  /** Call once per frame; heldDirs is a Set<'N'|'S'|'E'|'W'> */
  update(heldDirs) {
    if (this._done) return;

    for (const dir of heldDirs) {
      if      (dir === 'N') this._moveY(-this._speed);
      else if (dir === 'S') this._moveY( this._speed);
      else if (dir === 'E') this._moveX( this._speed);
      else if (dir === 'W') this._moveX(-this._speed);
      this._facing = dir;   // last pressed key wins
    }

    // Win: centre has exited through the open north wall of the exit cell
    if (this._cy < 0) {
      this._done = true;
      if (this.onGoal) this.onGoal();
    }
  }

  draw(ctx) {
    const cell = this.maze.cell;
    const r    = Math.max(2, cell * 0.28);   // slightly smaller than before

    const DIR_ANGLE = { N: -Math.PI / 2, S: Math.PI / 2, E: 0, W: Math.PI };
    const angle     = DIR_ANGLE[this._facing];

    // Body
    ctx.fillStyle = '#1565c0';
    ctx.beginPath();
    ctx.arc(this._cx, this._cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Direction dot – small white circle near the edge in facing direction
    const dotR  = Math.max(1, r * 0.28);
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

  // ── private ──────────────────────────────────────────────────────────────

  _moveX(dx) {
    const { cell, rows, cols, walls } = this.maze;
    const hw  = cell / 2 - 1;
    const row = Math.floor(this._cy / cell);
    const col = Math.floor(this._cx / cell);

    if (row < 0 || row >= rows || col < 0 || col >= cols) return;

    const newCx = this._cx + dx;

    if (dx > 0) {
      const wallX = (col + 1) * cell;
      if (newCx + hw >= wallX && walls[row][col].E) {
        this._cx = wallX - hw;
        return;
      }
    } else {
      const wallX = col * cell;
      if (newCx - hw <= wallX && walls[row][col].W) {
        this._cx = wallX + hw;
        return;
      }
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
      if (newCy + hw >= wallY && (walls[row][col].S || row >= rows - 1)) {
        this._cy = wallY - hw;
        return;
      }
    } else {
      // Moving north
      const wallY = row * cell;
      if (newCy - hw <= wallY && walls[row][col].N) {
        // Outer north wall is solid unless this is the exit cell
        this._cy = wallY + hw;
        return;
      }
    }

    this._cy = newCy;
  }
}
