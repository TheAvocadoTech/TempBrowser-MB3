import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { LIFT_COORDINATES } from "../constants";

/**
 * 🎯 3D MODEL ALIGNMENT CALIBRATION (Applies ONLY to GLB Model)
 * The BLE nodes, live tag markers, and route path remain FIXED in real-world space.
 * Adjust these values to align the GLB model walls underneath the real nodes:
 *
 * 1. ROTATION (Degrees):
 *    - rotationX: Tilt pitch
 *    - rotationY: Yaw rotation in degrees (0, 90, 180, 270)
 *    - rotationZ: Roll
 *
 * 2. POSITION OFFSETS (Meters):
 *    - offsetX: Move 3D model left (-) or right (+)
 *    - offsetY: Move 3D model down (-) or up (+)
 *    - offsetZ: Move 3D model forward (-) or backward (+)
 *
 * 3. SCALE (Multipliers):
 *    - scaleX: Scale X width
 *    - scaleY: Scale Y height
 *    - scaleZ: Scale Z depth
 */
export const MODEL_CALIBRATION = {
  GR: {
    // 3 Rotation Axes (Degrees)
    rotationX: 0,
    rotationY: 90,
    rotationZ: 0,

    // 3 Position Offsets (Meters)
    offsetX: 110,
    offsetY: 0,
    offsetZ: 220,

    // 3 Scale Multipliers
    scaleX: 2.5,
    scaleY: 5,
    scaleZ: 5,
  },
  F1: {
    // 3 Rotation Axes (Degrees)
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,

    // 3 Position Offsets (Meters)
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,

    // 3 Scale Multipliers
    scaleX: 1.0,
    scaleY: 1.0,
    scaleZ: 1.0,
  },
};

// Helper to create animated dashed texture for 2D-style path in 3D
function createDashedTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");

  // Background blue
  ctx.fillStyle = "#0085ff";
  ctx.fillRect(0, 0, 128, 16);

  // Dashed white stripe
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(32, 4, 32, 8);
  ctx.fillRect(96, 4, 32, 8);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(12, 1);
  return texture;
}

