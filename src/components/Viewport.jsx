import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { createBuildingModel } from "../three/BuildingModel.js";
import { isElementVisible } from "../three/ModelViews.js";

export default function Viewport({ view, showGrid = true }) {
  const hostRef = useRef(null);
  const viewRef = useRef(view);
  const showGridRef = useRef(showGrid);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#15181b");
    scene.fog = new THREE.Fog("#15181b", 18, 38);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (error) {
      console.error("BuildLens could not initialize WebGL:", error);
      const fallback = document.createElement("div");
      fallback.setAttribute("role", "status");
      fallback.style.cssText = "position:absolute;inset:0;display:grid;place-content:center;gap:10px;padding:24px;text-align:center;background:#15181b;color:#e8ebee;font:13px/1.6 system-ui,sans-serif";
      fallback.innerHTML = '<strong>3D preview is unavailable on this browser</strong><span style="color:#9ba6ad;font-size:12px">The workspace is still available. Try a browser or device with WebGL enabled.</span>';
      host.appendChild(fallback);
      return () => fallback.remove();
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.touchAction = "none";
    host.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xc8d5e0, 0x282a2d, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(7, 12, 8); key.castShadow = true; scene.add(key);
    const { elements } = createBuildingModel(scene);
    const grid = new THREE.GridHelper(16, 32, "#495159", "#30363b");
    grid.position.y = -0.12; scene.add(grid);

    let azimuth = Math.PI / 4, elevation = 0.55, distance = 15;
    let draggingPointer = null, previousX = 0, previousY = 0, pinchDistance = 0;
    const pointers = new Map();
    const target = new THREE.Vector3(0, 3, 0);
    const updateCamera = () => {
      elevation = Math.max(0.12, Math.min(1.35, elevation));
      distance = Math.max(7, Math.min(25, distance));
      camera.position.set(target.x + distance * Math.sin(azimuth) * Math.cos(elevation), target.y + distance * Math.sin(elevation), target.z + distance * Math.cos(azimuth) * Math.cos(elevation));
      camera.lookAt(target);
    };
    const resetCamera = () => { azimuth = Math.PI / 4; elevation = 0.55; distance = 15; target.set(0, 3, 0); updateCamera(); };
    const getPinchDistance = () => {
      const pts = [...pointers.values()];
      return pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    };
    const onPointerDown = e => {
      renderer.domElement.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) { draggingPointer = e.pointerId; previousX = e.clientX; previousY = e.clientY; }
      if (pointers.size === 2) { draggingPointer = null; pinchDistance = getPinchDistance(); }
    };
    const onPointerMove = e => {
      if (!pointers.has(e.pointerId)) return;
      const previous = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        const nextDistance = getPinchDistance();
        if (pinchDistance > 0 && nextDistance > 0) distance += (pinchDistance - nextDistance) * 0.025;
        pinchDistance = nextDistance; updateCamera(); return;
      }
      if (draggingPointer === e.pointerId) {
        azimuth -= (e.clientX - previous.x) * 0.008;
        elevation += (e.clientY - previous.y) * 0.006;
        updateCamera();
      }
    };
    const onPointerUp = e => {
      pointers.delete(e.pointerId);
      if (draggingPointer === e.pointerId) draggingPointer = null;
      pinchDistance = pointers.size === 2 ? getPinchDistance() : 0;
      if (pointers.size === 1) {
        const [id, point] = [...pointers.entries()][0];
        draggingPointer = id; previousX = point.x; previousY = point.y;
      }
    };
    const onWheel = e => { e.preventDefault(); distance += e.deltaY * 0.012; updateCamera(); };
    const onReset = () => resetCamera();
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
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
      grid.visible = showGridRef.current && viewRef.current !== "foundation";
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
      host.removeEventListener("buildlens-reset", onReset);
      delete host.__resetBuildLensCamera;
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(material => material.dispose());
      });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  return <div className="viewport-canvas" ref={hostRef} aria-label="Interactive illustrative 3D building model" />;
}