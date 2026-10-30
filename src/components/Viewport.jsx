import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createBuildingModel } from "../three/BuildingModel.js";
import { isElementVisible } from "../three/ModelViews.js";

const ACTION_CATEGORY = {
  foundations: "foundations", columns: "columns", beams: "beams",
  slabs: "slabs", walls: "walls", stairs: "stairs", reinforcement: "reinforcement",
  grids: "grids", all: "all"
};

export default function Viewport({ view, showGrid = true, modelSpec = null, modelActions = [] }) {
  const hostRef = useRef(null);
  const sceneState = useRef(null);
  const modelSpecRef = useRef(modelSpec);
  const actionsRef = useRef(modelActions);
  const viewRef = useRef(view);
  const showGridRef = useRef(showGrid);
  const cutawayRef = useRef({ enabled: false, axis: "y", position: 0.5 });
  const hiddenIdsRef = useRef(new Set());
  const measureModeRef = useRef(false);
  const measurePointsRef = useRef([]);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurement, setMeasurement] = useState(null);
  const [cutaway, setCutaway] = useState({ enabled: false, axis: "y", position: 0.5 });
  const [selectedElement, setSelectedElement] = useState(null);
  const [hiddenIds, setHiddenIds] = useState([]);

  useEffect(() => { modelSpecRef.current = modelSpec; }, [modelSpec]);
  useEffect(() => { actionsRef.current = modelActions; }, [modelActions]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);
  useEffect(() => { cutawayRef.current = cutaway; hostRef.current?.dispatchEvent(new CustomEvent("buildlens-cutaway-change")); }, [cutaway]);
  useEffect(() => { hiddenIdsRef.current = new Set(hiddenIds); hostRef.current?.dispatchEvent(new CustomEvent("buildlens-model-change")); }, [hiddenIds]);
  useEffect(() => { measureModeRef.current = measureMode; measurePointsRef.current = []; }, [measureMode]);

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
    renderer.localClippingEnabled = true;
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
    const measurementGroup = new THREE.Group();
    measurementGroup.name = "BuildLens measurements";
    scene.add(measurementGroup);
    let connectivityBadge = null;
    const cutPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
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
        element.visible = visible && !hiddenIdsRef.current.has(element.userData.id);
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
    const updateCutaway = () => {
      const state = cutawayRef.current;
      if (!state.enabled || !modelGroup) { renderer.clippingPlanes = []; return; }
      const bounds = new THREE.Box3().setFromObject(modelGroup);
      if (bounds.isEmpty()) { renderer.clippingPlanes = []; return; }
      const axisIndex = ({ x: 0, y: 1, z: 2 })[state.axis] ?? 1;
      const min = [bounds.min.x, bounds.min.y, bounds.min.z][axisIndex];
      const max = [bounds.max.x, bounds.max.y, bounds.max.z][axisIndex];
      const coordinate = min + (max - min) * Math.max(0, Math.min(1, state.position));
      const normal = new THREE.Vector3(state.axis === "x" ? 1 : 0, state.axis === "y" ? 1 : 0, state.axis === "z" ? 1 : 0);
      cutPlane.set(normal, -coordinate); renderer.clippingPlanes = [cutPlane];
    };
    const onCutawayChange = () => { updateCutaway(); renderer.render(scene, camera); };
    const clearMeasurements = () => {
      while (measurementGroup.children.length) {
        const object = measurementGroup.children.pop();
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.filter(Boolean).forEach(material => { material.map?.dispose(); material.dispose(); });
      }
      measurePointsRef.current = [];
      setMeasurement(null);
    };
    const addMarker = point => {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: "#f2d28b", depthTest: false }));
      marker.position.copy(point); marker.renderOrder = 1001; measurementGroup.add(marker);
    };
    const addLabel = (point, text) => {
      const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 128;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "rgba(18,22,25,.96)"; ctx.strokeStyle = "#d9bd83"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(5, 5, 502, 118, 14); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f2e6ca"; ctx.font = "bold 38px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 256, 64);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
      sprite.position.copy(point); sprite.position.y += 0.16; sprite.scale.set(1.45, 0.36, 1); sprite.renderOrder = 1002; measurementGroup.add(sprite);
    };
    const onSelect = event => {
      if (event.button !== 0 || !modelElements.length) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(modelElements.filter(item => item.visible), false);
      if (measureModeRef.current) {
        if (!hits.length) return;
        const point = hits[0].point.clone(); addMarker(point); measurePointsRef.current.push(point);
        if (measurePointsRef.current.length === 2) {
          const [start, end] = measurePointsRef.current;
          const units = modelSpecRef.current?.units || "m";
          const unitScale = ({ m: 1, mm: 0.001, cm: 0.01, ft: 0.3048 })[units] || 1;
          const value = start.distanceTo(end) / unitScale;
          const label = value.toFixed(value >= 100 ? 1 : value >= 10 ? 2 : 3) + " " + units;
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), new THREE.LineBasicMaterial({ color: "#f2d28b", depthTest: false }));
          line.renderOrder = 1000; measurementGroup.add(line);
          addLabel(start.clone().add(end).multiplyScalar(0.5), label);
          setMeasurement({ value, units, label }); measurePointsRef.current = [];
        } else setMeasurement({ waitingForSecondPoint: true });
        return;
      }
      const data = hits[0]?.object?.userData;
      let dimensions = null;
      if (hits[0]?.object?.geometry) {
        const geometry = hits[0].object.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const size = geometry.boundingBox.getSize(new THREE.Vector3());
        const units = modelSpecRef.current?.units || "m";
        const unitScale = ({ m: 1, mm: 0.001, cm: 0.01, ft: 0.3048 })[units] || 1;
        dimensions = [size.x, size.y, size.z].map(value => Number((value / unitScale).toFixed(3)));
      }
      host.dispatchEvent(new CustomEvent("buildlens-select-element", { detail: data ? { id: data.id, name: data.name, category: data.category, dimensions, units: modelSpecRef.current?.units || "m" } : null }));
    };
    const onSelection = event => setSelectedElement(event.detail || null);
    const enterModel = () => {
      if (!modelGroup) return;
      const bounds = new THREE.Box3().setFromObject(modelGroup); if (bounds.isEmpty()) return;
      const center = bounds.getCenter(new THREE.Vector3()); const size = bounds.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z, 1); controls.target.copy(center);
      camera.position.set(center.x + span * 0.12, center.y + span * 0.08, center.z + span * 0.12);
      controls.minDistance = Math.max(0.05, span * 0.002); controls.update();
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
      updateCutaway();
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
    host.addEventListener("buildlens-cutaway-change", onCutawayChange);
    host.addEventListener("buildlens-select-element", onSelection);
    renderer.domElement.addEventListener("click", onSelect);
    host.__resetBuildLensCamera = resetCamera;
    host.__enterBuildLensModel = enterModel;
    host.__clearBuildLensMeasurements = clearMeasurements;

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
      controls.update(); applyVisibility(); updateCutaway(); renderer.render(scene, camera);
    };
    render();

    sceneState.current = { rebuild };
    return () => {
      active = false; cancelAnimationFrame(frame); observer.disconnect();
      host.removeEventListener("buildlens-reset", onReset);
      host.removeEventListener("buildlens-model-change", onModelChange);
      host.removeEventListener("buildlens-cutaway-change", onCutawayChange);
      host.removeEventListener("buildlens-select-element", onSelection);
      renderer.domElement.removeEventListener("click", onSelect);
      delete host.__resetBuildLensCamera;
      delete host.__enterBuildLensModel;
      delete host.__clearBuildLensMeasurements;
      sceneState.current = null; controls.dispose(); disposeGroup(modelGroup);
      clearMeasurements(); scene.remove(measurementGroup);
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

  const hideSelected = () => {
    if (!selectedElement) return;
    setHiddenIds(current => current.includes(selectedElement.id) ? current : [...current, selectedElement.id]);
    setSelectedElement(null);
  };
  return <div className="viewport-canvas" ref={hostRef} aria-label="Interactive 3D building model">
    <div className="viewport-inspection-tools" onPointerDown={event => event.stopPropagation()}>
      <div className="inspection-row">
        <button type="button" className={measureMode ? "inspection-button active" : "inspection-button"} onClick={() => setMeasureMode(current => !current)}>{measureMode ? "Measuring: pick 2 points" : "Measure"}</button>
        <button type="button" className="inspection-button" onClick={() => { hostRef.current?.__clearBuildLensMeasurements?.(); setMeasureMode(false); }}>Clear dimensions</button>
        <button type="button" className={cutaway.enabled ? "inspection-button active" : "inspection-button"} onClick={() => setCutaway(current => ({ ...current, enabled: !current.enabled }))}>{cutaway.enabled ? "Cutaway on" : "Cutaway"}</button>
        <select aria-label="Cutaway axis" value={cutaway.axis} onChange={event => setCutaway(current => ({ ...current, axis: event.target.value }))}><option value="y">Horizontal</option><option value="x">Vertical X</option><option value="z">Vertical Z</option></select>
        <button type="button" className="inspection-button" onClick={() => { setCutaway({ enabled: false, axis: "y", position: 0.5 }); setHiddenIds([]); }}>Reset</button>
        <button type="button" className="inspection-button" onClick={() => hostRef.current?.__resetBuildLensCamera?.()}>Fit</button>
        <button type="button" className="inspection-button" onClick={() => hostRef.current?.__enterBuildLensModel?.()}>Enter model</button>
      </div>
      <div className="inspection-row measurement-status"><span>{measurement?.waitingForSecondPoint ? "First point selected — choose the second point." : measurement?.label ? "Measured distance: " + measurement.label : measureMode ? "Tap two points on the model to measure." : "Measurements use the model declared units."}</span></div>
      <div className="inspection-row inspection-slider-row"><span>Section position</span><input aria-label="Cutaway section position" type="range" min="0" max="100" value={Math.round(cutaway.position * 100)} onChange={event => setCutaway(current => ({ ...current, position: Number(event.target.value) / 100 }))} disabled={!cutaway.enabled}/></div>
      <div className="inspection-row selection-row"><span>{selectedElement ? "Selected: " + selectedElement.name + " · " + selectedElement.category + (selectedElement.dimensions ? " · " + selectedElement.dimensions.join(" × ") + " " + selectedElement.units + " local extents" : "") : "Tap a structural element to inspect it"}</span><button type="button" className="inspection-button" disabled={!selectedElement} onClick={hideSelected}>Hide selected</button><button type="button" className="inspection-button" disabled={!hiddenIds.length} onClick={() => setHiddenIds([])}>Show hidden ({hiddenIds.length})</button></div>
    </div>
  </div>;
}
