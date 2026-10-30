import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
    scene.fog = new THREE.Fog("#15181b", 22, 55);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 150);
    camera.position.set(11, 10, 13);
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
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
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

    // OrbitControls supplies orbit, pan, mouse-wheel zoom, two-finger
    // pinch zoom and two-finger pan on touch devices.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 3, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.enableZoom = true;
    controls.minDistance = 1.8;
    controls.maxDistance = 42;
    controls.minPolarAngle = 0.04;
    controls.maxPolarAngle = Math.PI - 0.04;
    controls.zoomSpeed = 1;
    controls.panSpeed = 1;
    controls.update();

    const resetCamera = () => {
      camera.position.set(11, 10, 13);
      controls.target.set(0, 3, 0);
      controls.update();
    };
    const onReset = () => resetCamera();
    host.addEventListener("buildlens-reset", onReset);
    host.__resetBuildLensCamera = resetCamera;

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    let active = true;
    const render = () => {
      if (!active) return;
      frame = requestAnimationFrame(render);
      controls.update();
      elements.forEach(element => {
        element.visible = isElementVisible(element.userData.category, viewRef.current);
      });
      grid.visible = showGridRef.current && viewRef.current !== "foundation";
      renderer.render(scene, camera);
    };
    // Draw synchronously on mount: the sample model must be visible before
    // the user touches or moves the viewport.
    controls.update();
    renderer.render(scene, camera);
    render();

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener("buildlens-reset", onReset);
      delete host.__resetBuildLensCamera;
      controls.dispose();
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(material => material.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="viewport-canvas" ref={hostRef} aria-label="Interactive illustrative 3D building model" />;
}