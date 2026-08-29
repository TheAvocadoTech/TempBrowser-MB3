import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sliders,
  X,
  RotateCcw,
  Copy,
  Check,
  Move,
  RotateCw,
  Scale as ScaleIcon,
  Compass,
  CornerUpRight,
  CornerUpLeft,
  ArrowUp,
  CheckCircle2,
  Footprints,
  Navigation,
  Crosshair,
} from "lucide-react";

// Default calibrations per floor
const DEFAULT_CALIBRATION = {
  F1: {
    posX: 57.1,
    posY: 0.0,
    posZ: -29.0,
    rotX: 0.0,
    rotY: 0.0,
    rotZ: 0.0,
    scaleX: 1.1,
    scaleY: 1.1,
    scaleZ: 1.1,
    uniformScale: true,
  },
  GR: {
    posX: 64.9,
    posY: 0.0,
    posZ: -33.0,
    rotX: 0.0,
    rotY: 0.0,
    rotZ: 0.0,
    scaleX: 1.31,
    scaleY: 1.31,
    scaleZ: 1.31,
    uniformScale: true,
  },
};

const LOCAL_STORAGE_KEY = "3d_model_calibration_v4";

function loadSavedCalibration() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        F1: { ...DEFAULT_CALIBRATION.F1, ...parsed.F1 },
        GR: { ...DEFAULT_CALIBRATION.GR, ...parsed.GR },
      };
    }
  } catch (err) {
    console.warn("Failed to load saved 3D calibration:", err);
  }
  return DEFAULT_CALIBRATION;
}

// Extract route waypoints from any backend route shape
function extractRouteWaypoints(routeData) {
  if (!routeData) return [];
  const list =
    routeData.nodes ||
    routeData.waypoints ||
    routeData.path ||
    routeData.route_to_destination?.nodes ||
    routeData.route_to_destination?.waypoints ||
    routeData.route_to_destination?.path ||
    (Array.isArray(routeData) ? routeData : []);
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item) return null;
      const pos = item.position || item;
      if (pos && pos.x !== undefined && pos.y !== undefined) {
        return { x: Number(pos.x), y: Number(pos.y) };
      }
      return null;
    })
    .filter(Boolean);
}

// Corridor Snap-to-Path Helper
function projectPointOnSegment(p, a, b) {
  const abX = b.x - a.x;
  const abZ = b.z - a.z;
  const apX = p.x - a.x;
  const apZ = p.z - a.z;
  const abLenSq = abX * abX + abZ * abZ;
  if (abLenSq === 0) {
    return {
      point: { x: a.x, z: a.z },
      distance: Math.hypot(p.x - a.x, p.z - a.z),
      t: 0,
    };
  }
  let t = (apX * abX + apZ * abZ) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * abX;
  const projZ = a.z + t * abZ;
  const dist = Math.hypot(p.x - projX, p.z - projZ);
  return { point: { x: projX, z: projZ }, distance: dist, t };
}

function snapToCorridor(rawPoint3D, waypoints3D, maxSnapDist = 2.8) {
  if (!waypoints3D || waypoints3D.length < 2)
    return { ...rawPoint3D, isSnapped: false, segmentIndex: -1 };
  let bestSnap = null;
  let minDistance = Infinity;

  for (let i = 0; i < waypoints3D.length - 1; i++) {
    const res = projectPointOnSegment(
      rawPoint3D,
      waypoints3D[i],
      waypoints3D[i + 1]
    );
    if (res.distance < minDistance) {
      minDistance = res.distance;
      bestSnap = {
        point: res.point,
        segmentIndex: i,
        distance: res.distance,
        t: res.t,
      };
    }
  }

  if (bestSnap && bestSnap.distance <= maxSnapDist) {
    return {
      x: bestSnap.point.x,
      z: bestSnap.point.z,
      isSnapped: true,
      segmentIndex: bestSnap.segmentIndex,
      t: bestSnap.t,
    };
  }
  return {
    x: rawPoint3D.x,
    z: rawPoint3D.z,
    isSnapped: false,
    segmentIndex: -1,
  };
}

// Universal wayfinding node finder
function findWayfindingNode(nodesList, targetId) {
  if (!nodesList) return null;
  const list = Array.isArray(nodesList) ? nodesList : Object.values(nodesList);
  const targetStr = String(targetId).trim().toUpperCase();
  const numOnly = targetStr.replace(/[^0-9]/g, "");

  // 1. Exact match on name/id
  let found = list.find((n) => {
    if (!n) return false;
    const name = String(n.name || n.id || "").trim().toUpperCase();
    return (
      name === targetStr ||
      name === `N${numOnly}` ||
      name === numOnly ||
      name === `NODE ${numOnly}` ||
      name === `NODE_${numOnly}` ||
      name === `NODE${numOnly}`
    );
  });
  if (found) return found;

  // 2. Substring/Regex match
  if (numOnly) {
    const regex = new RegExp(`(^|[^0-9])0*${numOnly}([^0-9]|$)`, "i");
    found = list.find((n) => {
      const name = String(n?.name || n?.id || "");
      return regex.test(name);
    });
    if (found) return found;

    // 3. Fallback to 1-based index (node 12 is index 11, node 17 is index 16)
    const idx = parseInt(numOnly, 10) - 1;
    if (idx >= 0 && idx < list.length) {
      return list[idx];
    }
  }

  return null;
}

// Client-side Dijkstra pathfinder on wayfinding graph
function calculateDijkstraPath(nodesList, edgesMap, startPos, endPos) {
  if (!nodesList || nodesList.length === 0 || !startPos || !endPos) return [];
  const list = Array.isArray(nodesList) ? nodesList : Object.values(nodesList);

  let startNode = null;
  let minStartDist = Infinity;
  let endNode = null;
  let minEndDist = Infinity;

  list.forEach((n) => {
    const pos = n.position || n;
    if (pos && pos.x !== undefined && pos.y !== undefined) {
      const dStart = Math.hypot(pos.x - startPos.x, pos.y - startPos.y);
      if (dStart < minStartDist) {
        minStartDist = dStart;
        startNode = n;
      }
      const dEnd = Math.hypot(pos.x - endPos.x, pos.y - endPos.y);
      if (dEnd < minEndDist) {
        minEndDist = dEnd;
        endNode = n;
      }
    }
  });

  if (!startNode || !endNode) return [];

  const distances = {};
  const previous = {};
  const unvisited = new Set();

  list.forEach((n) => {
    const name = String(n.name || n.id);
    distances[name] = Infinity;
    unvisited.add(name);
  });

  const startName = String(startNode.name || startNode.id);
  const endName = String(endNode.name || endNode.id);
  distances[startName] = 0;

  while (unvisited.size > 0) {
    let current = null;
    let shortestDist = Infinity;
    unvisited.forEach((nodeName) => {
      if (distances[nodeName] < shortestDist) {
        shortestDist = distances[nodeName];
        current = nodeName;
      }
    });

    if (current === null || current === endName || shortestDist === Infinity) {
      break;
    }

    unvisited.delete(current);

    const neighbors = edgesMap[current] || {};
    const neighborKeys = Array.isArray(neighbors)
      ? neighbors
      : Object.keys(neighbors);

    neighborKeys.forEach((neighborKey) => {
      const neighborName =
        typeof neighborKey === "string" ? neighborKey : neighborKey?.name;
      if (neighborName && unvisited.has(neighborName)) {
        const neighborNode = list.find(
          (n) => String(n.name || n.id) === neighborName,
        );
        const currentNode = list.find(
          (n) => String(n.name || n.id) === current,
        );
        let weight = 1;
        if (currentNode && neighborNode) {
          const p1 = currentNode.position || currentNode;
          const p2 = neighborNode.position || neighborNode;
          weight = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        }
        const alt = distances[current] + weight;
        if (alt < distances[neighborName]) {
          distances[neighborName] = alt;
          previous[neighborName] = current;
        }
      }
    });
  }

  const pathNodes = [];
  let curr = endName;
  while (curr) {
    const nodeObj = list.find((n) => String(n.name || n.id) === curr);
    if (nodeObj) {
      const p = nodeObj.position || nodeObj;
      pathNodes.unshift({ x: Number(p.x), y: Number(p.y), name: curr });
    }
    curr = previous[curr];
  }

  if (
    pathNodes.length === 0 ||
    (pathNodes[0].name !== startName && list.length > 1)
  ) {
    return [
      {
        x: startNode.position?.x || startNode.x,
        y: startNode.position?.y || startNode.y,
      },
      {
        x: endNode.position?.x || endNode.x,
        y: endNode.position?.y || endNode.y,
      },
      { x: endPos.x, y: endPos.y },
    ];
  }

  return [...pathNodes, { x: endPos.x, y: endPos.y }];
}

