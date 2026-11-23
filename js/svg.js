// Interpretazione dell'SVG: stili (attributi, inline, CSS interno, ereditarietà), fill-rule
// ed elementi non supportati. Richiede DOMParser e THREE.SVGLoader: gira solo nella pagina.
// Restituisce dati semplici e clonabili: { result: [{ rule, polys: [[{x,y}]] }], minX, minY, maxX, maxY }.
'use strict';
(function (E) {
  const NON_RENDERED = new Set([
    'defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient',
    'filter', 'metadata', 'title', 'desc', 'style', 'script',
  ]);

  function specificity(sel) {
    const s = sel.replace(/::?[\w-]+\([^)]*\)/g, ' :x ').replace(/::[\w-]+/g, ' ');
    const ids = (s.match(/#[\w-]+/g) || []).length;
    const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length;
    const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, ' ').match(/[a-zA-Z][\w-]*/g) || []).length;
    return ids * 1e6 + cls * 1e3 + types;
  }

  // Regole dei blocchi <style>, ordinate per specificità e poi per ordine di comparsa.
  function cssRules(doc) {
    const rules = [];
    let order = 0;
    for (const el of doc.getElementsByTagNameNS('*', 'style')) {
      const text = el.textContent || '';
      if (!text.trim()) continue;
      let sheet;
      try {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(text);
      } catch (e) {
        throw Error('Impossibile leggere il CSS interno dell’SVG in questo browser: converti gli stili in attributi.');
      }
      for (const rule of sheet.cssRules) {
        if (!rule.selectorText || !rule.style) continue;
        for (const selector of rule.selectorText.split(',').map((x) => x.trim()).filter(Boolean))
          rules.push({ selector, style: rule.style, spec: specificity(selector), order: order++ });
      }
    }
    return rules.sort((a, b) => a.spec - b.spec || a.order - b.order);
  }

  function inlineStyle(el) {
    const out = new Map();
    for (const part of (el.getAttribute('style') || '').split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      const name = part.slice(0, i).trim().toLowerCase();
      let value = part.slice(i + 1).trim();
      const important = /!\s*important$/i.test(value);
      if (important) value = value.replace(/!\s*important$/i, '').trim();
      if (name && value) out.set(name, { value, important });
    }
    return out;
  }

  // Valore dichiarato sull'elemento: inline !important > CSS !important > inline > CSS > attributo.
  function declared(el, prop, rules) {
    let css = null,
      cssImportant = null;
    for (const r of rules) {
      const v = r.style.getPropertyValue(prop);
      if (!v) continue;
      let ok = false;
      try {
        ok = el.matches(r.selector);
      } catch (ignore) {}
      if (!ok) continue;
      if (r.style.getPropertyPriority(prop) === 'important') cssImportant = v.trim();
      else css = v.trim();
    }
    const inline = inlineStyle(el).get(prop);
    if (inline && inline.important) return inline.value;
    if (cssImportant !== null) return cssImportant;
    if (inline) return inline.value;
    if (css !== null) return css;
    const a = el.getAttribute(prop);
    return a === null || a.trim() === '' ? null : a.trim();
  }

  function inherited(el, prop, rules, initial) {
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
      const v = declared(n, prop, rules);
      if (v !== null && v !== 'inherit') return v;
    }
    return initial;
  }

  const alpha = (v) => {
    if (v === null) return 1;
    const n = parseFloat(v);
    return Number.isFinite(n) ? (/%$/.test(v) ? n / 100 : n) : 1;
  };

  function rendered(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) if (NON_RENDERED.has(n.localName)) return false;
    return true;
  }

  function hidden(el, rules) {
    for (let n = el; n && n.nodeType === 1; n = n.parentNode)
      if (declared(n, 'display', rules) === 'none' || alpha(declared(n, 'opacity', rules)) <= 0) return true;
    return ['hidden', 'collapse'].includes(inherited(el, 'visibility', rules, 'visible'));
  }

  function filled(el, rules) {
    const fill = inherited(el, 'fill', rules, 'black').toLowerCase().replace(/\s+/g, '');
    if (
      fill === 'none' ||
      fill === 'transparent' ||
      /^(rgba|hsla)\(.*,0(\.0*)?%?\)$/.test(fill) ||
      /^#[0-9a-f]{3}0$|^#[0-9a-f]{6}00$/.test(fill)
    )
      return false;
    return alpha(inherited(el, 'fill-opacity', rules, '1')) > 0;
  }

  // Scala cumulata delle trasformazioni (radice del determinante), per lo spessore degli stroke.
  function transformScale(el) {
    let k = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
      const list = n.transform && n.transform.baseVal;
      const m = list && list.numberOfItems ? list.consolidate().matrix : null;
      if (m) k *= Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    }
    return k;
  }

  // Millimetri per unità utente dell'SVG, da width/height e viewBox (px a 96 dpi se senza unità).
  const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
  function physicalScale(root) {
    const length = (name) => {
      const m = /^\s*([\d.]+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px|)\s*$/i.exec(root.getAttribute(name) || '');
      return m ? { mm: parseFloat(m[1]) * UNIT_MM[m[2].toLowerCase()], absolute: m[2] !== '' && m[2].toLowerCase() !== 'px' } : null;
    };
    const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
    const w = length('width'),
      h = length('height');
    let mmPerUnit = 25.4 / 96;
    if (hasVb && w) mmPerUnit = w.mm / vb[2];
    else if (hasVb && h) mmPerUnit = h.mm / vb[3];
    else if (!hasVb && w) mmPerUnit = 25.4 / 96;
    return { mmPerUnit, sizeKnown: !!((w && w.absolute) || (h && h.absolute)) };
  }

  const CAPS = { butt: 'etOpenButt', round: 'etOpenRound', square: 'etOpenSquare' };
  const JOINS = { miter: 'jtMiter', 'miter-clip': 'jtMiter', arcs: 'jtMiter', round: 'jtRound', bevel: 'jtSquare' };
  const CLOSED_SHAPES = new Set(['rect', 'circle', 'ellipse', 'polygon']);

  // Contorno di uno stroke come regione piena (in unità SVG), calcolato con ClipperOffset.
  function strokeOutline(el, path, rules, unit) {
    const width = parseFloat(inherited(el, 'stroke-width', rules, '1')) * transformScale(el);
    if (!(width > 0)) return [];
    const cap = CAPS[inherited(el, 'stroke-linecap', rules, 'butt')] || 'etOpenButt',
      join = JOINS[inherited(el, 'stroke-linejoin', rules, 'miter')] || 'jtMiter',
      miter = Math.max(1, parseFloat(inherited(el, 'stroke-miterlimit', rules, '4')) || 4);
    const co = new ClipperLib.ClipperOffset(miter, 0.002 * width * unit);
    for (const sub of path.subPaths) {
      const pts = sub.getPoints();
      if (pts.length < 2) continue;
      const closed = CLOSED_SHAPES.has(el.localName) || sub.autoClose;
      const ints = pts.map((p) => ({ X: Math.round(p.x * unit), Y: Math.round(p.y * unit) }));
      co.AddPath(ints, ClipperLib.JoinType[join], closed ? ClipperLib.EndType.etClosedLine : ClipperLib.EndType[cap]);
    }
    const out = [];
    co.Execute(out, (width / 2) * unit);
    return out.map((p) => p.map((q) => ({ x: q.X / unit, y: q.Y / unit })));
  }

  function stroked(el, rules) {
    const stroke = inherited(el, 'stroke', rules, 'none').toLowerCase().replace(/\s+/g, '');
    if (stroke === 'none' || stroke === 'transparent' || /^(rgba|hsla)\(.*,0(\.0*)?%?\)$/.test(stroke)) return false;
    return alpha(inherited(el, 'stroke-opacity', rules, '1')) > 0;
  }

  // options.strokes: converte gli stroke visibili in aree piene (predefinito true).
  function parse(text, options = {}) {
    const strokes = options.strokes !== false;
    const probe = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (probe.querySelector('parsererror') || probe.documentElement.localName !== 'svg') throw Error('SVG non valido.');
    const data = new THREE.SVGLoader().parse(text),
      root = data.xml,
      rules = cssRules(root.ownerDocument),
      warnings = [];
    for (const el of root.querySelectorAll('text,image,use,foreignObject'))
      if (rendered(el) && !hidden(el, rules))
        throw Error('Espandere testi, immagini e use prima di importare (elemento <' + el.localName + '>).');
    for (const el of root.querySelectorAll('*')) {
      if (!rendered(el)) continue;
      for (const prop of ['clip-path', 'mask']) {
        const v = declared(el, prop, rules);
        if (v && v !== 'none')
          throw Error('Applicare o rimuovere ' + (prop === 'mask' ? 'le maschere' : 'i tracciati di ritaglio') + ' usati nel disegno prima di importare.');
      }
    }
    // Scala intera per gli offset degli stroke, proporzionata all'estensione del disegno.
    let extent = 1;
    for (const path of data.paths)
      for (const sub of path.subPaths) for (const p of sub.getPoints()) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
    const unit = 1e7 / extent;
    const result = [];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      strokeCount = 0,
      ignoredStrokes = 0,
      dashed = false;
    const add = (rule, polys) => {
      const kept = polys.filter((p) => p.length >= 3);
      if (!kept.length) return;
      for (const poly of kept)
        for (const p of poly) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      result.push({ rule, polys: kept });
    };
    for (const path of data.paths) {
      const el = path.userData && path.userData.node;
      if (!el || !rendered(el) || hidden(el, rules)) continue;
      if (filled(el, rules)) {
        const rule = inherited(el, 'fill-rule', rules, 'nonzero') === 'evenodd' ? 'evenodd' : 'nonzero';
        // Stessa risoluzione delle curve usata da SVGLoader.createShapes.
        add(rule, path.subPaths.map((sub) => sub.getPoints().map((p) => ({ x: p.x, y: p.y }))));
      }
      if (stroked(el, rules)) {
        if (!strokes) {
          ignoredStrokes++;
          continue;
        }
        const dash = inherited(el, 'stroke-dasharray', rules, 'none');
        if (dash !== 'none' && !/^0(\s*[, ]\s*0)*$/.test(dash)) dashed = true;
        const outline = strokeOutline(el, path, rules, unit);
        if (outline.length) {
          strokeCount++;
          add('nonzero', outline);
        }
      }
    }
    if (!result.length || maxX <= minX || maxY <= minY)
      throw Error('Nessuna area riempita valida.' + (ignoredStrokes ? ' Il disegno contiene solo contorni: attiva «Converti gli stroke in rilievi».' : ''));
    if (strokeCount) warnings.push(strokeCount + ' contorni (stroke) convertiti in aree piene.');
    if (dashed) warnings.push('Tratteggi degli stroke ignorati: convertiti come linee continue.');
    if (ignoredStrokes) warnings.push(ignoredStrokes + ' contorni (stroke) ignorati.');
    return { result, minX, minY, maxX, maxY, warnings, ...physicalScale(root) };
  }

  const svg = (body) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + body + '</svg>';

  // Test di interpretazione: aree attese con disegno largo 50 mm, ed elementi da accettare o rifiutare.
  function selfTest() {
    const s = { ...E.PRESETS.businessCard.values, w: 100, h: 70, aw: 50, ah: 0 };
    const artArea = (body) => E.geometry.area(E.model.artwork(parse(svg(body)), { s, align: 'center', invert: false, sheet: null }).paths);
    const frame = 'M0 0H100V100H0Z M20 20H80V80H20Z';
    const cases = [
      ['<path d="' + frame + '"/>', 2500, 'nonzero stesso verso'],
      ['<path fill-rule="evenodd" d="' + frame + '"/>', 1600, 'evenodd attributo'],
      ['<path style="fill-rule:evenodd" d="' + frame + '"/>', 1600, 'evenodd inline'],
      ['<style>#e{fill-rule:evenodd}</style><path id="e" d="' + frame + '"/>', 1600, 'evenodd CSS'],
      ['<g fill-rule="evenodd"><path d="' + frame + '"/></g>', 1600, 'evenodd ereditato'],
      ['<path fill-rule="evenodd" d="' + frame + ' M30 30H70V70H30Z"/>', 2000, 'evenodd isola'],
      [
        '<style>.n{fill:none}.h{display:none}g.k rect{fill:transparent}.o{opacity:0}</style>' +
          '<rect class="n" width="100" height="100"/><g class="h"><rect width="100" height="100"/></g>' +
          '<rect style="fill-opacity:0" width="100" height="100"/><g class="n"><rect width="100" height="100"/></g>' +
          '<g class="k"><rect width="100" height="100"/></g><rect class="o" width="100" height="100"/>' +
          '<rect fill="none" style="fill:black" width="10" height="10"/><rect x="90" y="90" width="10" height="10"/>',
        50,
        'fill CSS/inline/ereditato',
      ],
    ];
    for (const [body, expected, label] of cases) {
      const got = artArea(body);
      if (Math.abs(got - expected) >= 0.05)
        throw Error('Riempimento SVG errato (' + label + '): area ' + got.toFixed(2) + ' mm² invece di ' + expected + '.');
    }
    artArea(
      '<defs><clipPath id="c"><rect width="100" height="100"/></clipPath><mask id="m"><rect width="100" height="100"/></mask><text>x</text></defs>' +
        '<rect width="100" height="100"/>',
    );
    for (const body of [
      '<defs><clipPath id="c"><rect width="10" height="10"/></clipPath></defs><rect clip-path="url(#c)" width="100" height="100"/>',
      '<style>g{mask:url(#m)}</style><defs><mask id="m"><rect width="10" height="10"/></mask></defs><g><rect width="100" height="100"/></g>',
      '<text>x</text><rect width="100" height="100"/>',
    ]) {
      let refused = false;
      try {
        parse(svg(body));
      } catch (e) {
        refused = /prima di importare/.test(e.message);
      }
      if (!refused) throw Error('Elemento non supportato non rifiutato: ' + body);
    }
    // Stroke convertiti in aree piene.
    const strokeArea = (body, o) => E.geometry.area(E.model.artwork(parse(svg(body), o), { s, align: 'center', invert: false, sheet: null }).paths);
    const ring = strokeArea('<rect x="10" y="10" width="80" height="80" fill="none" stroke="#000" stroke-width="10"/>');
    // Ingombro 5..95 (90 unità) → scala 50/90; area 90² − 70² unità.
    if (Math.abs(ring - (90 * 90 - 70 * 70) * (50 / 90) ** 2) > 0.5) throw Error('Stroke chiuso convertito male: area ' + ring.toFixed(1));
    const line = strokeArea('<g transform="scale(2)"><line x1="0" y1="25" x2="50" y2="25" stroke="black" stroke-width="5"/></g>');
    // Linea 100 × 10 unità (stroke scalato ×2, estremi netti) → larga 50 mm, alta 5 mm.
    if (Math.abs(line - 250) > 0.5) throw Error('Stroke aperto o scala della trasformazione errati: area ' + line.toFixed(1));
    let strokeOff = false;
    try {
      strokeArea('<circle cx="50" cy="50" r="40" fill="none" stroke="black"/>', { strokes: false });
    } catch (e) {
      strokeOff = /solo contorni/.test(e.message);
    }
    if (!strokeOff) throw Error('Disattivazione degli stroke non rispettata.');
    // Dimensioni reali: 100 unità di viewBox in 40 mm.
    const real = parse('<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 100 50"><rect width="100" height="50"/></svg>');
    if (!real.sizeKnown || Math.abs(real.mmPerUnit - 0.4) > 1e-9) throw Error('Dimensioni reali dell’SVG non lette.');
    const realArea = E.geometry.area(E.model.artwork(real, { s, align: 'center', invert: false, sheet: null, scaleMode: 'file' }).paths);
    if (Math.abs(realArea - 800) > 0.05) throw Error('Scala dalle dimensioni reali errata: area ' + realArea.toFixed(2));
    const inch = parse('<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="1in"><rect width="96" height="96"/></svg>');
    if (Math.abs(inch.mmPerUnit - 25.4 / 96) > 1e-9) throw Error('Unità px senza viewBox errata.');
    // Sorgenti per i test geometrici nel worker.
    return {
      frame: parse(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 1280"><g transform="translate(0,1280) scale(0.1,-0.1)" fill="black" stroke="none">' +
          '<path d="M0 6400 l0 -6400 6400 0 6400 0 0 6400 0 6400 -6400 0 -6400 0 0 -6400z m9510 -75 l0 -3035 -3035 0 -3035 0 0 3035 0 3035 3035 0 3035 0 0 -3035z"/></g></svg>',
      ),
      full: parse('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H200V80H0Z"/></svg>'),
      // Molti rettangoli con il fondo sulla stessa retta: la triangolazione crea spigoli lunghi con decine di giunzioni a T.
      aligned: parse(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 45"><path d="' +
          Array.from({ length: 14 }, (_, i) => `M${i * 14} 10 C${i * 14 + 12} 0 ${i * 14 + 12} 40 ${i * 14} 30 Q${i * 14 + 6} 20 ${i * 14} 10Z M${i * 14 + 3} 34 h6 v4 h-6Z`).join(' ') +
          '"/></svg>',
      ),
    };
  }

  E.svg = { parse, selfTest };
})((self.Embosser = self.Embosser || {}));
