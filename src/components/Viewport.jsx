import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createBuildingModel } from "../three/BuildingModel.js";
import { isElementVisible } from "../three/ModelViews.js";

export default function Viewport({ view, showGrid = true }) {
  const hostRef = useRef(null);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#15181b");
    scene.fog = new THREE.Fog("#15181b", 18, 38);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
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
    const { elements } = createBuildingModel(scene);
    const grid = new THREE.GridHelper(16, 32, "#495159", "#30363b");
    grid.position.y = -0.12;
    scene.add(grid);

    let previousX = 0, previousY = 0, dragging = false;
    let azimuth = Math.PI / 4, elevation = 0.55, distance = 15;
    const target = new THREE.Vector3(0, 3, 0);
    const updateCamera = () => {
      elevation = Math.max(0.12, Math.min(1.35, elevation));
      distance = Math.max(7, Math.min(25, distance));
      camera.position.set(target.x + distance * Math.sin(azimuth) * Math.cos(elevation), target.y + distance * Math.sin(elevation), target.z + distance * Math.cos(azimuth) * Math.cos(elevation));
      camera.lookAt(target);
    };
    const resetCamera = () => { azimuth = Math.PI / 4; elevation = 0.55; distance = 15; target.set(0, 3, 0); updateCamera(); };
    updateCamera();
    const onPointerDown = e => { dragging = true; previousX = e.clientX; previousY = e.clientY; renderer.domElement.setPointerCapture?.(e.pointerId); };
    const onPointerMove = e => {
      if (!dragging) return;
      azimuth -= (e.clientX - previousX) * 0.008;
      elevation += (e.clientY - previousY) * 0.006;
      previousX = e.clientX; previousY = e.clientY; updateCamera();
    };
    const onPointerUp = () => { dragging = false; };
    const onWheel = e => { e.preventDefault(); distance += e.deltaY * 0.012; updateCamera(); };
    const onTouchMove = e => {
      if (e.touches.length === 2) {
        const next = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (host.__touchDistance) distance += (host.__touchDistance - next) * 0.025;
        host.__touchDistance = next; updateCamera();
      }
    };
    const onTouchEnd = () => { host.__touchDistance = 0; };
    const onReset = () => resetCamera();
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("touchmove", onTouchMove, { passive: true });
    renderer.domElement.addEventListener("touchend", onTouchEnd, { passive: true });
    host.addEventListener("buildlens-reset", onReset);
    host.__resetBuildLensCamera = resetCamera;

    const resize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host); resize();
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      elements.forEach(element => { element.visible = isElementVisible(element.userData.category, viewRef.current); });
      grid.visible = showGrid && viewRef.current !== "foundation";
      renderer.render(scene, camera);
    };
    render();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("touchmove", onTouchMove);
      renderer.domElement.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("buildlens-reset", onReset);
      delete host.__resetBuildLensCamera; delete host.__touchDistance;
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(material => material.dispose());
      });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  return <div className="viewport-canvas" ref={hostRef} aria-label="Interactive illustrative 3D building model" />;
}