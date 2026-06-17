// grid.js — Tile map data structure + placement + wire graph.
// The grid is the authoritative world model: which service sits on each tile and
// which tiles are wired to which. Rendering and pathfinding read from here.
//
// Coordinate model:
//   - Tile coords (col,row) are integers in [0,cols)/[0,rows).
//   - World coords are tile coords * TILE (pixels). The grid's top-left is (0,0).
//
// Connections are stored as an undirected set of "edge keys" so each wire is
// recorded once, plus a per-tile adjacency list for fast pathfinding.

export const TILE = 72; // world pixels per tile

export class Building {
  constructor(service, col, row) {
    this.service = service; // catalog record
    this.col = col;
    this.row = row;
    // Light per-building animation state (googly-eye look-around, bob).
    this.bob = Math.random() * Math.PI * 2;
    this.eyeTargetX = 0;
    this.eyeTargetY = 0;
    // Visual pulse when a packet visits (set by sim, decays in render).
    this.activity = 0;
    // Phase-2 runtime state (set by the load model / event director each tick;
    // read by the renderer + tooltips). Safe defaults so Phase-1 paths still work.
    this.load = 0; // demand/capacity pressure (0 healthy, >1 overloaded)
    this.heat = 0; // eased load, drives the overload tint
    this.queue = 0; // backed-up requests
    this.latencyMs = service.latency; // live latency (rises with the queue)
    this.dropping = false; // shedding requests this tick?
    this.disabled = false; // offline (e.g. its AZ failed)
  }
}

export class Grid {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.buildings = new Map(); // key "c,r" -> Building
    this.edges = new Set(); // undirected edge keys "c1,r1|c2,r2" (sorted)
    this.adj = new Map(); // "c,r" -> Set of neighbor keys "c,r"
  }

  // ---- helpers ---------------------------------------------------------
  static key(c, r) {
    return c + "," + r;
  }
  static parseKey(k) {
    const i = k.indexOf(",");
    return [parseInt(k.slice(0, i), 10), parseInt(k.slice(i + 1), 10)];
  }
  inBounds(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }
  worldWidth() {
    return this.cols * TILE;
  }
  worldHeight() {
    return this.rows * TILE;
  }

  // ---- buildings -------------------------------------------------------
  getBuilding(c, r) {
    return this.buildings.get(Grid.key(c, r)) || null;
  }
  hasBuilding(c, r) {
    return this.buildings.has(Grid.key(c, r));
  }

  place(service, c, r) {
    if (!this.inBounds(c, r)) return null;
    if (this.hasBuilding(c, r)) return null;
    const b = new Building(service, c, r);
    this.buildings.set(Grid.key(c, r), b);
    return b;
  }

  // Remove a building and every wire attached to it.
  remove(c, r) {
    const k = Grid.key(c, r);
    const b = this.buildings.get(k);
    if (!b) return null;
    this.buildings.delete(k);
    // Tear down wires touching this tile.
    const neighbors = this.adj.get(k);
    if (neighbors) {
      for (const nk of Array.from(neighbors)) {
        this._removeEdgeByKeys(k, nk);
      }
    }
    this.adj.delete(k);
    return b;
  }

  // ---- wires / edges ---------------------------------------------------
  static edgeKey(aKey, bKey) {
    return aKey < bKey ? aKey + "|" + bKey : bKey + "|" + aKey;
  }

  hasEdge(aKey, bKey) {
    return this.edges.has(Grid.edgeKey(aKey, bKey));
  }

  // Are two tiles adjacent? 8-neighbour (orthogonal + diagonal) so wires and
  // routes can run diagonally across the grid (Phase 3: T3.9). Excludes self.
  static areAdjacent(c1, r1, c2, r2) {
    const dc = Math.abs(c1 - c2);
    const dr = Math.abs(r1 - r2);
    return dc <= 1 && dr <= 1 && dc + dr > 0;
  }

  addEdge(aKey, bKey) {
    const ek = Grid.edgeKey(aKey, bKey);
    if (this.edges.has(ek)) return false;
    this.edges.add(ek);
    this._adjSet(aKey).add(bKey);
    this._adjSet(bKey).add(aKey);
    return true;
  }

  _removeEdgeByKeys(aKey, bKey) {
    const ek = Grid.edgeKey(aKey, bKey);
    if (!this.edges.has(ek)) return false;
    this.edges.delete(ek);
    const a = this.adj.get(aKey);
    const b = this.adj.get(bKey);
    if (a) a.delete(bKey);
    if (b) b.delete(aKey);
    return true;
  }

  removeEdge(c1, r1, c2, r2) {
    return this._removeEdgeByKeys(Grid.key(c1, r1), Grid.key(c2, r2));
  }

  _adjSet(k) {
    let s = this.adj.get(k);
    if (!s) {
      s = new Set();
      this.adj.set(k, s);
    }
    return s;
  }

  neighbors(k) {
    return this.adj.get(k) || EMPTY;
  }

  // Iterate all edges as [c1,r1,c2,r2] for rendering.
  forEachEdge(fn) {
    for (const ek of this.edges) {
      const bar = ek.indexOf("|");
      const [c1, r1] = Grid.parseKey(ek.slice(0, bar));
      const [c2, r2] = Grid.parseKey(ek.slice(bar + 1));
      fn(c1, r1, c2, r2);
    }
  }
}

const EMPTY = new Set();
