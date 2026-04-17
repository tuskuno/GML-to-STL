import { useState, useCallback, useRef, useEffect } from "react";

const COLORS = {
  bg: "#0a0c10",
  surface: "#12151c",
  surfaceHover: "#1a1e28",
  border: "#1e2330",
  borderActive: "#3b82f6",
  accent: "#3b82f6",
  accentGlow: "rgba(59, 130, 246, 0.15)",
  text: "#e2e8f0",
  textMuted: "#64748b",
  textDim: "#475569",
  success: "#22c55e",
  successGlow: "rgba(34, 197, 94, 0.12)",
  warning: "#f59e0b",
  error: "#ef4444",
};

// ── Earcut triangulation (minimal implementation) ──
function earcut(data, holeIndices, dim = 2) {
  const hasHoles = holeIndices && holeIndices.length;
  const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
  let outerNode = linkedList(data, 0, outerLen, dim, true);
  const triangles = [];
  if (!outerNode || outerNode.next === outerNode.prev) return triangles;
  if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
  let minX, minY, maxX, maxY, invSize;
  if (data.length > 80 * dim) {
    minX = maxX = data[0];
    minY = maxY = data[1];
    for (let i = dim; i < outerLen; i += dim) {
      const x = data[i], y = data[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 1 / invSize : 0;
  }
  earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
  return triangles;
}

function linkedList(data, start, end, dim, clockwise) {
  let last;
  if (clockwise === (signedArea(data, start, end, dim) > 0)) {
    for (let i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
  } else {
    for (let i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
  }
  if (last && equals(last, last.next)) { removeNode(last); last = last.next; }
  if (!last) return null;
  last.next.prev = last;
  last.prev.next = last;
  return last.next;
}

function filterPoints(start, end) {
  if (!start) return start;
  if (!end) end = start;
  let p = start, again;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else { p = p.next; }
  } while (again || p !== end);
  return end;
}

function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
  if (!ear) return;
  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
  let stop = ear, prev, next;
  while (ear.prev !== ear.next) {
    prev = ear.prev;
    next = ear.next;
    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      triangles.push(prev.i / dim, ear.i / dim, next.i / dim);
      removeNode(ear);
      ear = next.next;
      stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (!pass) earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
      else if (pass === 1) { ear = cureLocalIntersections(filterPoints(ear), triangles, dim); earcutLinked(ear, triangles, dim, minX, minY, invSize, 2); }
      else if (pass === 2) splitEarcut(ear, triangles, dim, minX, minY, invSize);
      break;
    }
  }
}

function isEar(ear) {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  let p = ear.next.next;
  while (p !== ear.prev) {
    if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}

function isEarHashed(ear, minX, minY, invSize) {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  const minTX = Math.min(a.x, b.x, c.x), minTY = Math.min(a.y, b.y, c.y);
  const maxTX = Math.max(a.x, b.x, c.x), maxTY = Math.max(a.y, b.y, c.y);
  const minZ = zOrder(minTX, minTY, minX, minY, invSize);
  const maxZ = zOrder(maxTX, maxTY, minX, minY, invSize);
  let p = ear.prevZ, n = ear.nextZ;
  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (p !== ear.prev && p !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
    if (n !== ear.prev && n !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }
  while (p && p.z >= minZ) {
    if (p !== ear.prev && p !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
  }
  while (n && n.z <= maxZ) {
    if (n !== ear.prev && n !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }
  return true;
}

function cureLocalIntersections(start, triangles, dim) {
  let p = start;
  do {
    const a = p.prev, b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i / dim, p.i / dim, b.i / dim);
      removeNode(p);
      removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p);
}

function splitEarcut(start, triangles, dim, minX, minY, invSize) {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        a = filterPoints(a, a.next);
        c = filterPoints(c, c.next);
        earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
        earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

function eliminateHoles(data, holeIndices, outerNode, dim) {
  const queue = [];
  for (let i = 0, len = holeIndices.length; i < len; i++) {
    const start = holeIndices[i] * dim;
    const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
    const list = linkedList(data, start, end, dim, false);
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }
  queue.sort((a, b) => a.x - b.x);
  for (let i = 0; i < queue.length; i++) outerNode = eliminateHole(queue[i], outerNode);
  return outerNode;
}

function eliminateHole(hole, outerNode) {
  outerNode = findHoleBridge(hole, outerNode);
  if (outerNode) {
    const b = splitPolygon(outerNode, hole);
    filterPoints(outerNode, outerNode.next);
    filterPoints(b, b.next);
  }
}

function findHoleBridge(hole, outerNode) {
  let p = outerNode, hx = hole.x, hy = hole.y, qx = -Infinity, m;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) { qx = x; if (x === hx) { if (hy === p.y) return p; if (hy === p.next.y) return p.next; } m = p.x < p.next.x ? p : p.next; }
    }
    p = p.next;
  } while (p !== outerNode);
  if (!m) return null;
  if (hx === qx) return m;
  const stop = m;
  const mx = m.x, my = m.y;
  let tanMin = Infinity, tan;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) { m = p; tanMin = tan; }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}

function sectorContainsSector(m, p) { return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0; }

function indexCurve(start, minX, minY, invSize) {
  let p = start;
  do { if (p.z === null) p.z = zOrder(p.x, p.y, minX, minY, invSize); p.prevZ = p.prev; p.nextZ = p.next; p = p.next; } while (p !== start);
  p.prevZ.nextZ = null;
  p.prevZ = null;
  sortLinked(p);
}

function sortLinked(list) {
  let i, p, q, e, tail, numMerges, pSize, qSize, inSize = 1;
  do {
    p = list; list = null; tail = null; numMerges = 0;
    while (p) {
      numMerges++; q = p; pSize = 0;
      for (i = 0; i < inSize; i++) { pSize++; q = q.nextZ; if (!q) break; }
      qSize = inSize;
      while (pSize > 0 || (qSize > 0 && q)) {
        if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) { e = p; p = p.nextZ; pSize--; } else { e = q; q = q.nextZ; qSize--; }
        if (tail) tail.nextZ = e; else list = e;
        e.prevZ = tail; tail = e;
      }
      p = q;
    }
    tail.nextZ = null;
    inSize *= 2;
  } while (numMerges > 1);
  return list;
}

