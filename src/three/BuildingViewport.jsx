import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function BuildingViewport({ view, showLabels = true }) {
  const hostRef = useRef(null);
  const viewRef = useRef(view);
  const labelsRef = useRef(showLabels);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { labelsRef.current = showLabels; }, [showLabels]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#15181b");
    scene.fog = new THREE.Fog("#15181b", 18, 38);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(9, 7, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xc8d5e0, 0x282a2d, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(7, 12, 8);
    key.castShadow = true;
    scene.add(key);

    const building = new THREE.Group();
    scene.add(building);
    const mats = {
      concrete: new THREE.MeshStandardMaterial({ color: "#a9b0b5", roughness: 0.82, metalness: 0.04 }),
      slab: new THREE.MeshStandardMaterial({ color: "#737d85", roughness: 0.9, transparent: true, opacity: 0.62 }),
      beam: new THREE.MeshStandardMaterial({ color: "#d2d7db", roughness: 0.7 }),
      rebar: new THREE.MeshStandardMaterial({ color: "#c18b58", metalness: 0.62, roughness: 0.38 }),
      ground: new THREE.MeshStandardMaterial({ color: "#282d31", roughness: 1 }),
      foundation: new THREE.MeshStandardMaterial({ color: "#69747c", roughness: 0.92 })
    };
    const elements = [];
    const addBox = (name, size, pos, material, category = "structure") => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { name, category };
      building.add(mesh);
      elements.push(mesh);
      return mesh;
    };

    // Illustrative sample only: dimensions are demonstration geometry, not a design.
    addBox("Ground plane", [16, 0.08, 13], [0, -0.18, 0], mats.ground, "ground");
    const xs = [-3, 0, 3];
    const zs = [-2.5, 0, 2.5];
    const floors = [0.18, 3.18, 6.18];
    floors.forEach((y, floorIndex) => {
      addBox(`Floor slab ${floorIndex + 1}`, [6.7, 0.16, 5.7], [0, y, 0], mats.slab, "slab");
      if (floorIndex < floors.length - 1) {
        xs.forEach((x, xi) => zs.forEach((z, zi) => {
          addBox(`Column ${floorIndex + 1}-${xi + 1}${zi + 1}`, [0.24, 3, 0.24], [x, y + 1.58, z], mats.concrete, "column");
        }));
        // beams run along X and Z between column lines
        zs.forEach((z, i) => addBox(`Beam X-${floorIndex + 1}-${i + 1}`, [6, 0.22, 0.22], [0, y + 2.96, z], mats.beam, "beam"));
        xs.forEach((x, i) => addBox(`Beam Z-${floorIndex + 1}-${i + 1}`, [0.22, 0.22, 5], [x, y + 2.96, 0], mats.beam, "beam"));
      }
    });

    // Footings, shown only in the foundation view.
    xs.forEach((x, xi) => zs.forEach((z, zi) => {
      addBox(`Illustrative footing ${xi + 1}-${zi + 1}`, [0.95, 0.35, 0.95], [x, -0.42, z], mats.foundation, "foundation");
    }));

    // A restrained illustrative reinforcement grid for demonstrating the view toggle.
    for (let i = 0; i < 5; i++) {
      const x = -2.7 + i * 1.35;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 5.2, 8), mats.rebar);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(x, 0.34, 0);
      bar.userData = { name: "Illustrative slab reinforcement", category: "rebar" };
      building.add(bar);
      elements.push(bar);
    }

    const grid = new THREE.GridHelper(16, 32, "#495159", "#30363b");
    grid.position.y = -0.12;
    scene.add(grid);

    let dragging = false, moved = false, previousX = 0, previousY = 0;
    let azimuth = Math.PI / 4, elevation = 0.55, distance = 15;
    const target = new THREE.Vector3(0, 3, 0);
    const updateCamera = () => {
      elevation = Math.max(0.12, Math.min(1.35, elevation));
      distance = Math.max(7, Math.min(25, distance));
      camera.position.set(
        target.x + distance * Math.sin(azimuth) * Math.cos(elevation),
        target.y + distance * Math.sin(elevation),
        target.z + distance * Math.cos(azimuth) * Math.cos(elevation)
      );
      camera.lookAt(target);
    };
    updateCamera();

    const onPointerDown = e => { dragging = true; moved = false; previousX = e.clientX; previousY = e.clientY; renderer.domElement.setPointerCapture?.(e.pointerId); };
    const onPointerMove = e => {
      if (!dragging) return;
      const dx = e.clientX - previousX, dy = e.clientY - previousY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      azimuth -= dx * 0.008;
      elevation += dy * 0.006;
      previousX = e.clientX; previousY = e.clientY;
      updateCamera();
    };
    const onPointerUp = () => { dragging = false; };
    const onWheel = e => { e.preventDefault(); distance += e.deltaY * 0.012; updateCamera(); };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    let touchDistance = 0;
    const onTouchStart = e => { if (e.touches.length === 2) touchDistance = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); };
    const onTouchMove = e => {
      if (e.touches.length === 2) {
        const next = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
        distance += (touchDistance - next) * 0.025;
        touchDistance = next;
        updateCamera();
      }
    };
    renderer.domElement.addEventListener("touchstart", onTouchStart, { passive: true });
    renderer.domElement.addEventListener("touchmove", onTouchMove, { passive: true });

    const resetCamera = () => { azimuth = Math.PI / 4; elevation = 0.55; distance = 15; target.set(0, 3, 0); updateCamera(); };
    host.__resetBuildLensCamera = resetCamera;
    const onResetEvent = () => resetCamera();
    host.addEventListener("buildlens-reset", onResetEvent);

    const resize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const activeView = viewRef.current;
      elements.forEach(el => {
        const cat = el.userData.category;
        el.visible = activeView === "building" ||
          (activeView === "structure" && ["structure", "column", "beam", "slab"].includes(cat)) ||
          (activeView === "foundation" && ["foundation", "ground", "column"].includes(cat)) ||
          (activeView === "rebar" && ["rebar", "slab", "beam"].includes(cat));
        if (cat === "foundation") el.visible = activeView === "foundation";
        if (cat === "rebar") el.visible = activeView === "rebar";
      });
      grid.visible = activeView !== "foundation";
      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("touchstart", onTouchStart);
      renderer.domElement.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("buildlens-reset", onResetEvent);
      delete host.__resetBuildLensCamera;
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (host && view === "building" && host.__resetBuildLensCamera) {
      // Camera reset is intentionally available from the viewport toolbar.
    }
  }, [view]);

  return <div className="viewport-canvas" ref={hostRef} aria-label="Interactive illustrative 3D building model" />;
}