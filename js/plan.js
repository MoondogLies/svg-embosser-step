// Anteprima 2D in pianta: positiva e negativa viste dall'alto, con piastra, margine di sicurezza,
// rilievo/cavità, fori e perni, foglio e zone troppo sottili. Disegnata come SVG inline in millimetri.
'use strict';
(function (E) {
  const NS = 'http://www.w3.org/2000/svg';

  const el = (name, attrs = {}, text) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // loops: array di contorni piatti [x0,y0,x1,y1,…] in mm.
  const pathData = (loops) =>
    (loops || [])
      .filter((l) => l.length >= 6)
      .map((l) => {
        let d = 'M' + l[0].toFixed(3) + ' ' + l[1].toFixed(3);
        for (let i = 2; i < l.length; i += 2) d += 'L' + l[i].toFixed(3) + ' ' + l[i + 1].toFixed(3);
        return d + 'Z';
      })
      .join('');
  const rectLoop = (w, h, cx = 0, cy = 0) => [[cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2]];

  // Strati disegnati dal basso verso l'alto: [chiave, classe CSS].
  const LAYERS = {
    positive: [['plate', 'plate'], ['safe', 'safe'], ['relief', 'relief'], ['flare', 'flare'], ['holes', 'hole'], ['stops', 'stop']],
    negative: [['plate', 'plate'], ['safe', 'safe'], ['cavity', 'cavity'], ['recess', 'recess'], ['pins', 'pin']],
  };

  // data: { s, sheet, plan: { positive: {…}, negative: {…} }, thin: { positive, negative } }
  E.renderPlan = function (container, data) {
    container.replaceChildren();
    if (!data || !data.plan) return;
    const { s, sheet, plan, thin } = data;
    const gap = 16,
      pad = 6,
      offsets = { positive: -s.w / 2 - gap / 2, negative: s.w / 2 + gap / 2 };
    const width = 2 * s.w + gap + 2 * pad,
      height = s.h + 2 * pad + 14;
    const svg = el('svg', {
      viewBox: [-width / 2, -s.h / 2 - pad - 14, width, height].join(' '),
      role: 'img',
      'aria-label': 'Pianta di positiva e negativa viste dall’alto',
    });
    for (const side of ['positive', 'negative']) {
      const x = offsets[side];
      svg.append(el('text', { x, y: -s.h / 2 - pad - 3, class: 'label' }, side === 'positive' ? 'Positiva' : 'Negativa'));
      // Coordinate del modello con Y verso l'alto: si capovolge il gruppo.
      const g = el('g', { transform: 'translate(' + x + ' 0) scale(1 -1)' });
      for (const [key, cls] of LAYERS[side]) {
        const d = pathData(plan[side][key]);
        if (d) g.append(el('path', { d, class: cls, 'fill-rule': 'evenodd', 'vector-effect': 'non-scaling-stroke' }));
      }
      if (sheet) g.append(el('path', { d: pathData(rectLoop(sheet.w, sheet.h)), class: 'sheet', 'vector-effect': 'non-scaling-stroke' }));
      const d = pathData(thin && thin[side]);
      if (d) g.append(el('path', { d, class: 'thin', 'fill-rule': 'evenodd', 'vector-effect': 'non-scaling-stroke' }));
      svg.append(g);
    }
    // Barra di scala di 10 mm.
    const bx = -width / 2 + pad,
      by = s.h / 2 + pad - 2;
    svg.append(el('path', { d: 'M' + bx + ' ' + by + 'h10', class: 'scale', 'vector-effect': 'non-scaling-stroke' }));
    svg.append(el('text', { x: bx + 12, y: by + 1.2, class: 'small' }, '10 mm'));
    container.append(svg);
  };

  // Pianta della sola piastra (senza disegno), calcolata nella pagina: utile per regolare perni e tacca.
  E.platePlan = function (s, mirror, sheet, stopsMode) {
    const G = E.geometry,
      geo = G.plateGeometry(s),
      px = s.w / 2 - geo.pinInset,
      S = E.S;
    const loops = (paths) => paths.map((p) => p.flatMap((q) => [q.X / S, q.Y / S]));
    const plate = G.plateShape(s),
      safe = G.offset(plate, -geo.margin),
      pins = G.union([-1, 1].map((v) => G.rect(v * px, geo.pinY, s.pin, s.pin))),
      holes = G.union([-1, 1].map((v) => G.rect(v * px, geo.pinY, s.pin + 2 * s.pg, s.pin + 2 * s.pg))),
      flare = s.holeFlare > 0 ? G.offset(holes, s.holeFlare) : [];
    const m = (paths) => (mirror ? G.reflected(paths) : paths);
    let stops = [];
    try {
      stops = E.model.stopShapes(sheet, s, stopsMode);
    } catch (ignore) {}
    const recess = stops.length ? m(G.offset(stops, s.stopClear ?? 0.3, 'miter')) : [];
    return {
      positive: { plate: loops(plate), safe: loops(safe), relief: [], flare: loops(flare), holes: loops(holes), stops: loops(stops) },
      negative: { plate: loops(m(plate)), safe: loops(m(safe)), cavity: [], pins: loops(pins), recess: loops(recess) },
    };
  };
})((self.Embosser = self.Embosser || {}));
