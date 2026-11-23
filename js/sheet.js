// Simulazione del foglio goffrato: mappa di altezze sul formato del foglio (preset) o sull'ingombro del disegno,
// anteprima con luce radente e finestra con il modello 3D orbitabile. Solo pagina (usa canvas e WebGL).
// È una stima visiva: la carta reale dipende da grammatura, fibre, umidità e pressione.
'use strict';
(function (E) {
  const INF = 1e20;

  // Trasformata di distanza euclidea esatta (Felzenszwalb–Huttenlocher), 1D.
  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  }
  // Distanza al quadrato (in celle) dalla cella più vicina con feature[i] = 1.
  function edt(feature, nx, ny) {
    const out = new Float64Array(nx * ny),
      n = Math.max(nx, ny),
      f = new Float64Array(n),
      d = new Float64Array(n),
      v = new Int32Array(n),
      z = new Float64Array(n + 1);
    for (let i = 0; i < nx * ny; i++) out[i] = feature[i] ? 0 : INF;
    for (let x = 0; x < nx; x++) {
      for (let y = 0; y < ny; y++) f[y] = out[y * nx + x];
      edt1d(f, ny, d, v, z);
      for (let y = 0; y < ny; y++) out[y * nx + x] = d[y];
    }
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) f[x] = out[y * nx + x];
      edt1d(f, nx, d, v, z);
      for (let x = 0; x < nx; x++) out[y * nx + x] = d[x];
    }
    return out;
  }

  // Sfocatura separabile 3 × 3 ripetuta: elimina la scalettatura della rasterizzazione e arrotonda la piega come fa la carta.
  function smooth(a, nx, ny, passes) {
    const tmp = new Float32Array(a.length);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const i = y * nx + x;
          tmp[i] = (a[i - (x > 0 ? 1 : 0)] + a[i] + a[i + (x < nx - 1 ? 1 : 0)]) / 3;
        }
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const i = y * nx + x;
          a[i] = (tmp[i - (y > 0 ? nx : 0)] + tmp[i] + tmp[i + (y < ny - 1 ? nx : 0)]) / 3;
        }
    }
  }

  const bounds = (loops) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of loops)
      for (let i = 0; i < l.length; i += 2) {
        minX = Math.min(minX, l[i]); maxX = Math.max(maxX, l[i]);
        minY = Math.min(minY, l[i + 1]); maxY = Math.max(maxY, l[i + 1]);
      }
    return { minX, minY, maxX, maxY };
  };

  // relief: contorni piatti [x,y,…] in mm del rilievo (come nella pianta della positiva).
  // Restituisce la griglia di altezze della faccia inferiore della carta, centrata sul foglio.
  function model(relief, s, sheet) {
    let w, h, cx, cy;
    if (sheet) {
      [w, h, cx, cy] = [sheet.w, sheet.h, 0, 0];
    } else {
      if (!relief || !relief.length) return null;
      const b = bounds(relief);
      [w, h, cx, cy] = [b.maxX - b.minX + 10, b.maxY - b.minY + 10, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
    }
    const cell = Math.max(0.1, Math.sqrt((w * h) / 220000)),
      nx = Math.max(2, Math.round(w / cell) + 1),
      ny = Math.max(2, Math.round(h / cell) + 1),
      dx = w / (nx - 1),
      dy = h / (ny - 1);
    // Rasterizzazione del rilievo (regola evenodd: i contorni di Clipper non si sovrappongono).
    const canvas = document.createElement('canvas');
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    const px = (x) => (x - (cx - w / 2)) / dx,
      py = (y) => (cy + h / 2 - y) / dy;
    for (const l of relief || []) {
      if (l.length < 6) continue;
      ctx.moveTo(px(l[0]), py(l[1]));
      for (let i = 2; i < l.length; i += 2) ctx.lineTo(px(l[i]), py(l[i + 1]));
      ctx.closePath();
    }
    ctx.fill('evenodd');
    const pixels = ctx.getImageData(0, 0, nx, ny).data,
      inside = new Uint8Array(nx * ny),
      outside = new Uint8Array(nx * ny);
    let any = false;
    for (let i = 0; i < nx * ny; i++) {
      inside[i] = pixels[i * 4 + 3] > 127 ? 1 : 0;
      outside[i] = 1 - inside[i];
      any = any || inside[i] === 1;
    }
    const height = new Float32Array(nx * ny);
    const r = (s.r || 0) * 1,
      t = Math.tan(((s.draft || 0) * Math.PI) / 180),
      ramp = Math.max(0.15, (s.lateral || 0) + (s.paper || 0) + r * t); // larghezza della piega sul bordo
    if (any) {
      const dIn = edt(outside, nx, ny),
        dOut = edt(inside, nx, ny),
        c = Math.min(dx, dy);
      for (let i = 0; i < nx * ny; i++) {
        const sd = inside[i] ? Math.sqrt(dIn[i]) * c - c / 2 : -Math.sqrt(dOut[i]) * c + c / 2;
        const u = Math.min(1, Math.max(0, (sd + ramp / 2) / ramp));
        height[i] = r * u * u * (3 - 2 * u);
      }
      smooth(height, nx, ny, 2);
    }
    return { w, h, cx, cy, nx, ny, dx, dy, height, thickness: Math.max(0.05, s.paper || 0.12), relief: r, embossed: any };
  }

  // Anteprima statica con luce radente da in alto a sinistra (rilievo esagerato per leggibilità).
  function drawPreview(canvas, m) {
    canvas.width = m.nx;
    canvas.height = m.ny;
    const ctx = canvas.getContext('2d'),
      img = ctx.createImageData(m.nx, m.ny),
      L = [-0.55, 0.55, 0.63],
      flat = 0.63 / Math.hypot(...L),
      k = 4; // esagerazione delle pendenze
    for (let y = 0; y < m.ny; y++)
      for (let x = 0; x < m.nx; x++) {
        const i = y * m.nx + x,
          hx = (m.height[y * m.nx + Math.min(m.nx - 1, x + 1)] - m.height[y * m.nx + Math.max(0, x - 1)]) / (2 * m.dx),
          hy = (m.height[Math.max(0, y - 1) * m.nx + x] - m.height[Math.min(m.ny - 1, y + 1) * m.nx + x]) / (2 * m.dy);
        const nx = -k * hx, ny = -k * hy, len = Math.hypot(nx, ny, 1);
        // Carta piatta al 93% di luminosità; i lati rivolti alla luce schiariscono, gli altri fanno ombra.
        const dot = (nx * L[0] + ny * L[1] + L[2]) / len / Math.hypot(...L);
        const shade = Math.max(0.25, Math.min(1.06, 0.93 + 1.1 * (dot - flat)));
        img.data[i * 4] = Math.min(255, 250 * shade);
        img.data[i * 4 + 1] = Math.min(255, 247 * shade);
        img.data[i * 4 + 2] = Math.min(255, 238 * shade);
        img.data[i * 4 + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }

  // Geometria chiusa del foglio: faccia superiore (z = altezza + spessore), inferiore e bordi.
  function geometry(m, exaggeration = 1) {
    const { nx, ny, w, h, height, thickness } = m,
      n = nx * ny,
      pos = new Float32Array(n * 2 * 3),
      index = [];
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x,
          X = -w / 2 + x * m.dx,
          Y = h / 2 - y * m.dy,
          Z = height[i] * exaggeration;
        pos.set([X, Y, Z + thickness], i * 3);
        pos.set([X, Y, Z], (n + i) * 3);
      }
    for (let y = 0; y < ny - 1; y++)
      for (let x = 0; x < nx - 1; x++) {
        const a = y * nx + x, b = a + 1, c = a + nx, d = c + 1;
        index.push(a, c, b, b, c, d); // superiore, normale verso +Z
        index.push(n + a, n + b, n + c, n + b, n + d, n + c); // inferiore
      }
    const edge = (a, b) => index.push(a, n + a, b, b, n + a, n + b);
    for (let x = 0; x < nx - 1; x++) {
      edge(x + 1, x); // lato superiore (Y = h/2)
      edge((ny - 1) * nx + x, (ny - 1) * nx + x + 1); // lato inferiore
    }
    for (let y = 0; y < ny - 1; y++) {
      edge(y * nx, (y + 1) * nx); // lato sinistro
      edge((y + 1) * nx + nx - 1, y * nx + nx - 1); // lato destro
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }

  // Finestra con il foglio 3D orbitabile.
  function openViewer(dialog, container, m, options = {}) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.replaceChildren(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a2f36);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(-120, 90, 55); // luce radente: mette in evidenza la goffratura
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(80, -60, 120);
    scene.add(fill);
    const material = new THREE.MeshStandardMaterial({ color: 0xf6f2e8, roughness: 0.92, metalness: 0 });
    let mesh = null,
      flipped = false;
    const build = (exaggeration) => {
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      mesh = new THREE.Mesh(geometry(m, exaggeration), material);
      mesh.rotation.y = flipped ? Math.PI : 0;
      scene.add(mesh);
    };
    build(options.exaggeration || 1);
    const size = Math.max(m.w, m.h);
    const frame = () => {
      controls.target.set(0, 0, 0);
      camera.position.set(0, -size * 0.9, size * 1.25);
      controls.update();
    };
    frame();
    const resize = () => {
      const width = container.clientWidth || 600,
        height = container.clientHeight || 400;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    let running = true;
    (function animate() {
      if (!running) return;
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    })();
    const api = {
      exaggerate: build,
      flip() {
        flipped = !flipped;
        mesh.rotation.y = flipped ? Math.PI : 0;
        return flipped;
      },
      frame,
      close() {
        running = false;
        observer.disconnect();
        mesh.geometry.dispose();
        material.dispose();
        controls.dispose();
        renderer.dispose();
        container.replaceChildren();
      },
    };
    return api;
  }

  // Test della simulazione: rilievo quadrato al centro di un foglio 40 × 30 mm.
  function selfTest() {
    const s = { r: 0.8, paper: 0.12, lateral: 0.2, draft: 0 };
    const sq = [[-10, -10, 10, -10, 10, 10, -10, 10]];
    const m = model(sq, s, { w: 40, h: 30 });
    const at = (x, y) => m.height[Math.round((m.h / 2 - y) / m.dy) * m.nx + Math.round((x + m.w / 2) / m.dx)];
    if (Math.abs(at(0, 0) - 0.8) > 1e-6 || Math.abs(at(-19, -14)) > 1e-6) throw Error('Simulazione del foglio errata: altezze al centro/angolo.');
    const edge = at(10, 0);
    if (!(edge > 0.2 && edge < 0.6)) throw Error('Simulazione del foglio errata: piega sul bordo ' + edge.toFixed(3));
    const hole = model([[-10, -10, 10, -10, 10, 10, -10, 10, -10, -10], [-4, -4, -4, 4, 4, 4, 4, -4]], s, { w: 40, h: 30 });
    if (Math.abs(hole.height[Math.round(hole.h / 2 / hole.dy) * hole.nx + Math.round(hole.w / 2 / hole.dx)]) > 1e-6)
      throw Error('Simulazione del foglio: i fori del rilievo devono restare piatti.');
    const free = model(sq, s, null);
    if (Math.abs(free.w - 30) > 1e-9 || Math.abs(free.h - 30) > 1e-9) throw Error('Foglio senza preset: atteso ingombro più 5 mm per lato.');
  }

  E.sheet = { model, drawPreview, geometry, openViewer, selfTest };
})((self.Embosser = self.Embosser || {}));
