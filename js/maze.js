export class Maze {
  constructor(cols = 20, rows = 20, cell = 10) {
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;

    this.walls = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ N: true, E: true, S: true, W: true }))
    );

    this._generate();

    const mid = Math.floor(cols / 2);
    this.walls[rows - 1][mid].S = false;
    this.walls[0][mid].N        = false;
  }

  _generate() {
    const visited = Array.from({ length: this.rows }, () =>
      new Array(this.cols).fill(false)
    );

    const stack = [];
    const sr = Math.floor(Math.random() * this.rows);
    const sc = Math.floor(Math.random() * this.cols);
    visited[sr][sc] = true;
    stack.push([sr, sc]);

    while (stack.length > 0) {
      const [r, c]    = stack[stack.length - 1];
      const neighbors = this._unvisitedNeighbors(r, c, visited);

      if (neighbors.length > 0) {
        const [nr, nc, dir] = neighbors[Math.floor(Math.random() * neighbors.length)];
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
    this.walls[r][c][dir]             = false;
    this.walls[nr][nc][OPPOSITE[dir]] = false;
  }

  _makeFloorPattern(ctx) {
    // Running-bond (Mauerverband): row 2 offset by half a brick width
    const bw = 30, bh = 13, g = 2;          // brick width/height, grout thickness
    const tw = bw + g, th = 2 * (bh + g);   // tile canvas size
    const tc = document.createElement('canvas');
    tc.width = tw; tc.height = th;
    const t = tc.getContext('2d');

    // Grout / mortar
    t.fillStyle = '#57524e';
    t.fillRect(0, 0, tw, th);

    // edges: { top, bottom, left, right } — controls which sides get highlight/shadow
    const brick = (x, y, w, h, col, edges = {}) => {
      const { top = true, bottom = true, left = true, right = true } = edges;
      t.fillStyle = col;
      t.fillRect(x, y, w, h);
      t.fillStyle = 'rgba(255,255,255,0.13)';
      if (top)  t.fillRect(x, y, w, 2);
      if (left) t.fillRect(x, y, 2, h);
      t.fillStyle = 'rgba(0,0,0,0.18)';
      if (bottom) t.fillRect(x, y + h - 2, w, 2);
      if (right)  t.fillRect(x + w - 2, y, 2, h);
    };

    brick(0,          0,      bw,     bh, '#aaa29a');                    // row 1 – full brick
    brick(0,          bh + g, bw / 2, bh, '#b0a8a0', { left:  false }); // row 2 – left half  } same brick
    brick(bw / 2 + g, bh + g, bw / 2, bh, '#b0a8a0', { right: false }); // row 2 – right half } same brick

    return ctx.createPattern(tc, 'repeat');
  }

  _makeWallPattern(ctx) {
    // Rough stone blocks — larger and more irregular than the floor bricks
    const bw = 12, bh = 5, g = 2;         // block width/height, mortar thickness
    const tw = bw + g, th = 2 * (bh + g);   // tile canvas size (running bond)
    const tc = document.createElement('canvas');
    tc.width = tw; tc.height = th;
    const t = tc.getContext('2d');

    // Mortar — near-black with faint violet hint
    t.fillStyle = '#14121e';
    t.fillRect(0, 0, tw, th);

    const stone = (x, y, w, h, col, edges = {}) => {
      const { top = true, bottom = true, left = true, right = true, crack = true } = edges;
      t.fillStyle = col;
      t.fillRect(x, y, w, h);
      // subtle top-left highlight
      t.fillStyle = 'rgba(180,160,255,0.07)';
      if (top)  t.fillRect(x, y, w, 2);
      if (left) t.fillRect(x, y, 2, h);
      // bottom-right shadow
      t.fillStyle = 'rgba(0,0,0,0.35)';
      if (bottom) t.fillRect(x, y + h - 2, w, 2);
      if (right)  t.fillRect(x + w - 2, y, 2, h);
      // faint internal crack / texture noise
      if (crack) {
        t.fillStyle = 'rgba(0,0,0,0.12)';
        t.fillRect(x + Math.floor(w * 0.4), y + 2, 1, h - 4);
      }
    };

    // Row 1 — one full block
    stone(0,             0,      bw,        bh, '#2a2640');
    // Row 2 — two half blocks (offset by half, running bond) — same virtual stone
    stone(0,             bh + g, bw * 0.45, bh, '#2a2640', { left: false, crack: false });
    stone(bw * 0.45 + g, bh + g, bw * 0.55, bh, '#2a2640', { right: false });

    // Faint magic glow in mortar seam between rows (horizontal line)
    t.fillStyle = 'rgba(100,80,180,0.12)';
    t.fillRect(0, bh, tw, g);

    return ctx.createPattern(tc, 'repeat');
  }

  draw(ctx) {
    const { cols, rows, cell } = this;
    const W = Math.max(3, Math.round(cell * 0.15)); // wall half-thickness per side

    // Fill entire area with floor pattern
    if (!this._floorPattern) this._floorPattern = this._makeFloorPattern(ctx);
    ctx.fillStyle = this._floorPattern;
    ctx.fillRect(0, 0, cols * cell, rows * cell);

    // Draw walls as stroked path segments (lineWidth = 2W, square caps fill corners)
    if (!this._wallPattern) this._wallPattern = this._makeWallPattern(ctx);
    ctx.save();
    ctx.strokeStyle = this._wallPattern;
    ctx.lineWidth   = 2 * W;
    ctx.lineCap     = 'round';

    ctx.beginPath();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.walls[r][c].N) {
          ctx.moveTo( c      * cell, r * cell);
          ctx.lineTo((c + 1) * cell, r * cell);
        }
        if (this.walls[r][c].W) {
          ctx.moveTo(c * cell,  r      * cell);
          ctx.lineTo(c * cell, (r + 1) * cell);
        }
      }
    }

    // South border (bottom row)
    for (let c = 0; c < cols; c++) {
      if (this.walls[rows - 1][c].S) {
        ctx.moveTo( c      * cell, rows * cell);
        ctx.lineTo((c + 1) * cell, rows * cell);
      }
    }

    // East border (rightmost column)
    for (let r = 0; r < rows; r++) {
      if (this.walls[r][cols - 1].E) {
        ctx.moveTo(cols * cell,  r      * cell);
        ctx.lineTo(cols * cell, (r + 1) * cell);
      }
    }

    ctx.stroke();
    ctx.restore();

    // Entrance marker (green) and exit marker (red)
    const mid = Math.floor(cols / 2);
    const s   = cell - 2 * W;
    ctx.fillStyle = '#00c853';
    ctx.fillRect(mid * cell + W, rows * cell - 3, s, 3);
    ctx.fillStyle = '#d50000';
    ctx.fillRect(mid * cell + W, 0, s, 3);
  }

  // Discovers new dead-end regions (fog-bounded flood fill from visited cells),
  // persists them in knownDeadCells, then draws all known dead cells.
  drawDeadEnds(ctx, visitedCells, knownDeadCells, playerCx, playerCy, fogRadius, alpha = 1) {
    const { cell, cols, rows, walls } = this;
    const DIRS = [['N', -1, 0], ['S', 1, 0], ['E', 0, 1], ['W', 0, -1]];
    const key   = (r, c) => r * cols + c;
    const fogR2 = fogRadius * fogRadius;
    const dist2 = (r, c) => {
      const dx = (c + 0.5) * cell - playerCx;
      const dy = (r + 0.5) * cell - playerCy;
      return dx * dx + dy * dy;
    };

    const processed = new Set();   // cells already handled this frame

    for (const vKey of visitedCells) {
      const vr = Math.floor(vKey / cols);
      const vc = vKey % cols;

      for (const [dir, dr, dc] of DIRS) {
        if (walls[vr][vc][dir]) continue;
        const sr = vr + dr, sc = vc + dc;
        if (sr < 0 || sr >= rows || sc < 0 || sc >= cols) continue;
        const sk = key(sr, sc);
        // skip if already visited, already known dead, or already processed this frame
        if (visitedCells.has(sk) || knownDeadCells.has(sk) || processed.has(sk)) continue;

        // BFS: collect unvisited, non-dead cells reachable within fog from (sr, sc)
        const region = new Set([sk]);
        const queue  = [[sr, sc]];
        let head     = 0;
        let deadEnd  = true;

        while (head < queue.length) {
          const [r, c] = queue[head++];

          for (const [d2, dr2, dc2] of DIRS) {
            if (walls[r][c][d2]) continue;
            const nr = r + dr2, nc = c + dc2;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
              // An open wall leaving the grid is a real exit (the entrance going south
              // is nr >= rows — that one is a dead end; anything else, e.g. the exit
              // going north with nr < 0, is a genuine way out)
              if (nr < 0) deadEnd = false;
              continue;
            }
            const k2 = key(nr, nc);
            if (visitedCells.has(k2))   continue;   // visited = boundary
            if (knownDeadCells.has(k2)) continue;   // already dead = boundary
            if (region.has(k2))         continue;

            if (dist2(nr, nc) > fogR2) {
              deadEnd = false;   // passage leads into unseen territory
              continue;          // don't expand outside fog
            }
            region.add(k2);
            queue.push([nr, nc]);
          }
        }

        for (const k of region) processed.add(k);
        if (deadEnd) for (const k of region) knownDeadCells.add(k);
      }
    }

    // Draw all persistently known dead cells (including those the player has since walked through)
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(18,14,32,0.78)';
    for (const k of knownDeadCells) {
      const r = Math.floor(k / cols);
      const c = k % cols;
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
    ctx.restore();
  }

  canMove(r, c, dir) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
    return !this.walls[r][c][dir];
  }

  solution() {
    if (this._solution) return this._solution;

    const mid   = Math.floor(this.cols / 2);
    const sr    = this.rows - 1, sc = mid;
    const er    = 0,             ec = mid;

    const key   = (r, c) => r * this.cols + c;
    const prev  = new Map();
    const queue = [[sr, sc]];
    prev.set(key(sr, sc), null);

    const STEP = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };

    outer: while (queue.length > 0) {
      const [r, c] = queue.shift();
      for (const [dir, [dr, dc]] of Object.entries(STEP)) {
        if (this.walls[r][c][dir]) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        const k = key(nr, nc);
        if (prev.has(k)) continue;
        prev.set(k, [r, c]);
        if (nr === er && nc === ec) break outer;
        queue.push([nr, nc]);
      }
    }

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

  drawSolution(ctx, alpha = 0.75) {
    const path = this.solution();
    const { cell } = this;

    ctx.save();
    ctx.strokeStyle = '#e53935';
    ctx.lineWidth   = Math.max(1, cell / 5);
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.globalAlpha = alpha;

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
