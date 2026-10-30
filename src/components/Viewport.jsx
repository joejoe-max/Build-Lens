import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createBuildingModel } from "../three/BuildingModel.js";
import { isElementVisible } from "../three/ModelViews.js";

const ACTION_CATEGORY = {
  foundations: "foundations", columns: "columns", beams: "beams",
  slabs: "slabs", walls: "walls", reinforcement: "reinforcement",
  grids: "grids", all: "all"
};

export default function Viewport({ view, showGrid = true, modelSpec = null, modelActions = [] }) {
  const hostRef = useRef(null);
  const sceneState = useRef(null);
  const modelSpecRef = useRef(modelSpec);
  const actionsRef = useRef(modelActions);
  const viewRef = useRef(view);
  const showGridRef = useRef(showGrid);

  useEffect(() => { modelSpecRef.current = modelSpec; }, [modelSpec]);
  useEffect(() => { actionsRef.current = modelActions; }, [modelActions]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#15181b");
    scene.fog = new THREE.Fog("#15181b", 35, 1000);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 3000);
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
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xc8d5e0, 0x282a2d, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(7, 18, 8); key.castShadow = true; scene.add(key);
    const grid = new THREE.GridHelper(100, 100, "#495159", "#30363b");
    grid.position.y = -0.02; scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.075;
    controls.enablePan = true; controls.screenSpacePanning = true;
    controls.enableZoom = true; controls.minDistance = 0.15; controls.maxDistance = 2500;
    controls.minPolarAngle = 0.04; controls.maxPolarAngle = Math.PI - 0.04;
    controls.update();

    let modelGroup = null;
    let modelElements = [];
    let connectivityBadge = null;
    const visibility = new Map();
    const applyVisibility = () => {
      const latest = new Map();
      for (const action of actionsRef.current || []) {
        if (action?.type !== "model.visibility") continue;
        const category = ACTION_CATEGORY[action.category];
        if (category) latest.set(category, action);
      }
      for (const element of modelElements) {
        const category = element.userData.category;
        const categoryAction = latest.get(category) || latest.get("all");
        let visible = isElementVisible(category, viewRef.current);
        if (categoryAction) {
          if (categoryAction.elementIds?.length) {
            if (categoryAction.elementIds.includes(element.userData.id)) visible = categoryAction.visible;
          } else visible = categoryAction.visible;
        }
        element.visible = visible;
      }
      grid.visible = showGridRef.current && viewRef.current !== "foundation";
    };

    const disposeGroup = group => {
      if (!group) return;
      group.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
      });
      scene.remove(group);
    };
    const fitCamera = group => {
      const bounds = new THREE.Box3().setFromObject(group);
      if (bounds.isEmpty()) {
        controls.target.set(0, 1.5, 0); camera.position.set(11, 10, 13); controls.update(); return;
      }
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 1);
      const distance = maxDim * 1.65;
      controls.target.copy(center);
      camera.position.set(center.x + distance * .85, center.y + distance * .65, center.z + distance * .95);
      camera.near = Math.max(.01, maxDim / 1000);
      camera.far = Math.max(3000, maxDim * 20);
      camera.updateProjectionMatrix();
      controls.minDistance = Math.max(.05, maxDim / 1000);
      controls.maxDistance = maxDim * 20;
      controls.update();
    };
    const rebuild = () => {
      if (modelGroup) disposeGroup(modelGroup);
      const created = createBuildingModel(scene, modelSpecRef.current);
      modelGroup = created.building;
      modelElements = created.elements;
      if (connectivityBadge) connectivityBadge.remove();
      connectivityBadge = null;
      if (modelSpecRef.current && created.connectivity) {
        const warnings = created.connectivity.warnings || [];
        if (warnings.length) {
          connectivityBadge = document.createElement("div");
          connectivityBadge.setAttribute("role", "status");
          connectivityBadge.style.cssText = "position:absolute;z-index:5;left:12px;bottom:12px;max-width:min(360px,calc(100% - 24px));padding:9px 11px;border:1px solid #66513a;border-radius:7px;background:rgba(28,25,22,.94);color:#e5c79e;font:11px/1.5 system-ui,sans-serif;pointer-events:none";
          connectivityBadge.textContent = warnings.length + " structural connectivity item(s) need review. Check beam endpoints and column foundations.";
          host.appendChild(connectivityBadge);
        }
      }
      if (modelSpecRef.current) fitCamera(modelGroup);
      else { controls.target.set(0, 3, 0); camera.position.set(11, 10, 13); controls.update(); }
      applyVisibility();
      renderer.render(scene, camera);
    };
    rebuild();

    const resetCamera = () => {
      if (modelGroup) fitCamera(modelGroup);
      else { camera.position.set(11, 10, 13); controls.target.set(0, 3, 0); controls.update(); }
    };
    const onReset = () => resetCamera();
    const onModelChange = () => rebuild();
    host.addEventListener("buildlens-reset", onReset);
    host.addEventListener("buildlens-model-change", onModelChange);
    host.__resetBuildLensCamera = resetCamera;

    const resize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
      camera.aspect = width / height; camera.updateProjectionMatrix();
      renderer.setSize(width, height, false); renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    let frame = 0, active = true;
    const render = () => {
      if (!active) return;
      frame = requestAnimationFrame(render);
      controls.update(); applyVisibility(); renderer.render(scene, camera);
    };
    render();

    sceneState.current = { rebuild };
    return () => {
      active = false; cancelAnimationFrame(frame); observer.disconnect();
      host.removeEventListener("buildlens-reset", onReset);
      host.removeEventListener("buildlens-model-change", onModelChange);
      delete host.__resetBuildLensCamera;
      sceneState.current = null; controls.dispose(); disposeGroup(modelGroup);
      if (connectivityBadge) connectivityBadge.remove();
      scene.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
      });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    modelSpecRef.current = modelSpec;
    actionsRef.current = modelActions;
    sceneState.current?.rebuild();
  }, [modelSpec, modelActions]);

  useEffect(() => {
    viewRef.current = view; showGridRef.current = showGrid;
    const host = hostRef.current;
    if (host) host.dispatchEvent(new CustomEvent("buildlens-model-change"));
  }, [view, showGrid]);

  return <div className="viewport-canvas" ref={hostRef} aria-label="Interactive 3D building model" />;
}
