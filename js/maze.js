/**
 * Maze – Recursive-Backtracker (DFS) generator + Canvas renderer
 *
 * Grid model
 * ----------
 * Each cell (row, col) stores which of its 4 walls are still standing:
 *   walls[r][c] = { N, E, S, W }   (true = wall present)
 *
 * With CELL = 10 px and a 200×200 px canvas we get a 20×20 grid.
 * The outer border is always kept intact (no opening to the outside
 * except the explicit entry/exit passages added at the end).
 */

export class Maze {
  /**
   * @param {number} cols   - number of columns  (default 20)
   * @param {number} rows   - number of rows      (default 20)
   * @param {number} cell   - cell size in pixels (default 10)
   */
  constructor(cols = 20, rows = 20, cell = 10) {
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;

    // Initialise: every wall standing
    this.walls = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ N: true, E: true, S: true, W: true }))
    );

    this._generate();

    // Entry: south wall of bottom-centre cell  →  unten Mitte
    // Exit : north wall of top-centre cell     →  oben Mitte
    const mid = Math.floor(cols / 2);
    this.walls[rows - 1][mid].S = false;
    this.walls[0][mid].N        = false;

    // Pre-compute dead-end cells (exactly one open passage)
    this.deadEnds = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.openPassages(r, c).length === 1) this.deadEnds.push([r, c]);
      }
    }
  }

  // ── private ─────────────────────────────────────────────────────────────

  _generate() {
    const visited = Array.from({ length: this.rows }, () =>
      new Array(this.cols).fill(false)
    );

    const stack = [];
    visited[0][0] = true;
    stack.push([0, 0]);

    while (stack.length > 0) {
      const [r, c]    = stack[stack.length - 1];
      const neighbors = this._unvisitedNeighbors(r, c, visited);

      if (neighbors.length > 0) {
        // Pick a random unvisited neighbour
        const [nr, nc, dir] = neighbors[Math.floor(Math.random() * neighbors.length)];

        // Carve passage (remove shared wall)
        this._removeWall(r, c, nr, nc, dir);

        visited[nr][nc] = true;
        stack.push([nr, nc]);
      } else {
        stack.pop();
      }
    }
  }

  _unvisitedNeighbors(r, c, visited) {
    const result = [];
    if (r > 0              && !visited[r - 1][c]) result.push([r - 1, c, 'N']);
    if (c < this.cols - 1  && !visited[r][c + 1]) result.push([r, c + 1, 'E']);
    if (r < this.rows - 1  && !visited[r + 1][c]) result.push([r + 1, c, 'S']);
    if (c > 0              && !visited[r][c - 1]) result.push([r, c - 1, 'W']);
    return result;
  }

  _removeWall(r, c, nr, nc, dir) {
    const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
    this.walls[r][c][dir]         = false;
    this.walls[nr][nc][OPPOSITE[dir]] = false;
  }

  // ── public ──────────────────────────────────────────────────────────────

  /** Returns an array of open directions ('N','E','S','W') for cell (r,c). */
  openPassages(r, c) {
    const w = this.walls[r][c];
    return ['N', 'E', 'S', 'W'].filter(d => !w[d]);
  }

  /**
   * Draw the maze onto a CanvasRenderingContext2D.
   * grayCells – optional Set of cell keys (r*cols+c) to shade as dead-end corridors.
   * Gray fill is painted before walls so walls remain crisp on top.
   */
  draw(ctx, grayCells = null) {
    const { cols, rows, cell } = this;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cols * cell, rows * cell);

    // Dead-end shading (before walls)
    if (grayCells && grayCells.size > 0) {
      ctx.fillStyle = 'rgba(168, 168, 185, 0.55)';
      for (const k of grayCells) {
        const r = Math.floor(k / cols);
        const c = k % cols;
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }

    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth   = 1;
    ctx.lineCap     = 'square';

    ctx.beginPath();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cell;
        const y = r * cell;
        const w = this.walls[r][c];

        // North wall
        if (w.N) {
          ctx.moveTo(x,        y);
          ctx.lineTo(x + cell, y);
        }
        // West wall
        if (w.W) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + cell);
        }
        // South wall – only for bottom row (inner S walls are N of next row)
        if (r === rows - 1 && w.S) {
          ctx.moveTo(x,        y + cell);
          ctx.lineTo(x + cell, y + cell);
        }
        // East wall – only for right column
        if (c === cols - 1 && w.E) {
          ctx.moveTo(x + cell, y);
          ctx.lineTo(x + cell, y + cell);
        }
      }
    }

    ctx.stroke();

    // Entry marker (green) – bottom centre
    const mid = Math.floor(cols / 2);
    ctx.fillStyle = '#00c853';
    ctx.fillRect(mid * cell + 1, rows * cell - 3, cell - 2, 3);

    // Exit marker (red) – top centre
    ctx.fillStyle = '#d50000';
    ctx.fillRect(mid * cell + 1, 0, cell - 2, 3);
  }

  /**
   * Return true when the player can move from (r,c) in direction dir.
   */
  canMove(r, c, dir) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
    return !this.walls[r][c][dir];
  }

  /**
   * BFS shortest path from entry (bottom-centre) to exit (top-centre).
   * Returns an array of [row, col] pairs. Result is cached.
   */
  solution() {
    if (this._solution) return this._solution;

    const mid   = Math.floor(this.cols / 2);
    const sr    = this.rows - 1, sc = mid;   // start = entry cell
    const er    = 0,             ec = mid;   // end   = exit  cell

    const key   = (r, c) => r * this.cols + c;
    const prev  = new Map();
    const queue = [[sr, sc]];
    prev.set(key(sr, sc), null);

    const STEP = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };

    outer: while (queue.length > 0) {
      const [r, c] = queue.shift();
      for (const [dir, [dr, dc]] of Object.entries(STEP)) {
        if (this.walls[r][c][dir]) continue;          // wall blocks
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        const k = key(nr, nc);
        if (prev.has(k)) continue;
        prev.set(k, [r, c]);
        if (nr === er && nc === ec) break outer;
        queue.push([nr, nc]);
      }
    }

    // Reconstruct path end → start, then reverse
    const path = [];
    let cur = [er, ec];
    while (cur) {
      path.push(cur);
      cur = prev.get(key(cur[0], cur[1]));
    }
    path.reverse();

    this._solution = path;
    return path;
  }

  /**
   * Draw the solution path as a red centre-line.
   */
  drawSolution(ctx) {
    const path = this.solution();
    const { cell } = this;

    ctx.save();
    ctx.strokeStyle = '#e53935';
    ctx.lineWidth   = Math.max(1, cell / 5);
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.globalAlpha = 0.75;

    ctx.beginPath();
    for (let i = 0; i < path.length; i++) {
      const [r, c] = path[i];
      const x = (c + 0.5) * cell;
      const y = (r + 0.5) * cell;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