function zOrder(x, y, minX, minY, invSize) {
  x = 32767 * (x - minX) * invSize;
  y = 32767 * (y - minY) * invSize;
  x = (x | (x << 8)) & 0x00FF00FF; x = (x | (x << 4)) & 0x0F0F0F0F; x = (x | (x << 2)) & 0x33333333; x = (x | (x << 1)) & 0x55555555;
  y = (y | (y << 8)) & 0x00FF00FF; y = (y | (y << 4)) & 0x0F0F0F0F; y = (y | (y << 2)) & 0x33333333; y = (y | (y << 1)) & 0x55555555;
  return x | (y << 1);
}

function getLeftmost(start) { let p = start, leftmost = start; do { if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p; p = p.next; } while (p !== start); return leftmost; }
function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) { return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 && (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 && (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0; }
function isValidDiagonal(a, b) { return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) && (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) || area(a, b.prev, b)) || equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0); }
function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
function equals(p1, p2) { return p1.x === p2.x && p1.y === p2.y; }
function intersects(p1, q1, p2, q2) { const o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2)), o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1)); if (o1 !== o2 && o3 !== o4) return true; if (o1 === 0 && onSegment(p1, p2, q1)) return true; if (o2 === 0 && onSegment(p1, q2, q1)) return true; if (o3 === 0 && onSegment(p2, p1, q2)) return true; if (o4 === 0 && onSegment(p2, q1, q2)) return true; return false; }
function onSegment(p, q, r) { return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y); }
function sign(num) { return num > 0 ? 1 : num < 0 ? -1 : 0; }
function intersectsPolygon(a, b) { let p = a; do { if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true; p = p.next; } while (p !== a); return false; }
function locallyInside(a, b) { return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0; }
function middleInside(a, b) { let p = a, inside = false; const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2; do { if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) inside = !inside; p = p.next; } while (p !== a); return inside; }
function splitPolygon(a, b) { const a2 = createNode(a.i, a.x, a.y), b2 = createNode(b.i, b.x, b.y), an = a.next, bp = b.prev; a.next = b; b.prev = a; a2.next = an; an.prev = a2; b2.next = a2; a2.prev = b2; bp.next = b2; b2.prev = bp; return b2; }
function insertNode(i, x, y, last) { const p = createNode(i, x, y); if (!last) { p.prev = p; p.next = p; } else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; } return p; }
function removeNode(p) { p.next.prev = p.prev; p.prev.next = p.next; if (p.prevZ) p.prevZ.nextZ = p.nextZ; if (p.nextZ) p.nextZ.prevZ = p.prevZ; }
function createNode(i, x, y) { return { i, x, y, prev: null, next: null, z: null, prevZ: null, nextZ: null, steiner: false }; }
function signedArea(data, start, end, dim) { let sum = 0; for (let i = start, j = end - dim; i < end; i += dim) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; } return sum; }