export default function MapView3D({
  floor,
  onFloorChange,
  mapDetails,
  bleLocation,
  targetCoordinates,
  wayfindingData,
  activeRoute,
  distance,
  proximity,
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const modelGroupRef = useRef(null);
  const markersGroupRef = useRef(null);
  const dashedTextureRef = useRef(null);

  const [loadingModel, setLoadingModel] = useState(true);
  const [modelError, setModelError] = useState(null);

  // Map Dimensions from Mist API
  const mapWidth = mapDetails?.width || 6400;
  const mapHeight = mapDetails?.height || 5120;
  const ppm = mapDetails?.ppm || 50.07;

  // Real-world physical dimensions in meters from Mist API (e.g. 111.74m x 89.39m)
  const widthMeters = mapDetails?.width_m || mapWidth / ppm;
  const heightMeters = mapDetails?.height_m || mapHeight / ppm;

  const distanceInMeters = useMemo(() => {
    if (typeof distance !== "number" || isNaN(distance) || distance <= 0)
      return null;
    return (distance / ppm).toFixed(1);
  }, [distance, ppm]);

  /**
   * FIXED REAL-WORLD MIST COORDINATE MAPPER:
   * Maps 2D Mist coordinates (x, y) to fixed 3D metric positions (1 unit = 1 meter).
   * Node locations, live BLE tags, and navigation paths remain FIXED independently.
   */
  const mapTo3D = useCallback(
    (x, y, elevation = 0.5) => {
      if (x === undefined || y === undefined || x === null || y === null) {
        return new THREE.Vector3(0, elevation, 0);
      }
      // Fixed real-world Mist coordinates in meters centered at scene origin
      const posX = x / ppm - widthMeters / 2;
      const posZ = y / ppm - heightMeters / 2;
      const posY = elevation;

      return new THREE.Vector3(posX, posY, posZ);
    },
    [ppm, widthMeters, heightMeters],
  );

  // Initial Scene Setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0f172a");
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      2000,
    );
    camera.position.set(0, 100, 120);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 5;
    controls.maxDistance = 500;
    controlsRef.current = controls;

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 0.8);
    scene.add(hemiLight);

    // Groups
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    const markersGroup = new THREE.Group();
    scene.add(markersGroup);
    markersGroupRef.current = markersGroup;

    // Animated Path Texture
    const dashedTexture = createDashedTexture();
    dashedTextureRef.current = dashedTexture;

    // Grid Floor Base in Meters
    const gridHelper = new THREE.GridHelper(200, 50, "#38bdf8", "#334155");
    gridHelper.position.y = -0.5;
    scene.add(gridHelper);

    // Animation Loop
    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (dashedTextureRef.current) {
        dashedTextureRef.current.offset.x -= 0.015;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Load GLB 3D Floor Model - Calibration applies ONLY to the 3D GLB Model Group
  useEffect(() => {
    if (!modelGroupRef.current) return;

    setLoadingModel(true);
    setModelError(null);

    // Clear previous model
    while (modelGroupRef.current.children.length > 0) {
      const obj = modelGroupRef.current.children[0];
      modelGroupRef.current.remove(obj);
    }

    const modelPath = floor === "GR" ? "/models/GR.glb" : "/models/F1.glb";
    const calib = MODEL_CALIBRATION[floor] || MODEL_CALIBRATION.GR;

    console.log(
      `🧊 Loading GLB Model (${floor}) with Independent Transforms: ${modelPath}`,
    );

    const loader = new GLTFLoader();
    loader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene;

        // 1. Apply Calibration Rotation ONLY to the GLB Model
        model.rotation.set(
          THREE.MathUtils.degToRad(calib.rotationX || 0),
          THREE.MathUtils.degToRad(calib.rotationY || 0),
          THREE.MathUtils.degToRad(calib.rotationZ || 0),
        );

        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) {
              child.material.side = THREE.DoubleSide;
            }
          }
        });

        // 2. Scale GLB Model
        const rawBox = new THREE.Box3().setFromObject(model);
        const rawSize = rawBox.getSize(new THREE.Vector3());

        const calibScaleX =
          calib.scaleX && calib.scaleX > 0 ? calib.scaleX : 1.0;
        const calibScaleY =
          calib.scaleY && calib.scaleY > 0 ? calib.scaleY : 1.0;
        const calibScaleZ =
          calib.scaleZ && calib.scaleZ > 0 ? calib.scaleZ : 1.0;

        const baseScaleX = (widthMeters / (rawSize.x || 1)) * calibScaleX;
        const baseScaleY = 1.0 * calibScaleY;
        const baseScaleZ = (heightMeters / (rawSize.z || 1)) * calibScaleZ;

        model.scale.set(baseScaleX, baseScaleY, baseScaleZ);

        // 3. Position GLB Model with Calibration Offsets
        const scaledBox = new THREE.Box3().setFromObject(model);
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3());

        model.position.x = -scaledCenter.x + (calib.offsetX || 0);
        model.position.y = -scaledBox.min.y + (calib.offsetY || 0);
        model.position.z = -scaledCenter.z + (calib.offsetZ || 0);

        modelGroupRef.current.add(model);

        // Focus Camera on Scene Origin
        if (controlsRef.current && cameraRef.current) {
          const maxDim = Math.max(widthMeters, heightMeters);
          cameraRef.current.position.set(0, maxDim * 1.2, maxDim * 1.2);
          controlsRef.current.target.set(0, 0, 0);
          controlsRef.current.update();
        }

        setLoadingModel(false);
      },
      undefined,
      (error) => {
        console.warn(`3D Model load error for ${modelPath}:`, error.message);
        setModelError(`Could not load ${modelPath}.`);
        setLoadingModel(false);
      },
    );
  }, [floor, widthMeters, heightMeters]);

  // Render FIXED REAL-WORLD Markers & 2D Animated Path (Independent of Model Transforms)
  useEffect(() => {
    if (!markersGroupRef.current) return;

    const markersGroup = markersGroupRef.current;

    // Clear previous markers
    while (markersGroup.children.length > 0) {
      const obj = markersGroup.children[0];
      markersGroup.remove(obj);
    }

    // 1. LIVE BLE LOCATION MARKER (Fixed Real-World Metric Position)
    const bleX = bleLocation?.x ?? 5004.59;
    const bleY = bleLocation?.y ?? 2313.4;
    const blePos3D = mapTo3D(bleX, bleY, 1.8);

    const bleGeom = new THREE.SphereGeometry(1.5, 32, 32);
    const bleMat = new THREE.MeshStandardMaterial({
      color: 0x0085ff,
      emissive: 0x0066ff,
      emissiveIntensity: 0.8,
    });
    const bleMesh = new THREE.Mesh(bleGeom, bleMat);
    bleMesh.position.copy(blePos3D);
    markersGroup.add(bleMesh);

    // Pulsing Ring on Floor Surface
    const ringGeom = new THREE.RingGeometry(2.0, 3.8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x0085ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.copy(mapTo3D(bleX, bleY, 0.2));
    markersGroup.add(ringMesh);

    // 2. TARGET DESTINATION MARKER (Fixed Real-World Position)
    let destX, destY, destColor;
    if (floor === "GR") {
      destX = LIFT_COORDINATES.x;
      destY = LIFT_COORDINATES.y;
      destColor = 0x9333ea;
    } else {
      destX = targetCoordinates?.x ?? 5525.3;
      destY = targetCoordinates?.y ?? 2491.84;
      destColor = 0xea580c;
    }

    const destPos3D = mapTo3D(destX, destY, 2.0);
    const destGeom = new THREE.CylinderGeometry(1.0, 2.2, 4.0, 16);
    const destMat = new THREE.MeshStandardMaterial({
      color: destColor,
      emissive: destColor,
      emissiveIntensity: 0.6,
    });
    const destMesh = new THREE.Mesh(destGeom, destMat);
    destMesh.position.copy(destPos3D);
    markersGroup.add(destMesh);

    // 3. ALL 37 WAYFINDING GRAPH NODES (Fixed Real-World Position)
    const allGraphNodes =
      mapDetails?.wayfinding_path?.nodes || wayfindingData?.nodes || [];
    const nodeGeom = new THREE.SphereGeometry(0.6, 16, 16);
    const nodeMat = new THREE.MeshBasicMaterial({ color: 0x475569 });

    allGraphNodes.forEach((node) => {
      if (node.position) {
        const nodePos3D = mapTo3D(node.position.x, node.position.y, 0.5);
        const nodeMesh = new THREE.Mesh(nodeGeom, nodeMat);
        nodeMesh.position.copy(nodePos3D);
        markersGroup.add(nodeMesh);
      }
    });

    // 4. ANIMATED 2D-STYLE DASHED PATH RIBBON (Fixed Real-World Route)
    const routeNodes =
      activeRoute?.nodes || wayfindingData?.route_to_destination?.nodes || [];
    const routePoints = [blePos3D];

    if (routeNodes && routeNodes.length > 0) {
      routeNodes.forEach((node) => {
        const pos = node.position || node;
        if (pos && pos.x !== undefined && pos.y !== undefined) {
          routePoints.push(mapTo3D(pos.x, pos.y, 0.6));
        }
      });
    }
    routePoints.push(destPos3D);

    if (routePoints.length >= 2 && dashedTextureRef.current) {
      const curve = new THREE.CatmullRomCurve3(routePoints);
      const ribbonGeom = new THREE.TubeGeometry(curve, 64, 0.8, 6, false);
      const ribbonMat = new THREE.MeshBasicMaterial({
        map: dashedTextureRef.current,
        transparent: true,
        side: THREE.DoubleSide,
      });
      const ribbonMesh = new THREE.Mesh(ribbonGeom, ribbonMat);
      markersGroup.add(ribbonMesh);
    }
  }, [
    bleLocation,
    targetCoordinates,
    floor,
    mapDetails,
    wayfindingData,
    activeRoute,
    mapTo3D,
  ]);

  // Zoom Controls
  const handleZoomIn = () => {
    if (cameraRef.current) cameraRef.current.position.multiplyScalar(0.8);
  };
  const handleZoomOut = () => {
    if (cameraRef.current) cameraRef.current.position.multiplyScalar(1.2);
  };
  const handleResetZoom = () => {
    if (cameraRef.current && controlsRef.current) {
      const maxDim = Math.max(widthMeters, heightMeters);
      cameraRef.current.position.set(0, maxDim * 1.2, maxDim * 1.2);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  return (
    <div
      className="map-card-wrapper"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "#0f172a",
      }}
    >
      {/* 3D Canvas Container */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Top Left Navigation Status Badge */}
      <div
        className="nav-status-badge"
        style={{
          background: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <span className="nav-icon-dot" style={{ background: "#0085ff" }}></span>
        <div className="nav-badge-texts">
          <span className="nav-badge-title" style={{ color: "#f8fafc" }}>
            {proximity || "3D Metric Map"}
          </span>
          <span className="nav-badge-subtitle" style={{ color: "#94a3b8" }}>
            {distanceInMeters !== null
              ? `${distanceInMeters} m to Target`
              : "Updating 3D Location..."}
          </span>
        </div>
      </div>

      {/* Loading Overlay */}
      {loadingModel && (
        <div
          className="loading-overlay"
          style={{ background: "rgba(15, 23, 42, 0.75)", color: "#f8fafc" }}
        >
          <div className="spinner-icon"></div>
          <span style={{ fontSize: 13, fontWeight: 700, marginTop: 10 }}>
            Loading {floor} 3D Model...
          </span>
        </div>
      )}

      {/* Model Error Notice */}
      {modelError && (
        <div
          style={{
            position: "absolute",
            bottom: 70,
            left: 16,
            background: "rgba(239, 68, 68, 0.9)",
            color: "#fff",
            padding: "6px 14px",
            borderRadius: "12px",
            fontSize: "11px",
            fontWeight: 700,
          }}
        >
          {modelError}
        </div>
      )}

      {/* Floating Zoom Controls */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 20,
        }}
      >
        <button
          onClick={handleZoomIn}
          className="floor-btn-stack inactive"
          style={{ width: 38, height: 38, borderRadius: 12 }}
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={handleZoomOut}
          className="floor-btn-stack inactive"
          style={{ width: 38, height: 38, borderRadius: 12 }}
        >
          <ZoomOut size={16} />
        </button>
        <button
          onClick={handleResetZoom}
          className="floor-btn-stack inactive"
          style={{ width: 38, height: 38, borderRadius: 12 }}
        >
          <Maximize2 size={14} />
        </button>
      </div>

      {/* Stacked Floor Switcher (Bottom Right) */}
      <div className="floor-switcher-stack">
        <button
          onClick={() => onFloorChange("F1")}
          className={`floor-btn-stack ${floor === "F1" ? "active" : "inactive"}`}
          type="button"
          id="btn-floor-f1"
        >
          F1
        </button>
        <button
          onClick={() => onFloorChange("GR")}
          className={`floor-btn-stack ${floor === "GR" ? "active" : "inactive"}`}
          type="button"
          id="btn-floor-gr"
        >
          GR
        </button>
      </div>
    </div>
  );
}
