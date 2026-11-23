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

  function parse(text) {
    const probe = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (probe.querySelector('parsererror') || probe.documentElement.localName !== 'svg') throw Error('SVG non valido.');
    const data = new THREE.SVGLoader().parse(text),
      root = data.xml,
      rules = cssRules(root.ownerDocument);
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
    const result = [];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const path of data.paths) {
      const el = path.userData && path.userData.node;
      if (!el || !rendered(el) || hidden(el, rules) || !filled(el, rules)) continue;
      const rule = inherited(el, 'fill-rule', rules, 'nonzero') === 'evenodd' ? 'evenodd' : 'nonzero',
        polys = [];
      for (const sub of path.subPaths) {
        // Stessa risoluzione delle curve usata da SVGLoader.createShapes.
        const pts = sub.getPoints();
        if (pts.length < 3) continue;
        polys.push(pts.map((p) => ({ x: p.x, y: p.y })));
        for (const p of pts) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
      if (polys.length) result.push({ rule, polys });
    }
    if (!result.length || maxX <= minX || maxY <= minY) throw Error('Nessuna area riempita valida.');
    return { result, minX, minY, maxX, maxY };
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
    // Sorgenti per i test geometrici nel worker.
    return {
      frame: parse(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 1280"><g transform="translate(0,1280) scale(0.1,-0.1)" fill="black" stroke="none">' +
          '<path d="M0 6400 l0 -6400 6400 0 6400 0 0 6400 0 6400 -6400 0 -6400 0 0 -6400z m9510 -75 l0 -3035 -3035 0 -3035 0 0 3035 0 3035 3035 0 3035 0 0 -3035z"/></g></svg>',
      ),
      full: parse('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H200V80H0Z"/></svg>'),
    };
  }

  E.svg = { parse, selfTest };
})((self.Embosser = self.Embosser || {}));