// ── CityGML Parsing ──

function parseCityGML(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("Invalid XML: " + parseError.textContent.slice(0, 200));

  const polygons = [];
  const stats = { buildings: 0, surfaces: 0, polygons: 0 };

  // Extract CRS / srsName from the document
  let crs = null;
  // Check Envelope, boundedBy, or any element with srsName
  const envelopes = doc.getElementsByTagNameNS("*", "Envelope");
  for (const env of envelopes) {
    const srs = env.getAttribute("srsName");
    if (srs) { crs = srs; break; }
  }
  if (!crs) {
    // Try any element with srsName
    const all = doc.querySelectorAll("[srsName]");
    if (all.length > 0) crs = all[0].getAttribute("srsName");
  }

  // Collect all posList and pos elements from polygon geometry
  const allPolygons = doc.getElementsByTagNameNS("*", "Polygon");
  if (allPolygons.length === 0) {
    // Try LinearRing directly
    const rings = doc.getElementsByTagNameNS("*", "LinearRing");
    for (const ring of rings) {
      const coords = extractRingCoords(ring);
      if (coords && coords.length >= 3) {
        polygons.push(coords);
        stats.polygons++;
      }
    }
  } else {
    for (const poly of allPolygons) {
      const exterior = poly.getElementsByTagNameNS("*", "exterior")[0];
      if (!exterior) continue;
      const ring = exterior.getElementsByTagNameNS("*", "LinearRing")[0];
      if (!ring) continue;
      const coords = extractRingCoords(ring);
      if (coords && coords.length >= 3) {
        polygons.push(coords);
        stats.polygons++;
      }
    }
  }

  // Count buildings
  const bldgTags = ["Building", "BuildingPart", "BuildingInstallation"];
  for (const tag of bldgTags) {
    stats.buildings += doc.getElementsByTagNameNS("*", tag).length;
  }

  // Count surfaces
  const surfTags = ["WallSurface", "RoofSurface", "GroundSurface", "ClosureSurface", "FloorSurface", "OuterFloorSurface", "OuterCeilingSurface"];
  for (const tag of surfTags) {
    stats.surfaces += doc.getElementsByTagNameNS("*", tag).length;
  }

  return { polygons, stats, crs };
}

