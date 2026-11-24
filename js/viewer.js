// Anteprima 3D (Three.js): due piastre affiancate o unite dalla cerniera, perimetro del foglio e inquadratura.
'use strict';
(function (E) {
  E.createViewer = function (container) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x22262c);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -180, 220);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.append(renderer.domElement);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    for (const [x, y, z, power] of [[80, -100, 180, 1], [-80, 60, 100, 0.5]]) {
      const l = new THREE.DirectionalLight(0xffffff, power);
      l.position.set(x, y, z);
      scene.add(l);
    }
    const resize = () => {
      renderer.setSize(container.clientWidth, container.clientHeight);
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(container);
    resize();
    (function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    })();

    let objects = [],
      layout = null, // null: piastre separate; altrimenti { s, hinge, pivot }
      foldDeg = 0,
      plateW = 100;

    function add(object) {
      scene.add(object);
      objects.push(object);
    }
    function applyFold() {
      if (!layout || !layout.pivot) return;
      const a = (-foldDeg * Math.PI) / 180;
      if (layout.hinge.side === 'bottom') layout.pivot.rotation.set(a, 0, 0);
      else layout.pivot.rotation.set(0, a, 0);
    }
    // Posizione di una piastra: genitore (scena o perno della cerniera) e centro.
    function place(which) {
      if (!layout) return { parent: null, x: which === 'positive' ? -plateW / 2 - 8 : plateW / 2 + 8, y: 0, z: 0 };
      const [x, y] = layout.hinge.centers[which === 'positive' ? 0 : 1];
      return which === 'positive' ? { parent: null, x, y, z: 0 } : { parent: layout.pivot, x, y, z: -layout.hinge.zh };
    }
    function put(object, which) {
      const at = place(which);
      object.position.set(at.x, at.y, at.z);
      if (at.parent) at.parent.add(object);
      else add(object);
    }
    function outline(points, color, order) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const line = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false }));
      line.renderOrder = order;
      return line;
    }

    return {
      get count() {
        return objects.length;
      },
      clear() {
        for (const o of objects) {
          scene.remove(o);
          o.traverse((c) => {
            if (c.geometry) c.geometry.dispose();
            if (c.material) c.material.dispose();
          });
        }
        objects = [];
        layout = null;
      },
      // Disposizione: piastre separate (hinge = null) o unite dalla cerniera (info del modello).
      setLayout(s, hinge) {
        plateW = s.w;
        layout = null;
        if (!hinge) return;
        const pivot = new THREE.Group();
        pivot.position.set(0, 0, hinge.zh);
        add(pivot);
        layout = { s, hinge, pivot };
        applyFold();
      },
      // Angolo di chiusura della cerniera nell'anteprima (0° aperta, 180° chiusa).
      fold(deg) {
        foldDeg = deg;
        applyFold();
      },
      // vertices: Float32Array piatto di triangoli; which: 'positive' | 'negative'.
      // Con la cerniera i vertici sono già nella posizione di stampa.
      show(vertices, color, which) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.08 }));
        if (layout) {
          if (which === 'negative') {
            m.position.z = -layout.hinge.zh;
            layout.pivot.add(m);
          } else add(m);
        } else put(m, which);
      },
      // Perimetro rosso del foglio sopra entrambe le piastre (solo guida, non esportato).
      sheet(s, sheet) {
        if (!sheet) return;
        plateW = s.w;
        const z = s.b + s.r + 0.05;
        for (const which of ['positive', 'negative'])
          put(outline([-sheet.w / 2, -sheet.h / 2, z, sheet.w / 2, -sheet.h / 2, z, sheet.w / 2, sheet.h / 2, z, -sheet.w / 2, sheet.h / 2, z], 0xff3030, 10), which);
      },
      // Contorni arancioni delle zone troppo sottili, sopra la piastra indicata alla quota z.
      thin(loops, which, z) {
        for (const loop of loops || []) {
          const pts = [];
          for (let i = 0; i < loop.length; i += 2) pts.push(loop[i], loop[i + 1], z);
          put(outline(pts, 0xffa020, 11), which);
        }
      },
      fit() {
        if (!objects.length) return;
        const box = new THREE.Box3();
        for (const o of objects) box.union(new THREE.Box3().setFromObject(o));
        const center = box.getCenter(new THREE.Vector3()),
          size = box.getSize(new THREE.Vector3()),
          d = Math.max(size.x / camera.aspect, size.y, size.z) * 1.65;
        controls.target.copy(center);
        camera.position.copy(center).add(new THREE.Vector3(0, -d * 0.65, d));
        camera.far = Math.max(2000, d * 20);
        camera.updateProjectionMatrix();
        controls.update();
      },
    };
  };
})((self.Embosser = self.Embosser || {}));
