// Cerniera print-in-place: unisce positiva e negativa in un'unica stampa, senza perni di registrazione.
//
// Le piastre vengono stampate affiancate, a faccia in su; la cerniera è sul lato in comune.
// Nel sistema di lavoro la cerniera è sempre parallela a Y, con asse in x = 0 alla quota
// zh = spessore piastra + carta/2: chiudendo la negativa di 180° attorno all'asse, la sua faccia
// si ferma esattamente a uno spessore carta dalla positiva. Con la cerniera sul lato inferiore
// le piastre vengono ruotate di 90° prima della costruzione e la mesh viene ruotata indietro alla fine.
//
// Nodi alternati: positiva, negativa, positiva…; il perno appartiene alla positiva e attraversa
// i fori della negativa. I nodi hanno la base piatta sul piano, quindi si stampa senza supporti.
'use strict';
(function (E) {
  const S = E.S;
  const G = E.geometry;
  const { union, diff, intersect } = G;
  const C = ClipperLib;

  function circle(cx, cy, r, n = 64) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      out.push({ X: Math.round((cx + r * Math.cos(a)) * S), Y: Math.round((cy + r * Math.sin(a)) * S) });
    }
    return out;
  }
  // Rettangolo in coordinate intere (antiorario).
  const box = (x0, y0, x1, y1) => [{ X: x0, Y: y0 }, { X: x1, Y: y0 }, { X: x1, Y: y1 }, { X: x0, Y: y1 }];
  const shift = (paths, dx) => paths.map((p) => p.map((q) => ({ X: q.X + dx, Y: q.Y })));
  // Rotazione di +90° attorno a Z: il lato inferiore della piastra diventa il lato destro.
  const rotate = (paths) => paths.map((p) => p.map((q) => ({ X: -q.Y, Y: q.X })));

  // Aggiunge vertici sui tratti dei contorni che giacciono sulla retta x, così le pareti
  // della piastra si dividono esattamente agli estremi dei nodi.
  function insertSplits(paths, x, ys) {
    return paths.map((p) => {
      const out = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i],
          b = p[(i + 1) % p.length];
        out.push(a);
        if (a.X === x && b.X === x) {
          const lo = Math.min(a.Y, b.Y),
            hi = Math.max(a.Y, b.Y);
          for (const y of ys.filter((y) => y > lo && y < hi).sort((u, v) => (a.Y < b.Y ? u - v : v - u))) out.push({ X: x, Y: y });
        }
      }
      return out;
    });
  }

  // Mesh costruita con strati lungo Y (profili nel piano XZ): scambia Y e Z e ripristina l'orientamento.
  function alongY(v) {
    const m = (p) => [p[0], p[2], p[1]],
      out = [];
    for (let i = 0; i < v.length; i += 3) out.push(m(v[i]), m(v[i + 2]), m(v[i + 1]));
    return out;
  }

  // Toglie le facce coincidenti di piastra e braccio sul piano di attacco x, negli intervalli dei nodi:
  // le due superfici aperte si chiudono a vicenda e il corpo resta unico e chiuso.
  function attach(v, x, ranges, top) {
    const eps = 1e-6,
      out = [];
    for (let i = 0; i < v.length; i += 3) {
      const t = [v[i], v[i + 1], v[i + 2]];
      const joint =
        t.every((p) => Math.abs(p[0] - x) < eps && p[2] >= -eps && p[2] <= top + eps) &&
        ranges.some((k) => t.every((p) => p[1] >= k.a / S - eps && p[1] <= k.b / S + eps));
      if (!joint) out.push(...t);
    }
    return out;
  }

  // Dimensioni della cerniera. b: spessore piastra effettivo (già arrotondato al layer).
  function layout(s, b, side) {
    const geo = G.plateGeometry(s),
      length = side === 'bottom' ? s.w : s.h,
      depth = side === 'bottom' ? s.h : s.w,
      hc = s.hc,
      zh = b + (s.paper || 0) / 2,
      maxR = zh - hc - 0.8; // almeno 0,8 mm di materiale sotto il foro della negativa
    if (!(hc > 0)) throw Error('Cerniera: il gioco radiale del perno deve essere maggiore di zero.');
    if (!(s.ha > 0)) throw Error('Cerniera: il gioco tra i nodi deve essere maggiore di zero.');
    if (!(s.hgap > 0)) throw Error('Cerniera: il gioco tra nodi e piastra deve essere maggiore di zero.');
    if (maxR < 0.5)
      throw Error('Cerniera: piastra troppo sottile per un perno di almeno 1 mm con gioco ' + hc + ' mm. Aumenta lo spessore piastra.');
    const rp = s.hd > 0 ? s.hd / 2 : Math.min(2, maxR);
    if (rp > maxR + 1e-9)
      throw Error(
        'Cerniera: perno Ø ' + (2 * rp).toFixed(2) + ' mm troppo grosso per una piastra di ' + b.toFixed(2) + ' mm: massimo Ø ' +
          (2 * maxR).toFixed(2) + ' mm (servono 0,8 mm sotto il foro). Aumenta lo spessore piastra o usa 0 = automatico.',
      );
    const R = Math.max(zh + 0.6, rp + hc + 1.2),
      e = R + s.hgap,
      half = length / 2 - Math.min(geo.cornerR, s.w / 2, s.h / 2) - 1,
      L = 2 * half;
    let n = s.hn > 0 ? Math.round(s.hn) : Math.floor((L + s.ha) / (10 + s.ha));
    if (n % 2 === 0) n--;
    n = Math.max(3, n);
    const seg = (L - (n - 1) * s.ha) / n;
    if (!(seg >= 3))
      throw Error('Cerniera: nodi più corti di 3 mm. Allunga il lato della cerniera, riduci il raggio degli angoli, i nodi o il gioco tra i nodi.');
    const knuckles = [];
    for (let i = 0; i < n; i++) {
      const a = -half + i * (seg + s.ha);
      knuckles.push({ a: Math.round(a * S), b: Math.round((a + seg) * S), positive: i % 2 === 0 });
    }
    const span = 2 * (e + depth);
    return {
      side, zh, R, rp, hc, e, eI: Math.round(e * S), n, seg, knuckles, depth, length,
      footprint: side === 'bottom' ? [s.w, span] : [span, s.h],
      // Centri delle piastre (positiva, negativa) nella posizione di stampa.
      centers: side === 'bottom' ? [[0, e + s.h / 2], [0, -(e + s.h / 2)]] : [[-(e + s.w / 2), 0], [e + s.w / 2, 0]],
    };
  }

  // Profili nel piano XZ (X orizzontale, Y del profilo = quota Z).
  // I nodi sono tagliati tra 0 e 2·zh, simmetrici rispetto all'asse: base piatta sul piano di stampa e,
  // a cerniera chiusa, nessuna sporgenza oltre le due facce esterne del pacchetto (spessore 2·zh).
  function profiles(H, b) {
    const bI = Math.round(b * S),
      ground = [box(-2 * H.eI, 0, 2 * H.eI, Math.round(2 * H.zh * S))],
      disk = circle(0, H.zh, H.R),
      bore = [circle(0, H.zh, H.rp + H.hc)];
    return {
      positive: intersect(union([disk, box(-H.eI, 0, 0, bI)]), ground),
      negative: diff(intersect(union([disk, box(0, 0, H.eI, bI)]), ground), bore),
      pin: union([circle(0, H.zh, H.rp)]),
    };
  }

  function rotateXZ(paths, t, zc) {
    const c = Math.cos(t),
      n = Math.sin(t);
    return paths.map((p) => p.map((q) => {
      const z = q.Y - zc;
      return { X: Math.round(q.X * c - z * n), Y: Math.round(q.X * n + z * c + zc) };
    }));
  }

  // Verifica che i due corpi non si tocchino in nessuna posizione da 0° a 180° (sezioni XZ ogni 2°).
  function clearance(H, P, b) {
    const dI = Math.round(H.depth * S),
      bI = Math.round(b * S),
      posRect = [box(-H.eI - dI, 0, -H.eI, bI)],
      negRect = [box(H.eI, 0, H.eI + dI, bI)],
      tol = 0.01 * S * S;
    const cases = [
      ['nodi della positiva', union([...P.positive, ...posRect]), negRect],
      ['nodi della negativa', union([...P.pin, ...posRect]), union([...P.negative, ...negRect])],
      ['giochi tra i nodi', union([...P.pin, ...posRect]), negRect],
    ];
    for (const [name, A, B] of cases)
      for (let d = 0; d <= 180; d += 2) {
        const area = intersect(A, rotateXZ(B, (d * Math.PI) / 180, H.zh * S)).reduce((n, p) => n + Math.abs(C.Clipper.Area(p)), 0);
        if (area > tol) throw Error('Cerniera: interferenza (' + name + ') a ' + d + '° di chiusura.');
      }
  }

  // Unisce piastre e cerniera.
  // positiveLayers / negativeLayers: strati delle piastre in coordinate piastra (negativa già specchiata
  // rispetto al lato della cerniera); positivePlate / negativePlate: contorni delle piastre.
  function assemble({ s, b, side, positiveLayers, negativeLayers, positivePlate, negativePlate }) {
    const H = layout(s, b, side),
      P = profiles(H, b);
    clearance(H, P, b);
    const T = side === 'bottom' ? rotate : (paths) => paths;
    const xs = (paths) => T(paths).flat().map((q) => q.X),
      dxP = -H.eI - Math.max(...xs(positivePlate)),
      dxN = H.eI - Math.min(...xs(negativePlate));
    const kp = H.knuckles.filter((k) => k.positive),
      kn = H.knuckles.filter((k) => !k.positive);
    // Il lato della cerniera deve essere dritto per tutta la lunghezza dei nodi.
    for (const [plate, dx, x, ks] of [[positivePlate, dxP, -H.eI, kp], [negativePlate, dxN, H.eI, kn]]) {
      const placed = shift(T(plate), dx);
      for (const k of ks) {
        const strip = [x < 0 ? box(x - 10, k.a, x, k.b) : box(x, k.a, x + 10, k.b)];
        if (diff(strip, placed).length) throw Error('Cerniera: il lato della cerniera non è dritto dove servono i nodi (angoli o tacca).');
      }
    }
    const place = (layers, dx, x, ks) => {
      const ys = ks.flatMap((k) => [k.a, k.b]);
      return layers.map((l) => ({ ...l, paths: insertSplits(shift(T(l.paths), dx), x, ys) }));
    };
    const positivePlateMesh = E.mesh.layers(place(positiveLayers, dxP, -H.eI, kp)),
      negativePlateMesh = E.mesh.layers(place(negativeLayers, dxN, H.eI, kn));
    // Strati lungo Y: nodi della positiva collegati dal perno, nodi della negativa forati.
    const posHinge = [];
    for (let i = 0; i < H.knuckles.length; i += 2) {
      const k = H.knuckles[i],
        next = H.knuckles[i + 2];
      posHinge.push({ z0: k.a / S, z1: k.b / S, paths: P.positive });
      if (next) posHinge.push({ z0: k.b / S, z1: next.a / S, paths: P.pin });
    }
    const negHinge = kn.flatMap((k) => E.mesh.layers([{ z0: k.a / S, z1: k.b / S, paths: P.negative }]));
    let positive = E.mesh.conform(attach(positivePlateMesh.concat(alongY(E.mesh.layers(posHinge))), -H.eI / S, kp, b)),
      negative = E.mesh.conform(attach(negativePlateMesh.concat(alongY(negHinge)), H.eI / S, kn, b));
    if (side === 'bottom') {
      // Rotazione di -90° attorno a Z: positiva in alto, negativa in basso, cerniera orizzontale.
      const back = (v) => v.map((p) => [p[1], -p[0], p[2]]);
      positive = back(positive);
      negative = back(negative);
    }
    const info = {
      side, n: H.n, seg: H.seg, zh: H.zh, knuckleD: 2 * H.R, pinD: 2 * H.rp, boreD: 2 * (H.rp + H.hc), e: H.e,
      footprint: H.footprint,
      centers: H.centers,
    };
    return { positive, negative, info };
  }

  E.hinge = { layout, profiles, clearance, assemble, insertSplits };
})((self.Embosser = self.Embosser || {}));