function extractRingCoords(ring) {
  // Try posList first
  const posList = ring.getElementsByTagNameNS("*", "posList")[0];
  if (posList) {
    const nums = posList.textContent.trim().split(/\s+/).map(Number);
    const coords = [];
    const dim = parseInt(posList.getAttribute("srsDimension") || posList.getAttribute("dimension") || "3");
    for (let i = 0; i + dim - 1 < nums.length; i += dim) {
      coords.push([nums[i], nums[i + 1], dim >= 3 ? nums[i + 2] : 0]);
    }
    // Remove closing point if same as first
    if (coords.length > 1) {
      const f = coords[0], l = coords[coords.length - 1];
      if (f[0] === l[0] && f[1] === l[1] && f[2] === l[2]) coords.pop();
    }
    return coords;
  }

  // Try individual pos elements
  const posElems = ring.getElementsByTagNameNS("*", "pos");
  if (posElems.length > 0) {
    const coords = [];
    for (const p of posElems) {
      const nums = p.textContent.trim().split(/\s+/).map(Number);
      coords.push([nums[0], nums[1], nums.length >= 3 ? nums[2] : 0]);
    }
    if (coords.length > 1) {
      const f = coords[0], l = coords[coords.length - 1];
      if (f[0] === l[0] && f[1] === l[1] && f[2] === l[2]) coords.pop();
    }
    return coords;
  }

  // Try coordinates element (GML 2)
  const coordinates = ring.getElementsByTagNameNS("*", "coordinates")[0];
  if (coordinates) {
    const tuples = coordinates.textContent.trim().split(/\s+/);
    const coords = tuples.map(t => {
      const parts = t.split(",").map(Number);
      return [parts[0], parts[1], parts.length >= 3 ? parts[2] : 0];
    });
    if (coords.length > 1) {
      const f = coords[0], l = coords[coords.length - 1];
      if (f[0] === l[0] && f[1] === l[1] && f[2] === l[2]) coords.pop();
    }
    return coords;
  }

  return null;
}

// ── Triangulation & STL ──

function cleanPolygonVertices(vertices3d) {
  // Remove duplicate consecutive vertices and near-degenerate edges
  const EPS = 1e-8;
  const cleaned = [vertices3d[0]];
  for (let i = 1; i < vertices3d.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    const curr = vertices3d[i];
    const dx = curr[0] - prev[0], dy = curr[1] - prev[1], dz = curr[2] - prev[2];
    if (dx * dx + dy * dy + dz * dz > EPS * EPS) {
      cleaned.push(curr);
    }
  }
  // Check last vs first
  if (cleaned.length > 1) {
    const f = cleaned[0], l = cleaned[cleaned.length - 1];
    const dx = f[0] - l[0], dy = f[1] - l[1], dz = f[2] - l[2];
    if (dx * dx + dy * dy + dz * dz < EPS * EPS) cleaned.pop();
  }
  return cleaned;
}

function removeCollinearVertices(vertices3d) {
  // Remove vertices that are collinear with their neighbors
  const EPS = 1e-10;
  if (vertices3d.length <= 3) return vertices3d;
  const result = [];
  const n = vertices3d.length;
  for (let i = 0; i < n; i++) {
    const prev = vertices3d[(i - 1 + n) % n];
    const curr = vertices3d[i];
    const next = vertices3d[(i + 1) % n];
    // Cross product of (curr-prev) x (next-prev)
    const ux = curr[0] - prev[0], uy = curr[1] - prev[1], uz = curr[2] - prev[2];
    const vx = next[0] - prev[0], vy = next[1] - prev[1], vz = next[2] - prev[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz > EPS) {
      result.push(curr);
    }
  }
  return result.length >= 3 ? result : vertices3d;
}

function fanTriangulate(numVerts) {
  // Simple fan triangulation as fallback
  const indices = [];
  for (let i = 1; i < numVerts - 1; i++) {
    indices.push(0, i, i + 1);
  }
  return indices;
}

