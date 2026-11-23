// Operazioni 2D sulle regioni poligonali (Clipper), in coordinate intere scalate di E.S.
'use strict';
(function (E) {
  const S = E.S;
  const C = ClipperLib;

  // Valida e pulisce un elenco di contorni: arrotonda, rimuove punti duplicati e contorni degeneri.
  function normalize(paths) {
    if (!Array.isArray(paths)) throw Error('Geometria interna: atteso elenco di contorni.');
    return paths
      .map((path) => {
        if (!Array.isArray(path)) throw Error('Geometria interna: usare [contorno], non contorno.');
        const out = [];
        for (const p of path) {
          if (!p || !Number.isFinite(p.X) || !Number.isFinite(p.Y)) throw Error('Coordinata poligonale non valida.');
          const q = { X: Math.round(p.X), Y: Math.round(p.Y) };
          const last = out[out.length - 1];
          if (!last || last.X !== q.X || last.Y !== q.Y) out.push(q);
        }
        if (out.length > 1 && out[0].X === out[out.length - 1].X && out[0].Y === out[out.length - 1].Y) out.pop();
        return out;
      })
      .filter((p) => p.length >= 3);
  }

  function op(a, b, type, fill = C.PolyFillType.pftNonZero) {
    a = normalize(a);
    b = normalize(b);
    if (!a.length && !b.length) return [];
    if (type === C.ClipType.ctIntersection && (!a.length || !b.length)) return [];
    if (type === C.ClipType.ctDifference && !a.length) return [];
    const c = new C.Clipper();
    c.StrictlySimple = true;
    if (a.length) c.AddPaths(a, C.PolyType.ptSubject, true);
    if (b.length) c.AddPaths(b, C.PolyType.ptClip, true);
    const out = [];
    c.Execute(type, out, fill, fill);
    return out;
  }

  const union = (a) => op(a, [], C.ClipType.ctUnion);
  const diff = (a, b) => op(a, b, C.ClipType.ctDifference);
  const intersect = (a, b) => op(a, b, C.ClipType.ctIntersection);
  const same = (a, b) => !diff(a, b).length && !diff(b, a).length;
  const area = (paths) => paths.reduce((n, p) => n + C.Clipper.Area(p), 0) / S / S;

  function rect(x, y, w, h) {
    return [
      [x - w / 2, y - h / 2],
      [x + w / 2, y - h / 2],
      [x + w / 2, y + h / 2],
      [x - w / 2, y + h / 2],
    ].map((p) => ({ X: Math.round(p[0] * S), Y: Math.round(p[1] * S) }));
  }

  function roundedRect(w, h, r) {
    const out = [];
    const corners = [
      [w / 2 - r, h / 2 - r, 0],
      [-w / 2 + r, h / 2 - r, Math.PI / 2],
      [-w / 2 + r, -h / 2 + r, Math.PI],
      [w / 2 - r, -h / 2 + r, (3 * Math.PI) / 2],
    ];
    for (const [cx, cy, start] of corners)
      for (let i = 0; i <= 16; i++) {
        const a = start + (i * Math.PI) / 32;
        out.push({ X: Math.round((cx + r * Math.cos(a)) * S), Y: Math.round((cy + r * Math.sin(a)) * S) });
      }
    return out;
  }

  // Riflessione lungo X (per l'accoppiamento faccia a faccia).
  function reflected(paths) {
    return union(paths.map((path) => path.map((p) => ({ X: -p.X, Y: p.Y })).reverse()));
  }

  // Piastra con angoli R6 e tacca triangolare di orientamento sul lato superiore.
  function plateShape(s) {
    const x = -s.w / 2 + 12,
      y = s.h / 2;
    const notch = [
      [
        { X: Math.round((x - 3) * S), Y: Math.round((y + 1) * S) },
        { X: Math.round((x + 3) * S), Y: Math.round((y + 1) * S) },
        { X: Math.round(x * S), Y: Math.round((y - 2) * S) },
      ],
    ];
    return diff(union([roundedRect(s.w, s.h, 6)]), notch);
  }

  function oriented(p, positive) {
    const q = normalize([p])[0];
    if (!q) return [];
    if (C.Clipper.Orientation(q) !== positive) q.reverse();
    return q;
  }

  function invertArtwork(paths, mode) {
    if (!paths.length) throw Error('Nessuna area riempita valida.');
    let domain;
    if (mode === 'contour') {
      domain = union(paths.filter((p) => C.Clipper.Orientation(p)));
    } else if (mode === 'bounds') {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const path of paths)
        for (const p of path) {
          minX = Math.min(minX, p.X);
          maxX = Math.max(maxX, p.X);
          minY = Math.min(minY, p.Y);
          maxY = Math.max(maxY, p.Y);
        }
      domain = [
        [
          { X: minX, Y: minY },
          { X: maxX, Y: minY },
          { X: maxX, Y: maxY },
          { X: minX, Y: maxY },
        ],
      ];
    } else throw Error('Area di inversione non valida.');
    const result = diff(domain, paths);
    if (!result.length)
      throw Error('Inversione senza aree da mettere in rilievo: cambia area di inversione o disattiva Inverti pieni/vuoti.');
    return result;
  }

  function clipToSheet(paths, sheet) {
    if (!sheet) return { paths, cut: false };
    const region = [rect(0, 0, sheet.w, sheet.h)];
    return { paths: intersect(paths, region), cut: diff(paths, region).length > 0 };
  }

  function offset(paths, mm) {
    if (!mm) return paths;
    const co = new C.ClipperOffset(2, 0.01 * S),
      out = [];
    co.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon);
    co.Execute(out, mm * S);
    return union(out);
  }

  E.geometry = {
    normalize, op, union, diff, intersect, same, area, rect, roundedRect, reflected,
    plateShape, oriented, invertArtwork, clipToSheet, offset,
  };
})((self.Embosser = self.Embosser || {}));
