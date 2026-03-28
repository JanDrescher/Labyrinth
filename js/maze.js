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
    visited[0][0] = true;
    stack.push([0, 0]);

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

  draw(ctx) {
    const { cols, rows, cell } = this;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cols * cell, rows * cell);

    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth   = 1;
    ctx.lineCap     = 'square';

    ctx.beginPath();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cell;
        const y = r * cell;
        const w = this.walls[r][c];

        if (w.N) { ctx.moveTo(x,        y); ctx.lineTo(x + cell, y); }
        if (w.W) { ctx.moveTo(x, y);        ctx.lineTo(x, y + cell); }
        if (r === rows - 1 && w.S) { ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y + cell); }
        if (c === cols - 1 && w.E) { ctx.moveTo(x + cell, y); ctx.lineTo(x + cell, y + cell); }
      }
    }

    ctx.stroke();

    const mid = Math.floor(cols / 2);
    ctx.fillStyle = '#00c853';
    ctx.fillRect(mid * cell + 1, rows * cell - 3, cell - 2, 3);

    ctx.fillStyle = '#d50000';
    ctx.fillRect(mid * cell + 1, 0, cell - 2, 3);
  }

  // Counts only passages to valid in-bounds neighbours (entrance/exit external openings excluded)
  _openCount(r, c) {
    const w = this.walls[r][c];
    return (!w.N && r > 0              ? 1 : 0)
         + (!w.S && r < this.rows - 1  ? 1 : 0)
         + (!w.E && c < this.cols - 1  ? 1 : 0)
         + (!w.W && c > 0              ? 1 : 0);
  }

  // Traces from a dead-end cell through corridor cells; returns corridor array + junction cell
  _traceCorridor(r, c) {
    const STEP = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };
    const corridor = [[r, c]];
    let prevR = null, prevC = null, curR = r, curC = c;
    let junctionR = null, junctionC = null;

    while (true) {
      let nextR = null, nextC = null;
      for (const [dir, [dr, dc]] of Object.entries(STEP)) {
        if (this.walls[curR][curC][dir]) continue;
        const nr = curR + dr, nc = curC + dc;
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        if (nr === prevR && nc === prevC) continue;
        nextR = nr; nextC = nc;
      }
      if (nextR === null) break;
      if (this._openCount(nextR, nextC) !== 2) { junctionR = nextR; junctionC = nextC; break; }
      prevR = curR; prevC = curC;
      curR = nextR; curC = nextC;
      corridor.push([curR, curC]);
    }
    return { corridor, junctionR, junctionC };
  }

  deadEndCorridors() {
    if (this._deadEndCorridors) return this._deadEndCorridors;
    const exitC = Math.floor(this.cols / 2);
    const corridors = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (r === 0 && c === exitC) continue;          // exit is not a dead end
        if (this._openCount(r, c) === 1) corridors.push(this._traceCorridor(r, c));
      }
    }
    this._deadEndCorridors = corridors;
    return corridors;
  }

  drawDeadEnds(ctx, visitedCells) {
    const corridors = this.deadEndCorridors();
    const { cell, cols } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(120,120,140,0.4)';
    for (const { corridor, junctionR, junctionC } of corridors) {
      // Known if the junction connecting this corridor to the maze has been visited,
      // or if the player physically entered the corridor
      const junctionKnown = junctionR !== null && visitedCells.has(junctionR * cols + junctionC);
      const corridorKnown = corridor.some(([r, c]) => visitedCells.has(r * cols + c));
      if (!junctionKnown && !corridorKnown) continue;
      for (const [r, c] of corridor) {
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
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