function triangulatePolygon(vertices3d) {
  if (vertices3d.length < 3) return [];
  if (vertices3d.length === 3) return [0, 1, 2];

  // Clean up the polygon
  let cleaned = cleanPolygonVertices(vertices3d);
  cleaned = removeCollinearVertices(cleaned);
  if (cleaned.length < 3) return [];
  if (cleaned.length === 3) return [0, 1, 2];

  // Build an index map from cleaned back to original (for matching vertices)
  // Since we may have removed vertices, we need to map cleaned indices to original
  // We'll work with cleaned vertices directly and return indices into cleaned array
  const verts = cleaned;

  // Compute polygon normal using Newell's method
  const norm = [0, 0, 0];
  for (let i = 0; i < verts.length; i++) {
    const curr = verts[i];
    const next = verts[(i + 1) % verts.length];
    norm[0] += (curr[1] - next[1]) * (curr[2] + next[2]);
    norm[1] += (curr[2] - next[2]) * (curr[0] + next[0]);
    norm[2] += (curr[0] - next[0]) * (curr[1] + next[1]);
  }
  const len = Math.sqrt(norm[0] * norm[0] + norm[1] * norm[1] + norm[2] * norm[2]);
  if (len < 1e-10) return fanTriangulate(verts.length); // degenerate normal, try fan
  norm[0] /= len; norm[1] /= len; norm[2] /= len;

  // Project to 2D using a proper orthonormal basis on the polygon plane
  // This is more robust than axis-dropping for near-axis-aligned polygons
  // Pick a reference edge to build tangent
  let refIdx = 0;
  let maxEdgeLen = 0;
  for (let i = 0; i < verts.length; i++) {
    const next = verts[(i + 1) % verts.length];
    const dx = next[0] - verts[i][0], dy = next[1] - verts[i][1], dz = next[2] - verts[i][2];
    const elen = dx * dx + dy * dy + dz * dz;
    if (elen > maxEdgeLen) { maxEdgeLen = elen; refIdx = i; }
  }
  
  const refNext = verts[(refIdx + 1) % verts.length];
  let tx = refNext[0] - verts[refIdx][0];
  let ty = refNext[1] - verts[refIdx][1];
  let tz = refNext[2] - verts[refIdx][2];
  const tlen = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (tlen < 1e-12) return fanTriangulate(verts.length);
  tx /= tlen; ty /= tlen; tz /= tlen;

  // Bitangent = normal x tangent
  let bx = norm[1] * tz - norm[2] * ty;
  let by = norm[2] * tx - norm[0] * tz;
  let bz = norm[0] * ty - norm[1] * tx;
  const blen = Math.sqrt(bx * bx + by * by + bz * bz);
  if (blen < 1e-12) return fanTriangulate(verts.length);
  bx /= blen; by /= blen; bz /= blen;

  const coords2d = [];
  const origin = verts[0];
  for (const pt of verts) {
    const dx = pt[0] - origin[0], dy = pt[1] - origin[1], dz = pt[2] - origin[2];
    coords2d.push(dx * tx + dy * ty + dz * tz, dx * bx + dy * by + dz * bz);
  }

  try {
    const result = earcut(coords2d);
    if (result.length >= 3) return result;
    // Earcut returned nothing useful, fall back to fan
    return fanTriangulate(verts.length);
  } catch {
    return fanTriangulate(verts.length);
  }
}

function computeNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const nx = u[1] * v[2] - u[2] * v[1];
  const ny = u[2] * v[0] - u[0] * v[2];
  const nz = u[0] * v[1] - u[1] * v[0];
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-10) return [0, 0, 1];
  return [nx / len, ny / len, nz / len];
}

