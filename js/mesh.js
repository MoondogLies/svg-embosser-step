// Costruzione delle mesh a strati, riparazione delle giunzioni a T, verifica ed export STL.
'use strict';
(function (E) {
  const S = E.S;
  const { diff } = E.geometry;
  const C = ClipperLib;

  function tri(out, a, b, c) {
    if (![...a, ...b, ...c].every(Number.isFinite)) throw Error('Coordinata non finita.');
    const u = b.map((x, i) => x - a[i]),
      v = c.map((x, i) => x - a[i]);
    if (Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) > 1e-10) out.push(a, b, c);
  }

  // Triangola le regioni (con fori) a quota z; up indica la normale verso +Z.
  function cap(out, paths, z, up) {
    if (!paths.length) return;
    const clip = new C.Clipper(),
      tree = new C.PolyTree();
    clip.AddPaths(paths, C.PolyType.ptSubject, true);
    clip.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
    function visit(node) {
      if (node.Contour().length && !node.IsHole()) {
        const vec = (p) => p.map((v) => new THREE.Vector2(v.X / S, v.Y / S));
        const outer = vec(node.Contour());
        const holes = node.Childs().filter((h) => h.IsHole()).map((h) => vec(h.Contour()));
        const faces = THREE.ShapeUtils.triangulateShape(outer, holes);
        const points = outer.concat(...holes);
        for (const face of faces) {
          let a = points[face[0]],
            b = points[face[1]],
            c = points[face[2]];
          const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
          if (nz > 0 !== up) [b, c] = [c, b];
          tri(out, [a.x, a.y, z], [b.x, b.y, z], [c.x, c.y, z]);
        }
      }
      for (const child of node.Childs()) visit(child);
    }
    visit(tree);
  }

  function walls(out, paths, z0, z1) {
    for (const p of paths)
      for (let i = 0; i < p.length; i++) {
        const a = p[i],
          b = p[(i + 1) % p.length];
        const A = [a.X / S, a.Y / S, z0],
          B = [b.X / S, b.Y / S, z0],
          Cc = [b.X / S, b.Y / S, z1],
          D = [a.X / S, a.Y / S, z1];
        tri(out, A, B, Cc);
        tri(out, A, Cc, D);
      }
  }

  const vertexKey = (v) => v.map((x) => Math.round(x * 10000)).join(',');

  // Identificativi numerici dei vertici sulla griglia di 0,0001 mm (chiavi numeriche: molto più veloci delle stringhe).
  const OFF = 2 ** 21; // ±209 mm in X/Y
  function vertexIds(v) {
    const xy = new Map(),
      ids = new Int32Array(v.length);
    let next = 0;
    for (let i = 0; i < v.length; i++) {
      const p = v[i],
        x = Math.round(p[0] * 10000) + OFF,
        y = Math.round(p[1] * 10000) + OFF,
        z = Math.round(p[2] * 10000);
      if (x < 0 || y < 0 || x >= 2 * OFF || y >= 2 * OFF) throw Error('Coordinate oltre ±209 mm.');
      const k = x * 2 ** 22 + y;
      let zs = xy.get(k);
      if (!zs) xy.set(k, (zs = new Map()));
      let id = zs.get(z);
      if (id === undefined) zs.set(z, (id = next++));
      ids[i] = id;
    }
    return ids;
  }
  const EDGE = 2 ** 26;
  const edgeKey = (a, b) => (a < b ? a * EDGE + b : b * EDGE + a);

  // Spigoli non condivisi da esattamente due facce con orientamento opposto.
  function edgeReport(v, ids = vertexIds(v)) {
    const m = new Map();
    for (let i = 0; i < v.length; i += 3)
      for (let j = 0; j < 3; j++) {
        const ia = ids[i + j],
          ib = ids[i + ((j + 1) % 3)],
          k = edgeKey(ia, ib);
        let e = m.get(k);
        if (!e) {
          e = { a: v[i + j], b: v[i + ((j + 1) % 3)], key: k, n: 0, dir: 0 };
          m.set(k, e);
        }
        e.n++;
        e.dir += ia < ib ? 1 : -1;
      }
    const bad = [];
    for (const e of m.values()) if (e.n !== 2 || e.dir !== 0) bad.push(e);
    return bad;
  }

  // Suddivide gli spigoli con giunzioni a T finché la mesh non è conforme (max 16 passate).
  // Ogni spigolo viene diviso in una volta in tutti i punti che giacciono al suo interno.
  function conform(vertices) {
    let v = vertices.map((p) => p.map((x) => Math.round(x * 10000) / 10000));
    for (let pass = 0; pass < 16; pass++) {
      const ids = vertexIds(v),
        bad = edgeReport(v, ids);
      if (!bad.length) return v;
      const points = [...new Map(bad.flatMap((e) => [e.a, e.b]).map((p) => [vertexKey(p), p])).values()];
      const splits = new Map();
      for (const e of bad) {
        if (e.n !== 1) continue;
        const a = e.a,
          b = e.b,
          d = b.map((x, k) => x - a[k]),
          l = d.reduce((n, x) => n + x * x, 0);
        if (!l) continue;
        const inside = [];
        for (const p of points) {
          const t = d.reduce((n, x, k) => n + x * (p[k] - a[k]), 0) / l;
          if (t <= 1e-9 || t >= 1 - 1e-9) continue;
          // Tolleranza di due passi della griglia (0,0001 mm): l'arrotondamento può spostare il punto fuori dalla retta.
          if (p.some((x, k) => Math.abs(x - a[k] - t * d[k]) > 2e-4)) continue;
          inside.push({ t, p });
        }
        if (inside.length) splits.set(e.key, { from: vertexKey(a), points: inside.sort((x, y) => x.t - y.t).map((x) => x.p) });
      }
      if (!splits.size) return v;
      const out = [];
      for (let i = 0; i < v.length; i += 3) {
        let done = false;
        for (let j = 0; j < 3; j++) {
          const split = splits.get(edgeKey(ids[i + j], ids[i + ((j + 1) % 3)]));
          if (!split) continue;
          const a = v[i + j],
            b = v[i + ((j + 1) % 3)],
            c = v[i + ((j + 2) % 3)];
          // Punti ordinati da a verso b, qualunque sia il verso dello spigolo nel triangolo.
          const pts = vertexKey(a) === split.from ? split.points : [...split.points].reverse();
          let prev = a;
          for (const p of pts) {
            out.push(prev, p, c);
            prev = p;
          }
          out.push(prev, b, c);
          done = true;
          break;
        }
        if (!done) out.push(v[i], v[i + 1], v[i + 2]);
      }
      v = out;
    }
    return v;
  }

  // layers: [{z0, z1, paths}] dal basso verso l'alto.
  function mesh(list) {
    return conform(layers(list));
  }
  // Triangoli degli strati senza riparazione delle giunzioni a T (per unire più parti prima di conform).
  function layers(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const l = list[i],
        prev = i ? list[i - 1].paths : [],
        next = i + 1 < list.length ? list[i + 1].paths : [];
      walls(out, l.paths, l.z0, l.z1);
      cap(out, diff(l.paths, prev), l.z0, false);
      cap(out, diff(l.paths, next), l.z1, true);
    }
    return out;
  }

  // Verifica la mesh e ne restituisce il volume (mm³); lancia un errore se non è esportabile.
  function check(v, name = 'Mesh') {
    if (!v.length) throw Error(name + ': mesh vuota.');
    let volume = 0;
    for (let i = 0; i < v.length; i += 3) {
      const a = v[i],
        b = v[i + 1],
        c = v[i + 2];
      for (let k = 0; k < 3; k++)
        if (!Number.isFinite(a[k]) || !Number.isFinite(b[k]) || !Number.isFinite(c[k])) throw Error(name + ': triangolo non finito.');
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    const ids = vertexIds(v);
    for (let i = 0; i < v.length; i += 3)
      if (ids[i] === ids[i + 1] || ids[i + 1] === ids[i + 2] || ids[i] === ids[i + 2]) throw Error(name + ': triangolo degenere.');
    const bad = edgeReport(v, ids);
    if (bad.length) {
      const details = bad
        .slice(0, 4)
        .map((e) => JSON.stringify(e.a) + ' → ' + JSON.stringify(e.b) + '; facce=' + e.n + ', orientamento=' + e.dir)
        .join('\n');
      console.error(name, bad);
      throw Error(name + ': ' + bad.length + ' spigoli non conformi. Export bloccato.\n' + details);
    }
    if (volume <= 0) throw Error(name + ': volume non positivo.');
    return volume;
  }

  // Elenco di vertici [x,y,z] → Float32Array piatto (trasferibile dal worker senza copia).
  const flatten = (v) => Float32Array.from(v.flat());

  // Float32Array di triangoli → STL binario.
  function stl(f) {
    const n = f.length / 9,
      buffer = new ArrayBuffer(84 + n * 50),
      d = new DataView(buffer);
    d.setUint32(80, n, true);
    let o = 84;
    for (let i = 0; i < f.length; i += 9) {
      const ux = f[i + 3] - f[i], uy = f[i + 4] - f[i + 1], uz = f[i + 5] - f[i + 2];
      const vx = f[i + 6] - f[i], vy = f[i + 7] - f[i + 1], vz = f[i + 8] - f[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (const x of [nx, ny, nz]) { d.setFloat32(o, x, true); o += 4; }
      for (let k = 0; k < 9; k++) { d.setFloat32(o, f[i + k], true); o += 4; }
      d.setUint16(o, 0, true);
      o += 2;
    }
    return buffer;
  }

  E.mesh = { tri, cap, walls, vertexKey, vertexIds, edgeReport, conform, mesh, layers, check, flatten, stl };
})((self.Embosser = self.Embosser || {}));
