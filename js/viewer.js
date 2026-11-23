// Anteprima 3D (Three.js): due piastre affiancate, perimetro del foglio e inquadratura.
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

    let objects = [];

    function add(object) {
      scene.add(object);
      objects.push(object);
    }

    return {
      get count() {
        return objects.length;
      },
      clear() {
        for (const o of objects) {
          scene.remove(o);
          o.geometry.dispose();
          o.material.dispose();
        }
        objects = [];
      },
      // vertices: Float32Array piatto di triangoli.
      show(vertices, color, x) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.08 }));
        m.position.x = x;
        add(m);
      },
      // Perimetro rosso del foglio sopra entrambe le piastre (solo guida, non esportato).
      sheet(s, sheet) {
        if (!sheet) return;
        for (const x of [-s.w / 2 - 8, s.w / 2 + 8]) {
          const z = s.b + s.r + 0.05,
            g = new THREE.BufferGeometry();
          g.setAttribute(
            'position',
            new THREE.Float32BufferAttribute([-sheet.w / 2, -sheet.h / 2, z, sheet.w / 2, -sheet.h / 2, z, sheet.w / 2, sheet.h / 2, z, -sheet.w / 2, sheet.h / 2, z], 3),
          );
          const line = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: 0xff3030, depthTest: false, depthWrite: false }));
          line.position.x = x;
          line.renderOrder = 10;
          add(line);
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