export default function MapView3D({
  floor = "GR",
  tagFloor = "GR",
  onFloorChange,
  mapDetails,
  bleLocation,
  targetCoordinates: targetPos,
  wayfindingData,
  floorMapData = {},
  activeRoute,
  distance,
  proximity,
  assets = [],
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const modelGroupRef = useRef(null);
  const markersGroupRef = useRef(null);
  const liveArrowGroupRef = useRef(null);
  const animFrameIdRef = useRef(null);

  // Smooth LERP Position & Heading references
  const renderPosRef = useRef({ x: 0, z: 0, initialized: false });
  const targetPosRef = useRef({ x: 0, z: 0 });
  const renderHeadingRef = useRef(0);
  const targetHeadingRef = useRef(0);
  const compassHeadingRef = useRef(null);

  const [loadingModel, setLoadingModel] = useState(true);
  const [modelError, setModelError] = useState(null);
  const [showCalibPanel, setShowCalibPanel] = useState(false);
  const [activeTab, setActiveTab] = useState("position"); // 'position' | 'rotation' | 'scale'
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [compassActive, setCompassActive] = useState(false);
  const [turnInstruction, setTurnInstruction] = useState(null);
  const [followMode, setFollowMode] = useState(true);
  const followModeRef = useRef(true);
  useEffect(() => {
    followModeRef.current = followMode;
  }, [followMode]);

  // Calibration state per floor
  const [calibration, setCalibration] = useState(loadSavedCalibration);
  const currentCalib = calibration[floor] || DEFAULT_CALIBRATION[floor];

  const widthMeters = mapDetails?.width_m || 127.81;
  const heightMeters = mapDetails?.height_m || 102.25;
  const ppm = mapDetails?.ppm || 50.07391564392213;

  const isLiveFloor = floor === tagFloor;

  // Coordinate mapper from 2D pixel space to 3D world space centered at (0, 0, 0)
  const mapTo3D = useCallback(
    (pixelX, pixelY, heightY = 0.0) => {
      const xMeters = Number(pixelX) / ppm;
      const yMeters = Number(pixelY) / ppm;
      const x3D = xMeters - widthMeters / 2;
      const z3D = yMeters - heightMeters / 2;
      return new THREE.Vector3(x3D, heightY, z3D);
    },
    [ppm, widthMeters, heightMeters],
  );

  const activeFloorWf = floorMapData?.[floor]?.wayfindingData || wayfindingData;
  const activeFloorNodes =
    activeFloorWf?.nodes ||
    activeFloorWf?.wayfinding_path?.nodes ||
    activeFloorWf?.data?.nodes ||
    [];
  let activeFloorEdges =
    activeFloorWf?.edges ||
    activeFloorWf?.wayfinding_path?.edges ||
    activeFloorWf?.data?.edges ||
    {};

  if (
    Object.keys(activeFloorEdges).length === 0 &&
    activeFloorNodes.length > 0
  ) {
    const extracted = {};
    activeFloorNodes.forEach((n) => {
      if (n.edges) extracted[n.name || n.id] = n.edges;
    });
    activeFloorEdges = extracted;
  }

  // Resolve lift coordinates for GR (midpoint of N12 & N7)
  const grLiftPos = useMemo(() => {
    const grWf = floorMapData?.GR?.wayfindingData || (floor === "GR" ? wayfindingData : null);
    const grNodes =
      grWf?.nodes ||
      grWf?.wayfinding_path?.nodes ||
      grWf?.data?.nodes ||
      [];
    const n12 = findWayfindingNode(grNodes, "12");
    const n7 = findWayfindingNode(grNodes, "7");

    if (n12 && n7) {
      const p1 = n12.position || n12;
      const p2 = n7.position || n7;
      if (p1.x !== undefined && p2.x !== undefined) {
        return {
          x: (Number(p1.x) + Number(p2.x)) / 2,
          y: (Number(p1.y) + Number(p2.y)) / 2,
        };
      }
    }
    return { x: 5004.59, y: 2313.4 };
  }, [floorMapData, floor, wayfindingData]);

  // Resolve lift coordinates for F1 (midpoint of N48 & N45)
  const f1LiftPos = useMemo(() => {
    const f1Wf = floorMapData?.F1?.wayfindingData || (floor === "F1" ? wayfindingData : null);
    const f1Nodes =
      f1Wf?.nodes ||
      f1Wf?.wayfinding_path?.nodes ||
      f1Wf?.data?.nodes ||
      [];
    const n48 = findWayfindingNode(f1Nodes, "48");
    const n45 = findWayfindingNode(f1Nodes, "45");

    if (n48 && n45) {
      const p1 = n48.position || n48;
      const p2 = n45.position || n45;
      if (p1.x !== undefined && p2.x !== undefined) {
        return {
          x: (Number(p1.x) + Number(p2.x)) / 2,
          y: (Number(p1.y) + Number(p2.y)) / 2,
        };
      }
    }
    return { x: 5004.59, y: 2313.4 };
  }, [floorMapData, floor, wayfindingData]);

  const liftPos = floor === "F1" ? f1LiftPos : grLiftPos;

  const resolvedTargetPos = useMemo(() => {
    if (floor === "GR") {
      return grLiftPos;
    }

    if (targetPos && targetPos.x !== undefined && targetPos.y !== undefined) {
      return targetPos;
    }
    return { x: 5525.298750495607, y: 2491.837930104785 };
  }, [floor, grLiftPos, targetPos]);

  // Save calibration changes to localStorage
  const updateCalibrationField = useCallback(
    (field, rawVal) => {
      const val = parseFloat(rawVal);
      if (isNaN(val)) return;

      setCalibration((prev) => {
        const floorCalib = { ...prev[floor] };

        if (field === "scaleX" && floorCalib.uniformScale) {
          floorCalib.scaleX = val;
          floorCalib.scaleY = val;
          floorCalib.scaleZ = val;
        } else {
          floorCalib[field] = val;
        }

        const nextState = { ...prev, [floor]: floorCalib };
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextState));
        } catch (e) {
          console.warn("Could not save calibration to localStorage:", e);
        }
        return nextState;
      });
    },
    [floor]
  );

  const adjustStep = useCallback(
    (field, step) => {
      const cur = currentCalib[field] || 0;
      const nextVal = Math.round((cur + step) * 1000) / 1000;
      updateCalibrationField(field, nextVal);
    },
    [currentCalib, updateCalibrationField]
  );

  const resetCurrentFloorCalib = () => {
    setCalibration((prev) => {
      const nextState = {
        ...prev,
        [floor]: { ...DEFAULT_CALIBRATION[floor] },
      };
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextState));
      } catch (e) {}
      return nextState;
    });
  };

  const handleCopyConfig = () => {
    const jsonStr = JSON.stringify(calibration, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopiedConfig(true);
      setTimeout(() => setCopiedConfig(false), 2000);
    });
  };

  // Mobile Device Orientation Listener
  useEffect(() => {
    const handleOrientation = (e) => {
      let heading = null;
      if (e.webkitCompassHeading !== undefined) {
        heading = e.webkitCompassHeading;
      } else if (e.alpha !== null) {
        heading = (360 - e.alpha) % 360;
      }

      if (heading !== null) {
        compassHeadingRef.current = (heading * Math.PI) / 180;
        if (!compassActive) setCompassActive(true);
      }
    };

    if (typeof window !== "undefined" && window.DeviceOrientationEvent) {
      window.addEventListener("deviceorientation", handleOrientation, true);
    }

    return () => {
      if (typeof window !== "undefined" && window.DeviceOrientationEvent) {
        window.removeEventListener("deviceorientation", handleOrientation);
      }
    };
  }, [compassActive]);

  // Request Compass Permission for iOS
  const requestCompassPermission = async () => {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        if (response === "granted") {
          setCompassActive(true);
        }
      } catch (err) {
        console.warn("Compass permission error:", err);
      }
    }
  };

  // Initialize Three.js Scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    camera.position.set(
      0,
      Math.max(widthMeters, heightMeters) * 1.2,
      Math.max(widthMeters, heightMeters) * 1.2
    );
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.addEventListener("start", () => {
      setFollowMode(false);
    });
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xe2e8f0, 1.2);
    scene.add(hemiLight);

    // Groups
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    const markersGroup = new THREE.Group();
    scene.add(markersGroup);
    markersGroupRef.current = markersGroup;

    // Render loop with 60 FPS LERP smoothing & Google Maps follow camera
    const animate = (time) => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      controls.update();

      // 60 FPS LERP position update
      if (liveArrowGroupRef.current) {
        const LERP_FACTOR = 0.1;
        if (!renderPosRef.current.initialized) {
          renderPosRef.current.x = targetPosRef.current.x;
          renderPosRef.current.z = targetPosRef.current.z;
          renderPosRef.current.initialized = true;
        } else {
          renderPosRef.current.x +=
            (targetPosRef.current.x - renderPosRef.current.x) * LERP_FACTOR;
          renderPosRef.current.z +=
            (targetPosRef.current.z - renderPosRef.current.z) * LERP_FACTOR;
        }

        // Angular LERP for smooth heading
        let activeTargetHeading = targetHeadingRef.current;
        if (compassHeadingRef.current !== null && compassActive) {
          activeTargetHeading = compassHeadingRef.current;
        }

        let angleDiff = activeTargetHeading - renderHeadingRef.current;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        renderHeadingRef.current += angleDiff * 0.12;

        liveArrowGroupRef.current.position.set(
          renderPosRef.current.x,
          0.0,
          renderPosRef.current.z
        );
        liveArrowGroupRef.current.rotation.y = renderHeadingRef.current;

        // 🎥 Google Maps 3D Follow / Chase Camera Navigation Mode
        if (followModeRef.current && renderPosRef.current.initialized) {
          const userX = renderPosRef.current.x;
          const userZ = renderPosRef.current.z;
          const heading = renderHeadingRef.current;

          // Close chase camera behind user:
          // 12m behind, 8.5m height, looking 4m ahead along the corridor
          const FOLLOW_DISTANCE = 12.0;
          const FOLLOW_HEIGHT = 8.5;
          const LOOK_AHEAD = 4.0;

          const targetCamX = userX - Math.sin(heading) * FOLLOW_DISTANCE;
          const targetCamY = FOLLOW_HEIGHT;
          const targetCamZ = userZ - Math.cos(heading) * FOLLOW_DISTANCE;

          const targetLookX = userX + Math.sin(heading) * LOOK_AHEAD;
          const targetLookY = 0.8;
          const targetLookZ = userZ + Math.cos(heading) * LOOK_AHEAD;

          const CAM_LERP = 0.08;
          camera.position.x += (targetCamX - camera.position.x) * CAM_LERP;
          camera.position.y += (targetCamY - camera.position.y) * CAM_LERP;
          camera.position.z += (targetCamZ - camera.position.z) * CAM_LERP;

          controls.target.x += (targetLookX - controls.target.x) * CAM_LERP;
          controls.target.y += (targetLookY - controls.target.y) * CAM_LERP;
          controls.target.z += (targetLookZ - controls.target.z) * CAM_LERP;
        }
      }

      // Dynamic animations for target pin float and live arrow beam pulse
      if (markersGroupRef.current) {
        markersGroupRef.current.traverse((child) => {
          if (child.userData?.isTargetPin) {
            child.position.y =
              (child.userData.baseY || 0) + Math.sin(time * 0.003) * 0.35;
          }
          if (child.userData?.isLivePulse) {
            const s = 1.0 + Math.sin(time * 0.004) * 0.12;
            child.scale.set(s, 1, s);
          }
          if (child.userData?.isLiveBeam) {
            child.material.opacity = 0.22 + Math.sin(time * 0.003) * 0.12;
          }
        });
      }

      renderer.render(scene, camera);
    };
    animate(performance.now());

    // Window resize handler
    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      if (rendererRef.current && rendererRef.current.domElement) {
        rendererRef.current.dispose();
      }
    };
  }, [widthMeters, heightMeters, compassActive]);

  // Load GLB 3D Model whenever active floor changes
  useEffect(() => {
    if (!modelGroupRef.current) return;
    const modelGroup = modelGroupRef.current;

    // Clear existing model children
    while (modelGroup.children.length > 0) {
      modelGroup.remove(modelGroup.children[0]);
    }

    setLoadingModel(true);
    setModelError(null);

    const modelPath = `/models/${floor}.glb`;
    const loader = new GLTFLoader();

    loader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene;
        model.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });

        modelGroup.add(model);

        // Apply current floor calibration
        const cal = calibration[floor] || DEFAULT_CALIBRATION[floor];
        modelGroup.position.set(cal.posX, cal.posY, cal.posZ);
        modelGroup.rotation.set(
          (cal.rotX * Math.PI) / 180,
          (cal.rotY * Math.PI) / 180,
          (cal.rotZ * Math.PI) / 180
        );
        modelGroup.scale.set(cal.scaleX, cal.scaleY, cal.scaleZ);

        setLoadingModel(false);
      },
      undefined,
      (err) => {
        console.warn(`Error loading model ${modelPath}:`, err?.message || err);
        setModelError(`Could not load model file: ${modelPath}`);
        setLoadingModel(false);

        // Render fallback grid plane on error so floor is still visible
        const planeGeom = new THREE.PlaneGeometry(widthMeters, heightMeters);
        const planeMat = new THREE.MeshStandardMaterial({
          color: 0xf1f5f9,
          roughness: 0.8,
          side: THREE.DoubleSide,
        });
        const fallbackPlane = new THREE.Mesh(planeGeom, planeMat);
        fallbackPlane.rotation.x = Math.PI / 2;
        modelGroup.add(fallbackPlane);
      }
    );
  }, [floor, widthMeters, heightMeters, calibration]);

  // Update Model Transformation when Calibration state updates
  useEffect(() => {
    if (!modelGroupRef.current) return;
    const modelGroup = modelGroupRef.current;
    const cal = currentCalib;

    modelGroup.position.set(cal.posX, cal.posY, cal.posZ);
    modelGroup.rotation.set(
      (cal.rotX * Math.PI) / 180,
      (cal.rotY * Math.PI) / 180,
      (cal.rotZ * Math.PI) / 180
    );
    modelGroup.scale.set(cal.scaleX, cal.scaleY, cal.scaleZ);
  }, [currentCalib]);

  // Render Real-World 3D Markers, Snap-to-Path & Dynamic Forward Route
  useEffect(() => {
    if (!markersGroupRef.current) return;
    const markersGroup = markersGroupRef.current;

    while (markersGroup.children.length > 0) {
      markersGroup.remove(markersGroup.children[0]);
    }

    // 1. Resolve raw BLE coordinates or Lift start coordinates
    let bleX = bleLocation?.x;
    let bleY = bleLocation?.y;

    if (!isLiveFloor && floor === "F1") {
      bleX = liftPos.x;
      bleY = liftPos.y;
    } else {
      if (bleLocation?.x_m != null && (bleX == null || bleX < 300)) {
        bleX = bleLocation.x_m * ppm;
      }
      if (bleLocation?.y_m != null && (bleY == null || bleY < 300)) {
        bleY = bleLocation.y_m * ppm;
      }

      if (bleX == null || isNaN(bleX)) bleX = liftPos.x;
      if (bleY == null || isNaN(bleY)) bleY = liftPos.y;
    }

    const rawBlePosGround = mapTo3D(bleX, bleY, 0.0);

    // 2. Extract or dynamically compute route waypoints
    let rawRouteWaypoints = [];
    if (floor === "GR" && resolvedTargetPos) {
      rawRouteWaypoints = calculateDijkstraPath(
        activeFloorNodes,
        activeFloorEdges,
        { x: bleX, y: bleY },
        resolvedTargetPos,
      );
    } else if (floor === "F1" && !isLiveFloor) {
      // Previewing F1 from GR: Route from F1 Lift -> Cabinet
      rawRouteWaypoints = calculateDijkstraPath(
        activeFloorNodes,
        activeFloorEdges,
        liftPos,
        resolvedTargetPos,
      );
    } else {
      rawRouteWaypoints = extractRouteWaypoints(
        activeRoute || activeFloorWf?.route_to_destination,
      );
      if (rawRouteWaypoints.length === 0 && resolvedTargetPos) {
        rawRouteWaypoints = calculateDijkstraPath(
          activeFloorNodes,
          activeFloorEdges,
          { x: bleX, y: bleY },
          resolvedTargetPos,
        );
      }
    }

    // 2. Convert waypoints to 3D positions for corridor matching
    const waypoints3D = rawRouteWaypoints.map((pt) => mapTo3D(pt.x, pt.y, 0.0));

    // 3. Snap to corridor centerline if near active route on live floor
    let activeBlePos3D = rawBlePosGround;
    let forwardWaypoints3D = waypoints3D;

    if (isLiveFloor) {
      const snapResult = snapToCorridor(rawBlePosGround, waypoints3D, 2.8);
      activeBlePos3D = {
        x: snapResult.x,
        z: snapResult.z,
      };

      // Update target LERP reference
      targetPosRef.current.x = activeBlePos3D.x;
      targetPosRef.current.z = activeBlePos3D.z;

      // Dynamic Forward Path Trimming for live navigation
      if (snapResult.isSnapped && snapResult.segmentIndex >= 0) {
        forwardWaypoints3D = waypoints3D.slice(snapResult.segmentIndex + 1);
      } else if (waypoints3D.length > 0) {
        let closestIdx = 0;
        let minDist = Infinity;
        waypoints3D.forEach((wpt, idx) => {
          const d = Math.hypot(wpt.x - activeBlePos3D.x, wpt.z - activeBlePos3D.z);
          if (d < minDist) {
            minDist = d;
            closestIdx = idx;
          }
        });
        forwardWaypoints3D = waypoints3D.slice(closestIdx);
      }
    } else {
      // For preview mode, show full path
      forwardWaypoints3D = waypoints3D;
    }

    // 5. Determine target orientation for live arrow
    let nextTargetPt3D = null;
    if (forwardWaypoints3D.length > 0) {
      const foundPt = forwardWaypoints3D.find((pt) => {
        const dist = Math.hypot(pt.x - activeBlePos3D.x, pt.z - activeBlePos3D.z);
        return dist > 1.0;
      });
      nextTargetPt3D = foundPt || forwardWaypoints3D[0];
    } else if (
      resolvedTargetPos &&
      resolvedTargetPos.x !== undefined &&
      resolvedTargetPos.y !== undefined
    ) {
      nextTargetPt3D = mapTo3D(resolvedTargetPos.x, resolvedTargetPos.y, 0.0);
    }

    if (nextTargetPt3D) {
      const dx = nextTargetPt3D.x - activeBlePos3D.x;
      const dz = nextTargetPt3D.z - activeBlePos3D.z;
      targetHeadingRef.current = Math.atan2(dx, dz);
    }

    // Calculate Turn-by-Turn Instruction
    const hasValidTarget =
      resolvedTargetPos &&
      resolvedTargetPos.x !== undefined &&
      resolvedTargetPos.y !== undefined;

    // Precise physical distance from position to destination in meters
    const distToTargetMeters = hasValidTarget
      ? Math.hypot(
          (resolvedTargetPos.x - bleX) / ppm,
          (resolvedTargetPos.y - bleY) / ppm
        )
      : (distance ? Number(distance) : null);

    if (!isLiveFloor) {
      // Preview Mode instructions
      setTurnInstruction({
        type: "straight",
        text: floor === "F1" ? "F1 Route: Lift to Cabinet" : "Route Preview",
        subtext: distToTargetMeters
          ? `${distToTargetMeters.toFixed(1)}m total • Take lift to ${floor}`
          : `Take lift to ${floor} to begin navigation`,
      });
    } else if (!hasValidTarget && forwardWaypoints3D.length === 0) {
      setTurnInstruction({
        type: "searching",
        text: "Live Tracking Active",
        subtext: "No destination selected",
      });
    } else if (
      hasValidTarget &&
      distToTargetMeters !== null &&
      distToTargetMeters <= 1.8
    ) {
      // ONLY trigger arrived when live location reaches within 1.8m of target
      setTurnInstruction({
        type: "arrived",
        text: "You Have Arrived",
        subtext: "Destination reached (within 1.8m)",
      });
    } else if (forwardWaypoints3D.length >= 2) {
      const p0 = activeBlePos3D;
      const p1 = forwardWaypoints3D[0];
      const p2 = forwardWaypoints3D[1];

      const v1x = p1.x - p0.x;
      const v1z = p1.z - p0.z;
      const v2x = p2.x - p1.x;
      const v2z = p2.z - p1.z;

      // Unambiguous relative turn angle calculation using cross and dot products
      const cross = v1x * v2z - v1z * v2x;
      const dot = v1x * v2x + v1z * v2z;
      const turnAngle = (Math.atan2(cross, dot) * 180) / Math.PI;

      const distToTurn = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const roundedDist = Math.max(1, Math.round(distToTurn));

      if (distToTurn <= 1.5 && Math.abs(turnAngle) > 25) {
        if (turnAngle > 25) {
          setTurnInstruction({
            type: "turn-right",
            text: "Turn Right Now",
            subtext: "Follow corridor towards destination",
          });
        } else {
          setTurnInstruction({
            type: "turn-left",
            text: "Turn Left Now",
            subtext: "Follow corridor towards destination",
          });
        }
      } else if (turnAngle > 25) {
        setTurnInstruction({
          type: "turn-right",
          text: `In ${roundedDist}m, Turn Right`,
          subtext: "Follow corridor toward destination",
        });
      } else if (turnAngle < -25) {
        setTurnInstruction({
          type: "turn-left",
          text: `In ${roundedDist}m, Turn Left`,
          subtext: "Follow corridor toward destination",
        });
      } else {
        setTurnInstruction({
          type: "straight",
          text: `Continue Straight for ${roundedDist}m`,
          subtext: "Along corridor path",
        });
      }
    } else if (hasValidTarget) {
      setTurnInstruction({
        type: "straight",
        text: distToTargetMeters
          ? `${distToTargetMeters.toFixed(1)}m to Destination`
          : "Navigating to Target",
        subtext: proximity || "Approach destination",
      });
    }

    // 6. Create 3D Live Arrow Group (Only on Live Floor)
    if (isLiveFloor) {
      const liveArrowGroup = new THREE.Group();
      liveArrowGroup.position.set(activeBlePos3D.x, 0.0, activeBlePos3D.z);
      liveArrowGroup.rotation.y = targetHeadingRef.current;
      liveArrowGroupRef.current = liveArrowGroup;

      // 6a. Google Maps 3D Chevron Arrow (Main Blue Body)
      const arrowShape = new THREE.Shape();
      arrowShape.moveTo(0, 1.2);
      arrowShape.lineTo(-0.6, -0.5);
      arrowShape.lineTo(-0.25, -0.2);
      arrowShape.lineTo(0, -0.5);
      arrowShape.lineTo(0.25, -0.2);
      arrowShape.lineTo(0.6, -0.5);
      arrowShape.closePath();

      const arrowExtrudeSettings = {
        depth: 0.25,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 3,
      };
      const arrowGeom = new THREE.ExtrudeGeometry(
        arrowShape,
        arrowExtrudeSettings
      );
      arrowGeom.rotateX(Math.PI / 2);

      const arrowMat = new THREE.MeshStandardMaterial({
        color: 0x0085ff,
        emissive: 0x0066ff,
        emissiveIntensity: 0.85,
        roughness: 0.2,
        metalness: 0.3,
      });
      const arrowMesh = new THREE.Mesh(arrowGeom, arrowMat);
      arrowMesh.position.y = 0.35;
      liveArrowGroup.add(arrowMesh);

      // 6b. Inner White Chevron Accent
      const innerShape = new THREE.Shape();
      innerShape.moveTo(0, 1.0);
      innerShape.lineTo(-0.4, -0.3);
      innerShape.lineTo(-0.15, -0.1);
      innerShape.lineTo(0, -0.3);
      innerShape.lineTo(0.15, -0.1);
      innerShape.lineTo(0.4, -0.3);
      innerShape.closePath();
      const innerGeom = new THREE.ExtrudeGeometry(innerShape, {
        depth: 0.27,
        bevelEnabled: false,
      });
      innerGeom.rotateX(Math.PI / 2);
      const innerMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.8,
      });
      const innerMesh = new THREE.Mesh(innerGeom, innerMat);
      innerMesh.position.y = 0.35;
      liveArrowGroup.add(innerMesh);

      // 6c. Vision Field Cone
      const beamShape = new THREE.Shape();
      beamShape.moveTo(0, 0.2);
      beamShape.lineTo(-1.2, 3.2);
      beamShape.lineTo(1.2, 3.2);
      beamShape.closePath();
      const beamGeom = new THREE.ShapeGeometry(beamShape);
      beamGeom.rotateX(Math.PI / 2);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      });
      const beamMesh = new THREE.Mesh(beamGeom, beamMat);
      beamMesh.position.y = 0.06;
      beamMesh.userData = { isLiveBeam: true };
      liveArrowGroup.add(beamMesh);

      // 6d. Ground Disc & Pulsing Halo
      const discGeom = new THREE.CircleGeometry(0.8, 32);
      const discMat = new THREE.MeshBasicMaterial({
        color: 0x0085ff,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      });
      const discMesh = new THREE.Mesh(discGeom, discMat);
      discMesh.rotation.x = -Math.PI / 2;
      discMesh.position.y = 0.04;
      liveArrowGroup.add(discMesh);

      const pulseRingGeom = new THREE.RingGeometry(0.9, 1.6, 32);
      const pulseRingMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      });
      const pulseRingMesh = new THREE.Mesh(pulseRingGeom, pulseRingMat);
      pulseRingMesh.rotation.x = -Math.PI / 2;
      pulseRingMesh.position.y = 0.05;
      pulseRingMesh.userData = { isLivePulse: true };
      liveArrowGroup.add(pulseRingMesh);

      // 6e. Vertical subtle beacon sphere
      const topSphereGeom = new THREE.SphereGeometry(0.35, 32, 32);
      const topSphereMat = new THREE.MeshStandardMaterial({
        color: 0x0085ff,
        emissive: 0x0085ff,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.85,
      });
      const topSphereMesh = new THREE.Mesh(topSphereGeom, topSphereMat);
      topSphereMesh.position.y = 2.2;
      liveArrowGroup.add(topSphereMesh);

      const lineGeom = new THREE.CylinderGeometry(0.04, 0.04, 1.8, 12);
      const lineMat = new THREE.MeshStandardMaterial({
        color: 0x0085ff,
        emissive: 0x0085ff,
        emissiveIntensity: 1.0,
        transparent: true,
        opacity: 0.6,
      });
      const lineMesh = new THREE.Mesh(lineGeom, lineMat);
      lineMesh.position.y = 1.3;
      liveArrowGroup.add(lineMesh);

      markersGroup.add(liveArrowGroup);
    } else if (floor === "F1") {
      // 6f. Lift Start Indicator on F1 when previewing from GR
      const lift3DPos = mapTo3D(liftPos.x, liftPos.y, 0.0);
      const liftGroup = new THREE.Group();
      liftGroup.position.copy(lift3DPos);

      const liftBaseGeom = new THREE.CylinderGeometry(0.8, 0.8, 0.15, 32);
      const liftBaseMat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        emissive: 0x0284c7,
        emissiveIntensity: 0.6,
        roughness: 0.3,
      });
      const liftBaseMesh = new THREE.Mesh(liftBaseGeom, liftBaseMat);
      liftBaseMesh.position.y = 0.08;
      liftGroup.add(liftBaseMesh);

      const liftPillarGeom = new THREE.CylinderGeometry(0.08, 0.08, 1.8, 16);
      const liftPillarMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.8,
      });
      const liftPillarMesh = new THREE.Mesh(liftPillarGeom, liftPillarMat);
      liftPillarMesh.position.y = 1.0;
      liftGroup.add(liftPillarMesh);

      const liftTopGeom = new THREE.SphereGeometry(0.4, 24, 24);
      const liftTopMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x38bdf8,
        emissiveIntensity: 1.0,
      });
      const liftTopMesh = new THREE.Mesh(liftTopGeom, liftTopMat);
      liftTopMesh.position.y = 2.0;
      liftGroup.add(liftTopMesh);

      markersGroup.add(liftGroup);
    }

    // 7. Destination Marker Pin
    if (hasValidTarget) {
      const target3DPos = mapTo3D(resolvedTargetPos.x, resolvedTargetPos.y, 0.0);
      const targetGroup = new THREE.Group();
      targetGroup.position.copy(target3DPos);
      targetGroup.userData = { isTargetPin: true, baseY: 0.0 };

      // Pin Head (Red Sphere)
      const pinHeadGeom = new THREE.SphereGeometry(0.6, 32, 32);
      const pinHeadMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 0.85,
        roughness: 0.2,
        metalness: 0.3,
      });
      const pinHeadMesh = new THREE.Mesh(pinHeadGeom, pinHeadMat);
      pinHeadMesh.position.y = 2.2;
      targetGroup.add(pinHeadMesh);

      // White Inner Dot
      const whiteDotGeom = new THREE.SphereGeometry(0.25, 24, 24);
      const whiteDotMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.9,
      });
      const whiteDotMesh = new THREE.Mesh(whiteDotGeom, whiteDotMat);
      whiteDotMesh.position.set(0, 2.2, 0);
      targetGroup.add(whiteDotMesh);

      // Red Pin Cone pointing down
      const pinConeGeom = new THREE.ConeGeometry(0.6, 1.4, 32);
      pinConeGeom.rotateX(Math.PI);
      const pinConeMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 0.85,
        roughness: 0.2,
        metalness: 0.3,
      });
      const pinConeMesh = new THREE.Mesh(pinConeGeom, pinConeMat);
      pinConeMesh.position.y = 1.2;
      targetGroup.add(pinConeMesh);

      // Ground Pulsing Red Ring
      const targetDiscGeom = new THREE.CircleGeometry(0.8, 32);
      const targetDiscMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      });
      const targetDiscMesh = new THREE.Mesh(targetDiscGeom, targetDiscMat);
      targetDiscMesh.rotation.x = -Math.PI / 2;
      targetDiscMesh.position.y = 0.04;
      targetGroup.add(targetDiscMesh);

      const targetRingGeom = new THREE.RingGeometry(0.9, 1.8, 32);
      const targetRingMat = new THREE.MeshBasicMaterial({
        color: 0xf87171,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      });
      const targetRingMesh = new THREE.Mesh(targetRingGeom, targetRingMat);
      targetRingMesh.rotation.x = -Math.PI / 2;
      targetRingMesh.position.y = 0.05;
      targetGroup.add(targetRingMesh);

      markersGroup.add(targetGroup);
    }

    // 8. Draw Forward Navigation Spline Tube
    const forwardRoutePoints = [
      new THREE.Vector3(activeBlePos3D.x, 0.5, activeBlePos3D.z),
    ];
    forwardWaypoints3D.forEach((wpt) => {
      forwardRoutePoints.push(new THREE.Vector3(wpt.x, 0.5, wpt.z));
    });

    if (hasValidTarget) {
      forwardRoutePoints.push(
        mapTo3D(resolvedTargetPos.x, resolvedTargetPos.y, 0.5)
      );
    }

    if (forwardRoutePoints.length >= 2) {
      // Outer glow tube
      const glowCurve = new THREE.CatmullRomCurve3(forwardRoutePoints);
      const glowGeom = new THREE.TubeGeometry(glowCurve, 80, 0.45, 8, false);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
      });
      markersGroup.add(new THREE.Mesh(glowGeom, glowMat));

      // Core path tube
      const coreCurve = new THREE.CatmullRomCurve3(forwardRoutePoints);
      const coreGeom = new THREE.TubeGeometry(coreCurve, 80, 0.22, 8, false);
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0x0085ff,
        emissive: 0x0066ff,
        emissiveIntensity: 1.0,
        roughness: 0.0,
        metalness: 0.2,
      });
      markersGroup.add(new THREE.Mesh(coreGeom, coreMat));
    }

    // 9. WAYFINDING GRAPH: Small dots with thin dotted lines connecting them (temporary)
    const graphNodes =
      wayfindingData?.nodes ||
      wayfindingData?.wayfinding_path?.nodes ||
      wayfindingData?.data?.nodes ||
      [];
    let graphEdges =
      wayfindingData?.edges ||
      wayfindingData?.wayfinding_path?.edges ||
      wayfindingData?.data?.edges ||
      {};

    if (Object.keys(graphEdges).length === 0 && graphNodes.length > 0) {
      const extractedEdges = {};
      graphNodes.forEach((n) => {
        if (n.edges) extractedEdges[n.name] = n.edges;
      });
      graphEdges = extractedEdges;
    }

    if (graphNodes.length > 0) {
      const nodeGeom = new THREE.SphereGeometry(0.35, 16, 16);
      const nodeMat = new THREE.MeshStandardMaterial({
        color: 0x00d2ff,
        emissive: 0x0085ff,
        emissiveIntensity: 0.9,
        roughness: 0.2,
      });

      const nodePosMap = new Map();

      graphNodes.forEach((node) => {
        const pos = node.position || node;
        if (pos && pos.x !== undefined && pos.y !== undefined) {
          const p3d = mapTo3D(pos.x, pos.y, 0.5);
          nodePosMap.set(node.name || `${pos.x},${pos.y}`, p3d);

          const nodeMesh = new THREE.Mesh(nodeGeom, nodeMat);
          nodeMesh.position.copy(p3d);
          markersGroup.add(nodeMesh);
        }
      });

      // Thin dotted dashed lines connecting nodes
      const dashedLineMat = new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        linewidth: 2,
        scale: 1,
        dashSize: 0.8,
        gapSize: 0.4,
        transparent: true,
        opacity: 0.85,
      });

      const drawnEdgePairs = new Set();

      Object.entries(graphEdges).forEach(([sourceName, targets]) => {
        const p1 = nodePosMap.get(sourceName);
        if (!p1) return;

        const targetList = Array.isArray(targets)
          ? targets
          : Object.keys(targets || {});

        targetList.forEach((targetName) => {
          const edgeKey = [sourceName, targetName].sort().join("<->");
          if (drawnEdgePairs.has(edgeKey)) return;
          drawnEdgePairs.add(edgeKey);

          const p2 = nodePosMap.get(targetName);
          if (!p2) return;

          const points = [p1, p2];
          const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(lineGeom, dashedLineMat);
          line.computeLineDistances();
          markersGroup.add(line);
        });
      });
    }

    // 9. Tracked Assets
    if (assets && assets.length > 0) {
      const assetGeom = new THREE.SphereGeometry(0.8, 16, 16);
      const assetMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.4,
      });

      assets.forEach((asset) => {
        if (asset.map_id !== mapDetails?.id) return;
        const px = asset.position?.x_m;
        const py = asset.position?.y_m;
        if (px == null || py == null) return;

        const pixelX = px * ppm;
        const pixelY = py * ppm;
        const pos3D = mapTo3D(pixelX, pixelY, 0.8);

        const assetMesh = new THREE.Mesh(assetGeom, assetMat);
        assetMesh.position.copy(pos3D);
        markersGroup.add(assetMesh);
      });
    }
  }, [
    bleLocation,
    resolvedTargetPos,
    floor,
    tagFloor,
    isLiveFloor,
    liftPos,
    mapDetails,
    wayfindingData,
    activeRoute,
    mapTo3D,
    ppm,
    assets,
    distance,
    proximity,
  ]);

  // Zoom controls
  const handleZoomIn = () => {
    if (cameraRef.current) cameraRef.current.position.multiplyScalar(0.85);
  };
  const handleZoomOut = () => {
    if (cameraRef.current) cameraRef.current.position.multiplyScalar(1.15);
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
        background: "#f8fafc",
      }}
    >
      {/* 3D Canvas Container */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Top Floating Turn-by-Turn Navigation HUD Card */}
      {turnInstruction && (
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(15, 23, 42, 0.92)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "18px",
            padding: "10px 18px",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.25)",
            zIndex: 35,
            minWidth: "260px",
            maxWidth: "92%",
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "12px",
              background: "#0085ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: "0 0 16px rgba(0, 133, 255, 0.6)",
            }}
          >
            {turnInstruction.type === "turn-right" && (
              <CornerUpRight size={22} color="#fff" />
            )}
            {turnInstruction.type === "turn-left" && (
              <CornerUpLeft size={22} color="#fff" />
            )}
            {turnInstruction.type === "straight" && (
              <ArrowUp size={22} color="#fff" />
            )}
            {turnInstruction.type === "arrived" && (
              <CheckCircle2 size={22} color="#fff" />
            )}
            {turnInstruction.type === "searching" && (
              <Footprints size={20} color="#fff" />
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "-0.01em",
              }}
            >
              {turnInstruction.text}
            </span>
            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>
              {turnInstruction.subtext}
            </span>
          </div>
        </div>
      )}

      {/* Calibration Toggle Button */}
      <button
        type="button"
        className="calib-toggle-btn"
        onClick={() => setShowCalibPanel((prev) => !prev)}
      >
        <Sliders size={16} />
        3D Fine-Tune ({floor})
      </button>

      {/* Compass / Orientation Toggle Button */}
      <button
        type="button"
        onClick={requestCompassPermission}
        style={{
          position: "absolute",
          top: 60,
          right: 16,
          background: compassActive ? "#0085ff" : "rgba(255, 255, 255, 0.9)",
          color: compassActive ? "#ffffff" : "#0f172a",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: "11px",
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
          zIndex: 20,
        }}
      >
        <Compass size={14} />
        {compassActive ? "Compass Active" : "Enable Compass"}
      </button>

      {/* 3D Model Fine-Tuning Overlay Card */}
      {showCalibPanel && (
        <div className="calib-overlay-card">
          <div className="calib-header">
            <div className="calib-header-title">
              <Sliders size={16} color="#0085ff" />
              <span>3D Model Calibration</span>
              <span className="calib-badge">{floor}</span>
            </div>
            <button
              type="button"
              className="calib-close-btn"
              onClick={() => setShowCalibPanel(false)}
            >
              <X size={16} />
            </button>
          </div>

          {/* Mode Tabs */}
          <div className="calib-tabs">
            <button
              type="button"
              className={`calib-tab-btn ${
                activeTab === "position" ? "active" : ""
              }`}
              onClick={() => setActiveTab("position")}
            >
              <Move size={13} />
              Position
            </button>
            <button
              type="button"
              className={`calib-tab-btn ${
                activeTab === "rotation" ? "active" : ""
              }`}
              onClick={() => setActiveTab("rotation")}
            >
              <RotateCw size={13} />
              Rotation
            </button>
            <button
              type="button"
              className={`calib-tab-btn ${
                activeTab === "scale" ? "active" : ""
              }`}
              onClick={() => setActiveTab("scale")}
            >
              <ScaleIcon size={13} />
              Scale
            </button>
          </div>

          {/* Form Controls */}
          <div className="calib-body">
            {/* POSITION TAB */}
            {activeTab === "position" && (
              <>
                <div className="calib-section-title">
                  Model Position (Meters)
                </div>
                {["posX", "posY", "posZ"].map((field) => {
                  const label =
                    field === "posX"
                      ? "Position X"
                      : field === "posY"
                      ? "Position Y (Height)"
                      : "Position Z";
                  const val = currentCalib[field] ?? 0;
                  return (
                    <div key={field} className="calib-field-group">
                      <div className="calib-field-header">
                        <span className="calib-field-label">{label}</span>
                        <span className="calib-field-unit">meters</span>
                      </div>
                      <div className="calib-input-row">
                        <input
                          type="number"
                          step="0.001"
                          className="calib-number-input"
                          value={val}
                          onChange={(e) =>
                            updateCalibrationField(field, e.target.value)
                          }
                        />
                      </div>
                      <div className="calib-step-controls">
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -1.0)}
                        >
                          -1.0
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -0.1)}
                        >
                          -0.1
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -0.01)}
                        >
                          -0.01
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -0.001)}
                        >
                          -0.001
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 0.001)}
                        >
                          +0.001
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 0.01)}
                        >
                          +0.01
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 0.1)}
                        >
                          +0.1
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 1.0)}
                        >
                          +1.0
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* ROTATION TAB */}
            {activeTab === "rotation" && (
              <>
                <div className="calib-section-title">
                  Model Rotation (Degrees)
                </div>
                {["rotX", "rotY", "rotZ"].map((field) => {
                  const label =
                    field === "rotX"
                      ? "Rotation Pitch (X)"
                      : field === "rotY"
                      ? "Rotation Yaw (Y)"
                      : "Rotation Roll (Z)";
                  const val = currentCalib[field] ?? 0;
                  return (
                    <div key={field} className="calib-field-group">
                      <div className="calib-field-header">
                        <span className="calib-field-label">{label}</span>
                        <span className="calib-field-unit">deg</span>
                      </div>
                      <div className="calib-input-row">
                        <input
                          type="number"
                          step="0.001"
                          className="calib-number-input"
                          value={val}
                          onChange={(e) =>
                            updateCalibrationField(field, e.target.value)
                          }
                        />
                      </div>
                      <div className="calib-step-controls">
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -10.0)}
                        >
                          -10°
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -1.0)}
                        >
                          -1°
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -0.1)}
                        >
                          -0.1°
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -0.001)}
                        >
                          -0.001°
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 0.001)}
                        >
                          +0.001°
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 0.1)}
                        >
                          +0.1°
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 1.0)}
                        >
                          +1°
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 10.0)}
                        >
                          +10°
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* SCALE TAB */}
            {activeTab === "scale" && (
              <>
                <div className="calib-section-title">Model Scale Factor</div>
                <div
                  style={{
                    marginBottom: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    id="chk-uniform-scale"
                    checked={currentCalib.uniformScale}
                    onChange={(e) =>
                      setCalibration((prev) => ({
                        ...prev,
                        [floor]: {
                          ...prev[floor],
                          uniformScale: e.target.checked,
                        },
                      }))
                    }
                  />
                  <label
                    htmlFor="chk-uniform-scale"
                    style={{
                      fontSize: 11,
                      color: "#cbd5e1",
                      fontWeight: 600,
                    }}
                  >
                    Lock Uniform Scale (XYZ)
                  </label>
                </div>

                {["scaleX", "scaleY", "scaleZ"].map((field) => {
                  if (currentCalib.uniformScale && field !== "scaleX")
                    return null;
                  const label = currentCalib.uniformScale
                    ? "Uniform Scale (XYZ)"
                    : field === "scaleX"
                    ? "Scale X"
                    : field === "scaleY"
                    ? "Scale Y"
                    : "Scale Z";
                  const val = currentCalib[field] ?? 1;

                  return (
                    <div key={field} className="calib-field-group">
                      <div className="calib-field-header">
                        <span className="calib-field-label">{label}</span>
                        <span className="calib-field-unit">multiplier</span>
                      </div>
                      <div className="calib-input-row">
                        <input
                          type="number"
                          step="0.001"
                          className="calib-number-input"
                          value={val}
                          onChange={(e) =>
                            updateCalibrationField(field, e.target.value)
                          }
                        />
                      </div>
                      <div className="calib-step-controls">
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -0.5)}
                        >
                          -0.5
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -0.1)}
                        >
                          -0.1
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -0.01)}
                        >
                          -0.01
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, -0.001)}
                        >
                          -0.001
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 0.001)}
                        >
                          +0.001
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 0.01)}
                        >
                          +0.01
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 0.1)}
                        >
                          +0.1
                        </button>
                        <button
                          type="button"
                          className="calib-step-btn"
                          onClick={() => adjustStep(field, 0.5)}
                        >
                          +0.5
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Footer Actions */}
          <div className="calib-footer">
            <button
              type="button"
              className="calib-action-btn"
              onClick={resetCurrentFloorCalib}
            >
              <RotateCcw size={12} />
              Reset {floor}
            </button>
            <button
              type="button"
              className="calib-action-btn calib-action-btn--primary"
              onClick={handleCopyConfig}
            >
              {copiedConfig ? <Check size={12} /> : <Copy size={12} />}
              {copiedConfig ? "Copied!" : "Copy JSON"}
            </button>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loadingModel && (
        <div
          className="loading-overlay"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(248, 250, 252, 0.88)",
            backdropFilter: "blur(6px)",
            color: "#0f172a",
            zIndex: 15,
          }}
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
            bottom: 75,
            left: 16,
            background: "rgba(239, 68, 68, 0.9)",
            color: "#fff",
            padding: "6px 14px",
            borderRadius: "12px",
            fontSize: "11px",
            fontWeight: 700,
            zIndex: 20,
          }}
        >
          {modelError}
        </div>
      )}

      {/* Floating Re-center / Follow Mode Button (Google Maps style) */}
      {!followMode && (
        <button
          type="button"
          onClick={() => setFollowMode(true)}
          style={{
            position: "absolute",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "linear-gradient(135deg, #0085ff, #0284c7)",
            color: "#ffffff",
            border: "none",
            borderRadius: "30px",
            padding: "10px 22px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "12px",
            fontWeight: 800,
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(0, 133, 255, 0.45)",
            zIndex: 35,
            transition: "all 0.2s ease",
          }}
        >
          <Navigation size={16} color="#fff" />
          Re-center Navigation
        </button>
      )}

      {/* Floating Zoom & Camera Controls */}
      <div className="map-zoom-controls">
        <button
          onClick={() => setFollowMode((prev) => !prev)}
          className={`floor-btn-stack ${
            followMode ? "active" : "inactive"
          } map-zoom-btn`}
          type="button"
          title={followMode ? "Free Orbit Mode" : "Follow Live Location"}
          style={{
            background: followMode ? "#0085ff" : undefined,
            color: followMode ? "#fff" : undefined,
          }}
        >
          <Crosshair size={16} />
        </button>
        <button
          onClick={handleZoomIn}
          className="floor-btn-stack inactive map-zoom-btn"
          type="button"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={handleZoomOut}
          className="floor-btn-stack inactive map-zoom-btn"
          type="button"
        >
          <ZoomOut size={16} />
        </button>
        <button
          onClick={handleResetZoom}
          className="floor-btn-stack inactive map-zoom-btn"
          type="button"
        >
          <Maximize2 size={14} />
        </button>
      </div>

      {/* Stacked Floor Switcher (Bottom Right) */}
      <div className="floor-switcher-stack">
        <button
          onClick={() => onFloorChange("F1")}
          className={`floor-btn-stack ${
            floor === "F1" ? "active" : "inactive"
          }`}
          type="button"
          id="btn-floor-f1"
        >
          F1
        </button>
        <button
          onClick={() => onFloorChange("GR")}
          className={`floor-btn-stack ${
            floor === "GR" ? "active" : "inactive"
          }`}
          type="button"
          id="btn-floor-gr"
        >
          GR
        </button>
      </div>
    </div>
  );
}