function polygonsToSTL(polygons, preserveCoords = true) {
  // Compute centroid for preview only — STL keeps original coords
  let cx = 0, cy = 0, cz = 0, count = 0;
  for (const poly of polygons) {
    for (const v of poly) {
      cx += v[0]; cy += v[1]; cz += v[2]; count++;
    }
  }
  if (count > 0) { cx /= count; cy /= count; cz /= count; }

  const triangles = [];
  let skippedPolygons = 0;

  for (const poly of polygons) {
    // Clean the polygon
    let cleaned = cleanPolygonVertices(poly);
    cleaned = removeCollinearVertices(cleaned);
    if (cleaned.length < 3) { skippedPolygons++; continue; }

    const indices = triangulatePolygon(cleaned);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = cleaned[indices[i]];
      const b = cleaned[indices[i + 1]];
      const c = cleaned[indices[i + 2]];
      if (!a || !b || !c) continue;
      const n = computeNormal(a, b, c);
      triangles.push({ normal: n, v1: a, v2: b, v3: c });
    }
  }

  // Binary STL
  const numTriangles = triangles.length;
  const bufferSize = 84 + numTriangles * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // 80 byte header
  const header = "CityGML to STL - georeferenced";
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }
  view.setUint32(80, numTriangles, true);

  let offset = 84;
  for (const tri of triangles) {
    view.setFloat32(offset, tri.normal[0], true); offset += 4;
    view.setFloat32(offset, tri.normal[1], true); offset += 4;
    view.setFloat32(offset, tri.normal[2], true); offset += 4;
    for (const v of [tri.v1, tri.v2, tri.v3]) {
      view.setFloat32(offset, v[0], true); offset += 4;
      view.setFloat32(offset, v[1], true); offset += 4;
      view.setFloat32(offset, v[2], true); offset += 4;
    }
    view.setUint16(offset, 0, true); offset += 2;
  }

  return { buffer, numTriangles, centroid: [cx, cy, cz], skippedPolygons };
}

// ── 3D Preview (simple wireframe with canvas) ──

function Preview3D({ polygons }) {
  const canvasRef = useRef(null);
  const [rotation, setRotation] = useState({ x: -0.5, y: 0.4 });
  const dragRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !polygons.length) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    // Center and scale
    let cx = 0, cy = 0, cz = 0, count = 0;
    for (const poly of polygons) for (const v of poly) { cx += v[0]; cy += v[1]; cz += v[2]; count++; }
    if (count) { cx /= count; cy /= count; cz /= count; }

    let maxDist = 0;
    for (const poly of polygons) for (const v of poly) {
      const d = Math.sqrt((v[0] - cx) ** 2 + (v[1] - cy) ** 2 + (v[2] - cz) ** 2);
      if (d > maxDist) maxDist = d;
    }
    const scale = (Math.min(W, H) * 0.4) / (maxDist || 1);

    const cosX = Math.cos(rotation.x), sinX = Math.sin(rotation.x);
    const cosY = Math.cos(rotation.y), sinY = Math.sin(rotation.y);

    function project(v) {
      let x = (v[0] - cx) * scale, y = (v[1] - cy) * scale, z = (v[2] - cz) * scale;
      // Rotate Y
      const x1 = x * cosY - z * sinY, z1 = x * sinY + z * cosY;
      // Rotate X
      const y1 = y * cosX - z1 * sinX;
      return [W / 2 + x1, H / 2 - y1];
    }

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(59, 130, 246, 0.35)";
    ctx.lineWidth = 0.5;

    for (const poly of polygons) {
      if (poly.length < 2) continue;
      ctx.beginPath();
      const [px, py] = project(poly[0]);
      ctx.moveTo(px, py);
      for (let i = 1; i < poly.length; i++) {
        const [px2, py2] = project(poly[i]);
        ctx.lineTo(px2, py2);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }, [polygons, rotation]);

  const onMouseDown = (e) => {
    dragRef.current = { x: e.clientX, y: e.clientY, rx: rotation.x, ry: rotation.y };
  };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.x) * 0.005;
    const dy = (e.clientY - dragRef.current.y) * 0.005;
    setRotation({ x: dragRef.current.rx + dy, y: dragRef.current.ry + dx });
  };
  const onMouseUp = () => { dragRef.current = null; };

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={400}
      style={{
        width: "100%",
        height: 280,
        borderRadius: 8,
        background: COLORS.bg,
        cursor: "grab",
        border: `1px solid ${COLORS.border}`,
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    />
  );
}

