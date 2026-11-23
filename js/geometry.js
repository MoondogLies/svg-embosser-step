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

  // Forma di piastra e guide; i valori mancanti assumono quelli storici (R6, perni a 7 mm dal bordo, tacca 4 × 2 mm a 12 mm).
  function plateGeometry(s) {
    const v = (x, d) => (x === undefined || x === null || Number.isNaN(x) ? d : x);
    return {
      cornerR: v(s.cornerR, 6),
      pinInset: v(s.pinInset, 7),
      pinY: v(s.pinY, 0),
      notchX: v(s.notchX, 12),
      notchW: v(s.notchW, 4),
      notchD: v(s.notchD, 2),
      margin: v(s.margin, 2),
    };
  }

  // Piastra con angoli arrotondati e tacca triangolare di orientamento sul lato superiore
  // (notchX: centro della tacca dal bordo sinistro; notchW: larghezza sul bordo; notchD: profondità, 0 = senza tacca).
  function plateShape(s) {
    const g = plateGeometry(s);
    const plate = union([roundedRect(s.w, s.h, Math.min(g.cornerR, s.w / 2, s.h / 2))]);
    if (!(g.notchD > 0 && g.notchW > 0)) return plate;
    const x = -s.w / 2 + g.notchX,
      y = s.h / 2,
      half = ((g.notchW / 2) * (g.notchD + 1)) / g.notchD; // il triangolo sporge 1 mm oltre il bordo
    const notch = [
      [
        { X: Math.round((x - half) * S), Y: Math.round((y + 1) * S) },
        { X: Math.round((x + half) * S), Y: Math.round((y + 1) * S) },
        { X: Math.round(x * S), Y: Math.round((y - g.notchD) * S) },
      ],
    ];
    return diff(plate, notch);
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

  // join 'round' (predefinito) oppure 'miter';
  // tolerance: scostamento massimo dei raccordi dall'arco ideale, in mm.
  function offset(paths, mm, join = 'round', tolerance = 0.01) {
    if (!mm) return paths;
    const co = new C.ClipperOffset(2, tolerance * S),
      out = [];
    co.AddPaths(paths, join === 'miter' ? C.JoinType.jtMiter : C.JoinType.jtRound, C.EndType.etClosedPolygon);
    co.Execute(out, mm * S);
    return union(out);
  }

  E.geometry = {
    normalize, op, union, diff, intersect, same, area, rect, roundedRect, reflected,
    plateGeometry, plateShape, oriented, invertArtwork, clipToSheet, offset,
  };
})((self.Embosser = self.Embosser || {}));