// ── Main App ──

export default function CityGMLToSTL() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | parsing | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const processFile = useCallback((f) => {
    setFile(f);
    setStatus("parsing");
    setError("");
    setResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        const { polygons, stats, crs } = parseCityGML(text);
        if (polygons.length === 0) {
          throw new Error("No polygon geometry found in the file. Make sure it's a valid CityGML file with 3D geometry.");
        }
        const { buffer, numTriangles, centroid, skippedPolygons } = polygonsToSTL(polygons);
        setResult({
          polygons,
          stats,
          numTriangles,
          buffer,
          fileSize: buffer.byteLength,
          crs,
          centroid,
          skippedPolygons,
        });
        setStatus("done");
      } catch (err) {
        setError(err.message);
        setStatus("error");
      }
    };
    reader.onerror = () => {
      setError("Failed to read file");
      setStatus("error");
    };
    reader.readAsText(f);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  }, [processFile]);

  const downloadSTL = () => {
    if (!result) return;
    const blob = new Blob([result.buffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const baseName = file.name.replace(/\.(gml|xml|citygml)$/i, "");
    const a = document.createElement("a");
    a.href = url;
    a.download = baseName + ".stl";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  };

  const reset = () => {
    setFile(null);
    setStatus("idle");
    setResult(null);
    setError("");
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: COLORS.bg,
      color: COLORS.text,
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      padding: "40px 20px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&family=JetBrains+Mono:wght@400;500&display=swap');
      `}</style>

      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 40, textAlign: "center" }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
            padding: "6px 14px",
            background: COLORS.accentGlow,
            borderRadius: 20,
            border: `1px solid ${COLORS.border}`,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: COLORS.accent, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              3D Converter
            </span>
          </div>
          <h1 style={{
            fontSize: 28,
            fontWeight: 600,
            margin: "0 0 8px",
            letterSpacing: "-0.02em",
          }}>
            CityGML → STL
          </h1>
          <p style={{ color: COLORS.textMuted, fontSize: 14, margin: 0, lineHeight: 1.5 }}>
            Drop a CityGML file to extract 3D geometry and export as binary STL
          </p>
        </div>

        {/* Upload Zone */}
        {status === "idle" && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? COLORS.borderActive : COLORS.border}`,
              borderRadius: 12,
              padding: "60px 40px",
              textAlign: "center",
              cursor: "pointer",
              background: dragOver ? COLORS.accentGlow : COLORS.surface,
              transition: "all 0.2s ease",
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".gml,.xml,.citygml"
              style={{ display: "none" }}
              onChange={(e) => e.target.files[0] && processFile(e.target.files[0])}
            />
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={COLORS.textDim} strokeWidth="1.5" style={{ marginBottom: 16 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 500 }}>
              Drop CityGML file here
            </p>
            <p style={{ margin: 0, fontSize: 13, color: COLORS.textDim }}>
              .gml, .xml, .citygml
            </p>
          </div>
        )}

        {/* Parsing */}
        {status === "parsing" && (
          <div style={{
            background: COLORS.surface,
            borderRadius: 12,
            padding: "40px",
            textAlign: "center",
            border: `1px solid ${COLORS.border}`,
          }}>
            <div style={{
              width: 32, height: 32, margin: "0 auto 16px",
              border: `3px solid ${COLORS.border}`,
              borderTopColor: COLORS.accent,
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ margin: 0, fontSize: 14, color: COLORS.textMuted }}>
              Parsing {file?.name}…
            </p>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div style={{
            background: COLORS.surface,
            borderRadius: 12,
            padding: "32px",
            border: `1px solid ${COLORS.error}33`,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill={COLORS.error} style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10" opacity="0.15" />
                <path d="M12 8v4m0 4h.01" stroke={COLORS.error} strokeWidth="2" strokeLinecap="round" fill="none" />
              </svg>
              <div>
                <p style={{ margin: "0 0 4px", fontWeight: 500, fontSize: 14 }}>Conversion failed</p>
                <p style={{ margin: "0 0 16px", color: COLORS.textMuted, fontSize: 13 }}>{error}</p>
                <button onClick={reset} style={{
                  background: COLORS.surfaceHover,
                  border: `1px solid ${COLORS.border}`,
                  color: COLORS.text,
                  padding: "8px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}>
                  Try another file
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Result */}
        {status === "done" && result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Preview */}
            <div style={{
              background: COLORS.surface,
              borderRadius: 12,
              padding: 16,
              border: `1px solid ${COLORS.border}`,
            }}>
              <p style={{
                margin: "0 0 12px",
                fontSize: 12,
                fontWeight: 500,
                color: COLORS.textDim,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}>
                Preview — drag to rotate
              </p>
              <Preview3D polygons={result.polygons} />
            </div>

            {/* Stats */}
            <div style={{
              background: COLORS.surface,
              borderRadius: 12,
              padding: 20,
              border: `1px solid ${COLORS.border}`,
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
            }}>
              {[
                ["Buildings", result.stats.buildings],
                ["Surfaces", result.stats.surfaces],
                ["Polygons", result.stats.polygons],
                ["Triangles", result.numTriangles],
              ].map(([label, val]) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{
                    fontSize: 20,
                    fontWeight: 600,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: COLORS.text,
                  }}>
                    {val.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Georeferencing info */}
            <div style={{
              background: COLORS.surface,
              borderRadius: 12,
              padding: 16,
              border: `1px solid ${COLORS.border}`,
            }}>
              <p style={{
                margin: "0 0 10px",
                fontSize: 12,
                fontWeight: 500,
                color: COLORS.textDim,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}>
                Georeferencing
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: COLORS.textMuted }}>CRS</span>
                  <span style={{ 
                    fontFamily: "'JetBrains Mono', monospace", 
                    fontSize: 12,
                    color: result.crs ? COLORS.text : COLORS.textDim,
                    maxWidth: "70%",
                    textAlign: "right",
                    wordBreak: "break-all",
                  }}>
                    {result.crs || "Not specified in file"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: COLORS.textMuted }}>Centroid</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                    {result.centroid.map(v => v.toFixed(2)).join(", ")}
                  </span>
                </div>
                <div style={{ 
                  marginTop: 6, 
                  padding: "8px 10px", 
                  background: COLORS.successGlow, 
                  borderRadius: 6,
                  fontSize: 12,
                  color: COLORS.success,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Original coordinates preserved in STL
                </div>
              </div>
            </div>

            {/* Skipped polygons warning */}
            {result.skippedPolygons > 0 && (
              <div style={{
                background: COLORS.surface,
                borderRadius: 12,
                padding: 14,
                border: `1px solid ${COLORS.warning}33`,
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                color: COLORS.warning,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {result.skippedPolygons} degenerate polygon{result.skippedPolygons > 1 ? "s" : ""} skipped (fewer than 3 valid vertices)
              </div>
            )}

            {/* Download */}
            <div style={{
              background: COLORS.surface,
              borderRadius: 12,
              padding: 20,
              border: `1px solid ${COLORS.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
                  {file.name.replace(/\.(gml|xml|citygml)$/i, "")}.stl
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: COLORS.textDim }}>
                  Binary STL · {formatSize(result.fileSize)}
                </p>
              </div>
              <button onClick={downloadSTL} style={{
                background: COLORS.accent,
                border: "none",
                color: "#fff",
                padding: "10px 24px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download
              </button>
            </div>

            {/* Reset */}
            <button onClick={reset} style={{
              background: "none",
              border: "none",
              color: COLORS.textMuted,
              fontSize: 13,
              cursor: "pointer",
              padding: "8px",
              fontFamily: "inherit",
            }}>
              Convert another file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
