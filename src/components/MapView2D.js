// src/components/MapView2D.js
import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import { useSelector } from "react-redux";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import apList from "../services/ap_list.json";
import { FLOOR_MAP_IDS } from "../constants";

export const FLOORPLAN_CALIBRATION = {
  GR: { rotation: 0, scale: 0.9, offsetX: -15, offsetY: 0 },
  F1: { rotation: 0, scale: 0.9, offsetX: -12, offsetY: 0 },
};

// Ground floor corridor wayfinding network (MB3-F00 corridors, lift near AP19)
export const DEFAULT_GR_WAYFINDING = {
  nodes: [
    { name: "N1", position: { x: 4985.9, y: 1179.7 } },
    { name: "N9", position: { x: 5491.48, y: 1348.23 } },
    { name: "N12", position: { x: 4997.36, y: 1727.92 } },
    { name: "NLift", position: { x: 5296.38, y: 1722.96 } }, // Directly at AP19
    { name: "N13", position: { x: 5459.88, y: 1717.72 } },
    { name: "N7", position: { x: 5450.14, y: 1831.55 } },
    { name: "N6", position: { x: 5465.0, y: 2011.0 } }, // Hallway opposite AP23
    { name: "N8", position: { x: 5465.0, y: 2435.6 } }, // Hallway outside visitor room doorway
    { name: "N10", position: { x: 5465.0, y: 2800.0 } }, // Hallway near AP15
    { name: "N4", position: { x: 5462.86, y: 3256.09 } },
    { name: "N5", position: { x: 5029.71, y: 3274.7 } },
    { name: "N2", position: { x: 5036.77, y: 3612.23 } },
  ],
  edges: {
    N1: { N12: { weight: 1 } },
    N12: { N1: { weight: 1 }, NLift: { weight: 1 }, N5: { weight: 1 } },
    NLift: { N12: { weight: 1 }, N13: { weight: 1 } },
    N13: { NLift: { weight: 1 }, N9: { weight: 1 }, N7: { weight: 1 } },
    N9: { N13: { weight: 1 } },
    N7: { N13: { weight: 1 }, N6: { weight: 1 } },
    N6: { N7: { weight: 1 }, N8: { weight: 1 } },
    N8: { N6: { weight: 1 }, N10: { weight: 1 } },
    N10: { N8: { weight: 1 }, N4: { weight: 1 } },
    N4: { N10: { weight: 1 }, N5: { weight: 1 } },
    N5: { N4: { weight: 1 }, N12: { weight: 1 }, N2: { weight: 1 } },
    N2: { N5: { weight: 1 } },
  },
};

function extractWaypoints(rawRoute) {
  if (!rawRoute) return [];
  let list = [];
  if (Array.isArray(rawRoute)) list = rawRoute;
  else if (rawRoute.nodes && Array.isArray(rawRoute.nodes))
    list = rawRoute.nodes;
  else if (rawRoute.waypoints && Array.isArray(rawRoute.waypoints))
    list = rawRoute.waypoints;
  else if (rawRoute.path && Array.isArray(rawRoute.path)) list = rawRoute.path;
  else if (typeof rawRoute === "object") {
    if (rawRoute.nodes) list = Object.values(rawRoute.nodes);
    else if (rawRoute.waypoints) list = Object.values(rawRoute.waypoints);
    else list = Object.values(rawRoute);
  }
  return list
    .map((item) => {
      if (!item) return null;
      let posX, posY;
      if (Array.isArray(item) && item.length >= 2) {
        posX = Number(item[0]);
        posY = Number(item[1]);
      } else if (
        item.position &&
        item.position.x !== undefined &&
        item.position.y !== undefined
      ) {
        posX = Number(item.position.x);
        posY = Number(item.position.y);
      } else if (item.x !== undefined && item.y !== undefined) {
        posX = Number(item.x);
        posY = Number(item.y);
      }
      if (
        posX !== undefined &&
        !isNaN(posX) &&
        posY !== undefined &&
        !isNaN(posY)
      ) {
        return { x: posX, y: posY };
      }
      return null;
    })
    .filter((pt) => pt !== null);
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
    const name = String(n.name || n.id || "")
      .trim()
      .toUpperCase();
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

  const nodeMap = new Map();
  list.forEach((n) => nodeMap.set(String(n.name || n.id), n));

  const pathNodes = [];
  let curr = endName;
  while (curr) {
    const nodeObj = nodeMap.get(curr);
    if (nodeObj) {
      const p = nodeObj.position || nodeObj;
      pathNodes.unshift({ x: Number(p.x), y: Number(p.y), name: curr });
    }
    curr = previous[curr];
  }

  // ── Safety net: if both endpoints snapped to the SAME node, draw a
  //    direct line from start to end instead of returning a 1-node path.
  if (startName === endName) {
    return [
      { x: startPos.x, y: startPos.y },
      { x: endPos.x, y: endPos.y },
    ];
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

const SVG_WIDTH = 900;
const SVG_HEIGHT = 600;

export default function MapView2D({
  floor,
  tagFloor = "GR",
  onFloorChange,
  mapDetails,
  bleLocation,
  connectedApMac,
  targetCoordinates: targetPos,
  wayfindingData,
  floorMapData,
  activeRoute,
  distance,
  proximity,
  assets = [],
}) {
  const [zoom, setZoom] = useState(3.2);
  const [pan, setPan] = useState({ x: -320, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panRef = useRef({ x: -320, y: 0 });
  const zoomRef = useRef(3.2);
  const touchStateRef = useRef({
    mode: "none",
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    startDistance: 0,
    startZoom: 3.2,
    midX: 0,
    midY: 0,
  });
  const [renderedPdfImage, setRenderedPdfImage] = useState({
    GR: null,
    F1: null,
  });
  const renderedPdfImageRef = useRef({ GR: null, F1: null });
  const containerRef = useRef(null);

  // Resolve lift coordinates for GR: located directly near AP19 (x: 5296.38, y: 1722.96)
  const grLiftPos = useMemo(() => {
    const ap19 = Array.isArray(apList)
      ? apList.find(
          (ap) =>
            ap.name?.includes("-AP19") ||
            ap.name?.includes("AP19") ||
            ap.mac === "c878678aa0a8",
        )
      : null;
    if (ap19 && ap19.x !== undefined && ap19.y !== undefined) {
      return { x: Number(ap19.x), y: Number(ap19.y) };
    }
    return { x: 5296.38, y: 1722.96 };
  }, []);

  const activeFloorData = floorMapData?.[floor] || {};
  const activeMapMeta = activeFloorData.mapMeta || mapDetails;
  const rawWayfinding = activeFloorData.wayfindingData || wayfindingData;
  const activeWayfinding = useMemo(() => {
    let nodes =
      rawWayfinding?.nodes ||
      rawWayfinding?.wayfinding_path?.nodes ||
      rawWayfinding?.data?.nodes ||
      [];
    let edges =
      rawWayfinding?.edges ||
      rawWayfinding?.wayfinding_path?.edges ||
      rawWayfinding?.data?.edges ||
      {};

    // Normalize nodes (ensure each node has name, id, x, y)
    nodes = nodes.map((n) => ({
      ...n,
      name: n.name || n.id,
      id: n.id || n.name,
      x: n.position?.x ?? n.x,
      y: n.position?.y ?? n.y,
    }));

    // If edges is an array: [ { from, to }, { source, target } ] convert to adjacency map
    if (Array.isArray(edges)) {
      const converted = {};
      edges.forEach((edge) => {
        const u = edge.from || edge.source || edge.start;
        const v = edge.to || edge.target || edge.end;
        if (u && v) {
          if (!converted[u]) converted[u] = {};
          if (!converted[v]) converted[v] = {};
          converted[u][v] = { weight: edge.weight || 1 };
          converted[v][u] = { weight: edge.weight || 1 };
        }
      });
      edges = converted;
    } else if (Object.keys(edges).length === 0 && nodes.length > 0) {
      const extracted = {};
      nodes.forEach((n) => {
        if (n.edges) extracted[n.name] = n.edges;
      });
      edges = extracted;
    }

    // Ground Floor: Use complete corridor wayfinding graph with Lift near AP19
    if (floor === "GR") {
      const baseNodes = DEFAULT_GR_WAYFINDING.nodes;
      const baseEdges = DEFAULT_GR_WAYFINDING.edges;

      const mergedNodesMap = new Map();
      baseNodes.forEach((n) => mergedNodesMap.set(String(n.name || n.id), n));
      (nodes || []).forEach((n) => {
        const id = String(n.name || n.id);
        if (!mergedNodesMap.has(id)) {
          mergedNodesMap.set(id, n);
        }
      });

      const mergedEdges = { ...baseEdges };
      Object.keys(edges || {}).forEach((k) => {
        if (!mergedEdges[k]) {
          mergedEdges[k] = edges[k];
        }
      });

      // Ensure corridor connectivity along vertical hallway and lift
      mergedEdges.N7 = { N13: { weight: 1 }, N6: { weight: 1 } };
      mergedEdges.N6 = { N7: { weight: 1 }, N8: { weight: 1 } };
      mergedEdges.N8 = { N6: { weight: 1 }, N10: { weight: 1 } };
      mergedEdges.N10 = { N8: { weight: 1 }, N4: { weight: 1 } };
      mergedEdges.N4 = { N10: { weight: 1 }, N5: { weight: 1 } };
      mergedEdges.NLift = { N12: { weight: 1 }, N13: { weight: 1 } };
      mergedEdges.N12 = { ...(mergedEdges.N12 || {}), NLift: { weight: 1 } };
      mergedEdges.N13 = {
        ...(mergedEdges.N13 || {}),
        NLift: { weight: 1 },
        N7: { weight: 1 },
      };

      return { nodes: Array.from(mergedNodesMap.values()), edges: mergedEdges };
    }

    return { nodes, edges };
  }, [rawWayfinding, floor]);
  const mapWidth = activeMapMeta?.width || 6400;
  const mapHeight = activeMapMeta?.height || 5120;
  const ppm = activeMapMeta?.ppm || 50.07391564392213;
  const calib = FLOORPLAN_CALIBRATION[floor] || FLOORPLAN_CALIBRATION.GR;

  // Filter Mist APs from ap_list.json for the active floor
  const floorAps = useMemo(() => {
    if (!Array.isArray(apList)) return [];
    const targetMapId =
      activeMapMeta?.id ||
      FLOOR_MAP_IDS[floor] ||
      (floor === "GR"
        ? "30141417-44ea-4982-993c-6225c9f08315"
        : "cfa55e13-794f-4081-b1b7-e35f1ea67325");

    return apList.filter((ap) => {
      if (
        ap.x === undefined ||
        ap.y === undefined ||
        ap.x === null ||
        ap.y === null
      ) {
        return false;
      }
      if (ap.map_id && ap.map_id === targetMapId) return true;
      if (
        floor === "GR" &&
        (ap.name?.includes("-F00-") || ap.name?.includes("-GR-"))
      )
        return true;
      if (
        floor === "F1" &&
        (ap.name?.includes("-F01-") || ap.name?.includes("-F1-"))
      )
        return true;
      return false;
    });
  }, [floor, activeMapMeta]);

  useEffect(() => {
    const loadPdfEngineAndRender = async () => {
      if (!window.pdfjsLib) {
        await new Promise((resolve) => {
          const script = document.createElement("script");
          script.src =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          script.onload = () => {
            if (window.pdfjsLib) {
              window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
            }
            resolve();
          };
          document.body.appendChild(script);
        });
      }
      if (window.pdfjsLib && !renderedPdfImageRef.current[floor]) {
        const pdfPath = `/floorplans/${floor}.pdf`;
        try {
          const loadingTask = window.pdfjsLib.getDocument(pdfPath);
          const pdf = await loadingTask.promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 2.5 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: context, viewport }).promise;
          const pngDataUrl = canvas.toDataURL("image/png");
          renderedPdfImageRef.current[floor] = pngDataUrl;
          setRenderedPdfImage((prev) => ({ ...prev, [floor]: pngDataUrl }));
        } catch (err) {
          console.warn(
            `Could not load ${pdfPath}, using fallback image:`,
            err.message,
          );
        }
      }
    };
    loadPdfEngineAndRender();
  }, [floor]);

  const floorplanImageUrl = useMemo(() => {
    if (renderedPdfImage[floor]) return renderedPdfImage[floor];
    if (activeMapMeta?.url) return activeMapMeta.url;
    if (activeMapMeta?.image_url) return activeMapMeta.image_url;
    return floor === "GR" ? "/floorplans/GR.png" : "/floorplans/F1.png";
  }, [renderedPdfImage, floor, activeMapMeta]);

  const distanceInMeters = useMemo(() => {
    if (distance === null || distance === undefined) return null;
    let m = null;
    if (typeof distance === "number") m = distance;
    else if (typeof distance === "object")
      m = distance.meters ?? (distance.pixels ? distance.pixels / ppm : null);
    if (m === null || isNaN(m) || m < 0) return null;
    return m.toFixed(1);
  }, [distance, ppm]);

  const transformCoords = useCallback(
    (x, y) => {
      if (x === undefined || y === undefined || x === null || y === null) {
        return { svgX: SVG_WIDTH / 2, svgY: SVG_HEIGHT / 2 };
      }
      const padding = 50;
      const scaleX = (SVG_WIDTH - padding * 2) / mapWidth;
      const scaleY = (SVG_HEIGHT - padding * 2) / mapHeight;
      const scale = Math.min(scaleX, scaleY);
      const offsetX = (SVG_WIDTH - mapWidth * scale) / 2;
      const offsetY = (SVG_HEIGHT - mapHeight * scale) / 2;
      return { svgX: offsetX + x * scale, svgY: offsetY + y * scale };
    },
    [mapWidth, mapHeight],
  );

  // 3-meter radius around Mist AP in SVG coordinates
  const svgRadius3m = useMemo(() => {
    const padding = 50;
    const scaleX = (SVG_WIDTH - padding * 2) / mapWidth;
    const scaleY = (SVG_HEIGHT - padding * 2) / mapHeight;
    const scale = Math.min(scaleX, scaleY);
    return 3 * ppm * scale;
  }, [mapWidth, mapHeight, ppm]);

  const isLiveFloor = floor === tagFloor;

  // Resolve lift coordinates for F1 (midpoint of N48 & N45)
  const f1LiftPos = useMemo(() => {
    const f1Wf =
      floorMapData?.F1?.wayfindingData ||
      (floor === "F1" ? activeWayfinding : null);
    const f1Nodes = f1Wf?.nodes || [];
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
  }, [floorMapData, floor, activeWayfinding]);

  const liftPos = floor === "F1" ? f1LiftPos : grLiftPos;

  const rawStartPos = useMemo(() => {
    // If viewing F1 while tag is in GR, navigation starts from the F1 Lift
    if (!isLiveFloor && floor === "F1") {
      return f1LiftPos;
    }

    let rawX = bleLocation?.x;
    let rawY = bleLocation?.y;

    if (bleLocation?.x_m != null && (rawX == null || rawX < 300)) {
      const ox = activeMapMeta?.origin_x ?? 306.45;
      rawX = ox + bleLocation.x_m * ppm;
    }
    if (bleLocation?.y_m != null && (rawY == null || rawY < 300)) {
      const oy = activeMapMeta?.origin_y ?? 3856.48;
      rawY = oy - bleLocation.y_m * ppm;
    }

    const isLiveLocation = bleLocation?.x != null || bleLocation?.x_m != null;
    if (rawX == null || isNaN(rawX)) {
      rawX = liftPos.x;
      console.warn(
        "⚠️ [MapView2D] Location FALLBACK: No live X coordinate, defaulting to lift anchor:",
        liftPos.x,
      );
    }
    if (rawY == null || isNaN(rawY)) {
      rawY = liftPos.y;
      console.warn(
        "⚠️ [MapView2D] Location FALLBACK: No live Y coordinate, defaulting to lift anchor:",
        liftPos.y,
      );
    }

    if (isLiveLocation && isLiveFloor) {
      console.log(
        `🟢 [MapView2D] Rendering LIVE MIST location on floor ${floor}: (${Math.round(rawX)}, ${Math.round(rawY)})`,
      );
    } else if (!isLiveFloor) {
      console.log(
        `ℹ️ [MapView2D] Floor preview: Showing floor ${floor} while tag is on ${tagFloor}`,
      );
    }

    return { x: rawX, y: rawY };
  }, [
    isLiveFloor,
    floor,
    bleLocation,
    ppm,
    liftPos,
    f1LiftPos,
    tagFloor,
    activeMapMeta,
  ]);

  const reduxApMac = useSelector(
    (state) =>
      state.floor?.activeApMac ||
      state.floor?.bleSignal?.ap_mac ||
      state.floor?.visitorPos?.ap_mac,
  );

  const activeConnectedApMac =
    connectedApMac ||
    bleLocation?.ap_mac ||
    bleLocation?.apMac ||
    bleLocation?.ap ||
    reduxApMac;

  // Resolve currently connected Mist AP
  const connectedAp = useMemo(() => {
    if (!floorAps || floorAps.length === 0) return null;

    const normalizeMac = (mac) => {
      if (!mac || typeof mac !== "string") return "";
      return mac.replace(/[:-]/g, "").toLowerCase().trim();
    };

    const targetMac = normalizeMac(activeConnectedApMac);

    if (targetMac) {
      const match = floorAps.find((ap) => {
        const apMac = normalizeMac(ap.mac);
        if (apMac && apMac === targetMac) return true;
        if (ap.id && normalizeMac(ap.id).endsWith(targetMac)) return true;
        return false;
      });
      if (match) return match;
    }

    if (rawStartPos && rawStartPos.x != null && rawStartPos.y != null) {
      let nearest = null;
      let minDistance = Infinity;
      floorAps.forEach((ap) => {
        const dist = Math.hypot(ap.x - rawStartPos.x, ap.y - rawStartPos.y);
        if (dist < minDistance) {
          minDistance = dist;
          nearest = ap;
        }
      });
      return nearest;
    }

    return null;
  }, [floorAps, activeConnectedApMac, rawStartPos]);

  const connectedApPos = useMemo(() => {
    if (!connectedAp) return null;
    return transformCoords(connectedAp.x, connectedAp.y);
  }, [connectedAp, transformCoords]);

  const effectiveTargetPos = useMemo(() => {
    if (floor === "GR") {
      return grLiftPos;
    }

    if (targetPos && targetPos.x !== undefined && targetPos.y !== undefined) {
      return targetPos;
    }
    return { x: 5525.298750495607, y: 1000.837930104785 };
  }, [floor, grLiftPos, targetPos]);

  const hasValidTarget = useMemo(() => {
    return (
      effectiveTargetPos &&
      effectiveTargetPos.x !== undefined &&
      effectiveTargetPos.y !== undefined
    );
  }, [effectiveTargetPos]);

  const destPos = useMemo(() => {
    if (hasValidTarget) {
      return transformCoords(effectiveTargetPos.x, effectiveTargetPos.y);
    }
    return null;
  }, [hasValidTarget, effectiveTargetPos, transformCoords]);

  // ──────────────────────────────────────────────────────────────
  // Route resolution
  //
  // 1. Prefer the BACKEND's precomputed route (activeRoute) — works
  //    on both GR and F1 now that the backend injects EXTRA_NODES
  //    for Ground Floor.
  // 2. Fall back to client-side Dijkstra if the backend route is
  //    empty or has < 2 waypoints.
  // ──────────────────────────────────────────────────────────────
  const backendWaypoints = useMemo(() => {
    if (floor === "GR") {
      const path = calculateDijkstraPath(
        activeWayfinding?.nodes || [],
        activeWayfinding?.edges || {},
        rawStartPos,
        grLiftPos,
      );
      console.log(
        `🧭 [MapView2D Route GR] Client Dijkstra fallback: ${path.length} waypoints`,
      );
      return path;
    }

    // On F1: if not on live floor (previewing from GR), route starts from F1 Lift (N48 & N45 midpoint) to Target Cabinet
    if (floor === "F1" && !isLiveFloor) {
      const path = calculateDijkstraPath(
        activeWayfinding?.nodes || [],
        activeWayfinding?.edges || {},
        f1LiftPos,
        effectiveTargetPos,
      );
      console.log(
        `🧭 [MapView2D Route F1 Preview] Client Dijkstra fallback: ${path.length} waypoints`,
      );
      return path;
    }

    // On F1 and live floor
    const rawWaypoints =
      activeRoute?.waypoints || activeRoute?.nodes || activeRoute?.path;
    const extracted = extractWaypoints(rawWaypoints);
    if (extracted.length === 0 && effectiveTargetPos) {
      const fallbackPath = calculateDijkstraPath(
        activeWayfinding?.nodes || [],
        activeWayfinding?.edges || {},
        rawStartPos,
        effectiveTargetPos,
      );
      console.log(
        `🟡 [MapView2D Route F1] Path Source: FALLBACK CLIENT DIJKSTRA (${fallbackPath.length} waypoints)`,
      );
      return fallbackPath;
    }
    console.log(
      `🟢 [MapView2D Route F1] Path Source: LIVE BACKEND MIST ROUTE (${extracted.length} waypoints)`,
    );
    return extracted;
  }, [
    floor,
    isLiveFloor,
    f1LiftPos,
    grLiftPos,
    effectiveTargetPos,
    activeWayfinding,
    rawStartPos,
    activeRoute,
  ]);

  // Snap start position to nearest corridor wayfinding segment
  const startPos = useMemo(() => {
    let activeX = rawStartPos.x;
    let activeY = rawStartPos.y;

    if (backendWaypoints.length >= 2) {
      let minDistance = Infinity;
      let bestSnapped = null;

      for (let i = 0; i < backendWaypoints.length - 1; i++) {
        const a = backendWaypoints[i];
        const b = backendWaypoints[i + 1];
        const abX = b.x - a.x;
        const abY = b.y - a.y;
        const apX = activeX - a.x;
        const apY = activeY - a.y;
        const abLenSq = abX * abX + abY * abY;

        if (abLenSq > 0) {
          let t = (apX * abX + apY * abY) / abLenSq;
          t = Math.max(0, Math.min(1, t));
          const projX = a.x + t * abX;
          const projY = a.y + t * abY;
          const distPx = Math.hypot(activeX - projX, activeY - projY);

          if (distPx < minDistance) {
            minDistance = distPx;
            bestSnapped = { x: projX, y: projY, distMeters: distPx / ppm };
          }
        }
      }

      // If within corridor radius (2.8 meters), snap to centerline
      if (bestSnapped && bestSnapped.distMeters <= 2.8) {
        activeX = bestSnapped.x;
        activeY = bestSnapped.y;
      }
    }

    return transformCoords(activeX, activeY);
  }, [rawStartPos, backendWaypoints, transformCoords, ppm]);

  const forwardWaypoints = useMemo(() => {
    if (backendWaypoints.length === 0) return [];
    if (!isLiveFloor) return backendWaypoints;

    let closestIdx = 0;
    let minDist = Infinity;
    backendWaypoints.forEach((wpt, idx) => {
      const d = Math.hypot(wpt.x - rawStartPos.x, wpt.y - rawStartPos.y);
      if (d < minDist) {
        minDist = d;
        closestIdx = idx;
      }
    });
    return backendWaypoints.slice(closestIdx);
  }, [backendWaypoints, rawStartPos, isLiveFloor]);

  const previewDistanceInMeters = useMemo(() => {
    if (backendWaypoints.length < 2) return null;
    let totalPx = 0;
    for (let i = 0; i < backendWaypoints.length - 1; i++) {
      totalPx += Math.hypot(
        backendWaypoints[i + 1].x - backendWaypoints[i].x,
        backendWaypoints[i + 1].y - backendWaypoints[i].y,
      );
    }
    return (totalPx / ppm).toFixed(1);
  }, [backendWaypoints, ppm]);

  const liveRoutePathD = useMemo(() => {
    if (!destPos && forwardWaypoints.length === 0) return "";
    const points = [];
    if (startPos) points.push(startPos);
    if (forwardWaypoints && forwardWaypoints.length > 0) {
      forwardWaypoints.forEach((pt) =>
        points.push(transformCoords(pt.x, pt.y)),
      );
    }
    if (destPos) points.push(destPos);
    if (points.length < 2) return "";

    // Deduplicate consecutive points
    const cleanPoints = points.filter((pt, idx) => {
      if (idx === 0) return true;
      const prev = points[idx - 1];
      return Math.hypot(pt.svgX - prev.svgX, pt.svgY - prev.svgY) > 0.5;
    });

    if (cleanPoints.length < 2) return "";
    return cleanPoints.reduce(
      (acc, pt, idx) =>
        idx === 0
          ? `M ${pt.svgX} ${pt.svgY}`
          : `${acc} L ${pt.svgX} ${pt.svgY}`,
      "",
    );
  }, [startPos, forwardWaypoints, destPos, transformCoords]);

  const f1LiveRoutePathD = useMemo(() => {
    if (floor !== "F1") return "";
    return liveRoutePathD;
  }, [floor, liveRoutePathD]);

  // Keep refs synchronized for native event listeners
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Mouse wheel zoom for PC (centered around mouse cursor)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;

      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;

      // Handle trackpad pinch (e.ctrlKey) or standard mouse wheel
      let zoomFactor = 1;
      if (e.ctrlKey) {
        zoomFactor = Math.exp(-e.deltaY * 0.015);
      } else {
        zoomFactor = e.deltaY < 0 ? 1.18 : 0.85;
      }

      const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.4), 10.0);
      const scaleChange = newZoom / currentZoom;
      const newPanX = mouseX - (mouseX - currentPan.x) * scaleChange;
      const newPanY = mouseY - (mouseY - currentPan.y) * scaleChange;

      setZoom(Number(newZoom.toFixed(3)));
      setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, []);

  // Window-level mouse drag listeners for PC so pan never sticks
  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e) => {
      setPan({
        x: Math.round(e.clientX - dragStartRef.current.x),
        y: Math.round(e.clientY - dragStartRef.current.y),
      });
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleGlobalMouseMove);
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [isDragging]);

  // Pinch-to-zoom & touch-pan for Mobile and Tablets
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getDistance = (t1, t2) => {
      return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    };

    const getMidpoint = (t1, t2, rect) => {
      return {
        x: (t1.clientX + t2.clientX) / 2 - rect.left - rect.width / 2,
        y: (t1.clientY + t2.clientY) / 2 - rect.top - rect.height / 2,
      };
    };

    const handleTouchStart = (e) => {
      if (e.touches.length === 1) {
        // Single finger: pan
        const touch = e.touches[0];
        touchStateRef.current = {
          mode: "pan",
          startX: touch.clientX,
          startY: touch.clientY,
          startPanX: panRef.current.x,
          startPanY: panRef.current.y,
          startDistance: 0,
          startZoom: zoomRef.current,
          midX: 0,
          midY: 0,
        };
      } else if (e.touches.length >= 2) {
        // Two fingers: pinch zoom + pan
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const rect = container.getBoundingClientRect();
        const dist = getDistance(t1, t2);
        const mid = getMidpoint(t1, t2, rect);

        touchStateRef.current = {
          mode: "pinch",
          startX: mid.x,
          startY: mid.y,
          startPanX: panRef.current.x,
          startPanY: panRef.current.y,
          startDistance: dist,
          startZoom: zoomRef.current,
          midX: mid.x,
          midY: mid.y,
        };
      }
    };

    const handleTouchMove = (e) => {
      if (e.cancelable) e.preventDefault();
      const state = touchStateRef.current;

      if (state.mode === "pan" && e.touches.length === 1) {
        const touch = e.touches[0];
        const dx = touch.clientX - state.startX;
        const dy = touch.clientY - state.startY;
        setPan({
          x: Math.round(state.startPanX + dx),
          y: Math.round(state.startPanY + dy),
        });
      } else if (e.touches.length >= 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const rect = container.getBoundingClientRect();
        const dist = getDistance(t1, t2);
        const currentMid = getMidpoint(t1, t2, rect);

        if (state.mode !== "pinch") {
          touchStateRef.current = {
            mode: "pinch",
            startX: currentMid.x,
            startY: currentMid.y,
            startPanX: panRef.current.x,
            startPanY: panRef.current.y,
            startDistance: dist,
            startZoom: zoomRef.current,
            midX: currentMid.x,
            midY: currentMid.y,
          };
          return;
        }

        if (state.startDistance > 0) {
          const ratio = dist / state.startDistance;
          const newZoom = Math.min(
            Math.max(state.startZoom * ratio, 0.4),
            10.0,
          );

          const scaleChange = newZoom / state.startZoom;
          const dragX = currentMid.x - state.startX;
          const dragY = currentMid.y - state.startY;
          const newPanX =
            state.midX - (state.midX - state.startPanX) * scaleChange + dragX;
          const newPanY =
            state.midY - (state.midY - state.startPanY) * scaleChange + dragY;

          setZoom(Number(newZoom.toFixed(3)));
          setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
        }
      }
    };

    const handleTouchEnd = (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchStateRef.current = {
          mode: "pan",
          startX: touch.clientX,
          startY: touch.clientY,
          startPanX: panRef.current.x,
          startPanY: panRef.current.y,
          startDistance: 0,
          startZoom: zoomRef.current,
          midX: 0,
          midY: 0,
        };
      } else if (e.touches.length === 0) {
        touchStateRef.current = { mode: "none" };
      }
    };

    container.addEventListener("touchstart", handleTouchStart, {
      passive: false,
    });
    container.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    container.addEventListener("touchend", handleTouchEnd, {
      passive: false,
    });
    container.addEventListener("touchcancel", handleTouchEnd, {
      passive: false,
    });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  const handleZoomIn = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setZoom((prev) => {
      const next = Math.min(prev * 1.3, 10.0);
      return Number(next.toFixed(2));
    });
  };

  const handleZoomOut = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setZoom((prev) => {
      const next = Math.max(prev / 1.3, 0.4);
      return Number(next.toFixed(2));
    });
  };

  const handleResetZoom = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  return (
    <div
      className="map-card-wrapper"
      ref={containerRef}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <div className="nav-status-badge">
        <span className="nav-icon-dot"></span>
        <div className="nav-badge-texts">
          <span className="nav-badge-title">
            {isLiveFloor
              ? proximity || "Live Tracking Active"
              : floor === "F1"
                ? "F1 Route Preview"
                : "Route Preview"}
          </span>
          <span className="nav-badge-subtitle">
            {isLiveFloor
              ? distanceInMeters !== null
                ? `${distanceInMeters} m to Target`
                : "Updating Location..."
              : previewDistanceInMeters !== null
                ? `${previewDistanceInMeters} m from Lift to Cabinet`
                : "Path from Lift to Cabinet"}
          </span>
        </div>
      </div>

      <svg
        className="map-canvas-svg"
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseDown={handleMouseDown}
        style={{
          cursor: isDragging ? "grabbing" : "grab",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "center center",
          transition: isDragging
            ? "none"
            : "transform 0.2s cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        <defs>
          <marker
            id="routeArrow"
            markerWidth="2.5"
            markerHeight="2.5"
            refX="1.8"
            refY="1.25"
            orient="auto"
          >
            <path d="M 0 0 L 2.5 1.25 L 0 2.5 z" fill="#0085ff" />
          </marker>
          <pattern
            id="gridPattern"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="#cbd5e1"
              strokeWidth="0.8"
              opacity="0.4"
            />
          </pattern>
        </defs>

        <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="#f1f5f9" />
        <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#gridPattern)" />
        <rect
          x="35"
          y="35"
          width={SVG_WIDTH - 70}
          height={SVG_HEIGHT - 70}
          fill="#ffffff"
          stroke="#cbd5e1"
          strokeWidth="2.5"
          rx="18"
        />

        {floorplanImageUrl && (
          <g
            transform={`translate(${SVG_WIDTH / 2 + (calib.offsetX || 0)}, ${SVG_HEIGHT / 2 + (calib.offsetY || 0)}) rotate(${calib.rotation || 0}) scale(${calib.scale || 1.0}) translate(${-SVG_WIDTH / 2}, ${-SVG_HEIGHT / 2})`}
          >
            <image
              href={floorplanImageUrl}
              x="35"
              y="35"
              width={SVG_WIDTH - 70}
              height={SVG_HEIGHT - 70}
              preserveAspectRatio="none"
              opacity="1.0"
            />
          </g>
        )}

        {/* ---- WAYFINDING EDGES (corridor connections) ---- */}
        {activeWayfinding?.edges &&
          Object.keys(activeWayfinding.edges).map((sourceName) => {
            const sourceNode = activeWayfinding.nodes.find(
              (n) => (n.name || n.id) === sourceName,
            );
            if (!sourceNode) return null;
            const sX = sourceNode.position?.x ?? sourceNode.x;
            const sY = sourceNode.position?.y ?? sourceNode.y;
            if (sX === undefined || sY === undefined) return null;
            const sourcePos = transformCoords(sX, sY);

            const targets = activeWayfinding.edges[sourceName];
            return Object.keys(targets).map((targetName) => {
              const targetNode = activeWayfinding.nodes.find(
                (n) => (n.name || n.id) === targetName,
              );
              if (!targetNode) return null;
              const targetPos = transformCoords(
                targetNode.position.x,
                targetNode.position.y,
              );
              // Avoid duplicate lines (only draw if source < target alphabetically)
              if (sourceName > targetName) return null;
              return (
                <line
                  key={`${sourceName}-${targetName}`}
                  x1={sourcePos.svgX}
                  y1={sourcePos.svgY}
                  x2={targetPos.svgX}
                  y2={targetPos.svgY}
                  stroke="#0284c7"
                  strokeWidth="1.0"
                  strokeDasharray="2.5 2.5"
                  opacity="0.65"
                />
              );
            });
          })}

        {/* ---- WAYFINDING NODES: Small dots (temporary) ---- */}
        {activeWayfinding?.nodes &&
          activeWayfinding.nodes.map((node) => {
            const nodeName = node.name || node.id;
            const posX = node.position?.x ?? node.x;
            const posY = node.position?.y ?? node.y;
            if (posX === undefined || posY === undefined) return null;
            const { svgX, svgY } = transformCoords(posX, posY);
            return (
              <g
                key={nodeName || `${posX}-${posY}`}
                transform={`translate(${svgX}, ${svgY})`}
              >
                {/* Subtle Cyan Halo */}
                <circle r="3.2" fill="#0284c7" opacity="0.25" />
                {/* Dot */}
                <circle
                  r="1.6"
                  fill="#0284c7"
                  stroke="#ffffff"
                  strokeWidth="0.5"
                  className="wayfinding-node"
                />
                {/* Compact Node Name Label */}
                <text
                  x="0"
                  y="-3.2"
                  fill="#0369a1"
                  fontSize="3.2"
                  fontWeight="700"
                  textAnchor="middle"
                  style={{
                    paintOrder: "stroke",
                    stroke: "#ffffff",
                    strokeWidth: "0.8px",
                    userSelect: "none",
                  }}
                >
                  {nodeName}
                </text>
              </g>
            );
          })}

        {/* ---- ROUTE PATH ---- */}
        {floor === "GR" && liveRoutePathD && (
          <g>
            <path
              d={liveRoutePathD}
              fill="none"
              stroke="rgba(0,133,255,0.2)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={liveRoutePathD}
              fill="none"
              stroke="#0085ff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#routeArrow)"
            />
            <path
              d={liveRoutePathD}
              fill="none"
              stroke="#ffffff"
              strokeWidth="0.8"
              strokeDasharray="3 3"
              className="path-animated"
            />
          </g>
        )}

        {floor === "F1" && f1LiveRoutePathD && (
          <g>
            <path
              d={f1LiveRoutePathD}
              fill="none"
              stroke="rgba(0,133,255,0.2)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={f1LiveRoutePathD}
              fill="none"
              stroke="#0085ff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#routeArrow)"
            />
            <path
              d={f1LiveRoutePathD}
              fill="none"
              stroke="#ffffff"
              strokeWidth="0.8"
              strokeDasharray="3 3"
              className="path-animated"
            />
          </g>
        )}


        {/* ---- VISITOR LIVE MARKER ---- */}
        {isLiveFloor && startPos && (
          <g transform={`translate(${startPos.svgX}, ${startPos.svgY})`}>
            <circle
              r="5.5"
              fill="#0085ff"
              opacity="0.22"
              className="ble-pulse-aura"
            />
            {/* Live Blue Location Disc */}
            <circle r="6.5" fill="#0085ff" stroke="#ffffff" strokeWidth="1.5" />
            <circle r="2" fill="#ffffff" />
            {/* Directional Google Maps Arrow pointing to target waypoint */}
            {(destPos || (forwardWaypoints && forwardWaypoints.length > 0)) && (
              <g
                transform={`rotate(${(() => {
                  const nextPt =
                    forwardWaypoints && forwardWaypoints.length > 0
                      ? transformCoords(
                          forwardWaypoints[0].x,
                          forwardWaypoints[0].y,
                        )
                      : destPos;
                  if (!nextPt) return 0;
                  const dx = nextPt.svgX - startPos.svgX;
                  const dy = nextPt.svgY - startPos.svgY;
                  return (Math.atan2(dy, dx) * 180) / Math.PI;
                })()})`}
              >
                <polygon
                  points="7,0 2,-2.2 3.2,0 2,2.2"
                  fill="#0085ff"
                  stroke="#ffffff"
                  strokeWidth="0.5"
                />
              </g>
            )}
          </g>
        )}

        {/* ---- LIFT START PIN (When previewing F1 from GR) ---- */}
        {!isLiveFloor && floor === "F1" && startPos && (
          <g transform={`translate(${startPos.svgX}, ${startPos.svgY})`}>
            <circle
              r="6"
              fill="#0284c7"
              opacity="0.22"
              className="ble-pulse-aura"
            />
            <circle r="3.2" fill="#0284c7" stroke="#ffffff" strokeWidth="0.8" />
            <text
              x="0"
              y="-4.5"
              fill="#0369a1"
              fontSize="2.8"
              fontWeight="800"
              textAnchor="middle"
              style={{
                paintOrder: "stroke",
                stroke: "#ffffff",
                strokeWidth: "0.6px",
              }}
            >
              LIFT
            </text>
          </g>
        )}

        {destPos && (
          <g transform={`translate(${destPos.svgX}, ${destPos.svgY})`}>
            <circle
              r="6"
              fill="#ef4444"
              opacity="0.25"
              className="ble-pulse-aura"
            />
            {/* Inner Red Target Pin Disc */}
            <circle r="7.5" fill="#ef4444" stroke="#ffffff" strokeWidth="1.5" />
            <circle r="3" fill="#ffffff" />
          </g>
        )}

        {/* ---- MIST AP LOCATIONS ---- */}
        {floorAps.map((ap) => {
          const { svgX, svgY } = transformCoords(ap.x, ap.y);
          if (!isFinite(svgX) || !isFinite(svgY)) return null;

          const isConnected =
            connectedAp &&
            (ap.id === connectedAp.id ||
              ap.mac === connectedAp.mac ||
              (ap.x === connectedAp.x && ap.y === connectedAp.y));

          return (
            <g
              key={ap.id || ap.mac || `${ap.x}-${ap.y}`}
              transform={`translate(${svgX}, ${svgY})`}
              className={`mist-ap-marker ${isConnected ? "mist-ap-marker--connected" : ""}`}
              style={{ pointerEvents: "auto" }}
            >
              <circle
                r={svgRadius3m}
                fill={
                  isConnected
                    ? "rgba(0, 0, 0, 0.05)"
                    : "rgba(85, 107, 47, 0.03)"
                }
                stroke={isConnected ? "#000000" : "#556b2f"}
                strokeOpacity={isConnected ? 0.3 : 0.15}
                strokeWidth={isConnected ? 1.2 : 0.8}
                strokeDasharray={isConnected ? "4 3" : "2 3"}
                className={`mist-radius-3m-circle ${isConnected ? "mist-radius-3m-circle--connected" : ""}`}
                style={{ pointerEvents: "none" }}
              />

              {isConnected && (
                <text
                  x="0"
                  y={svgRadius3m + 3}
                  fill="#000000"
                  fontSize="2.2"
                  fontWeight="700"
                  textAnchor="middle"
                  opacity="0.6"
                  style={{
                    paintOrder: "stroke",
                    stroke: "#ffffff",
                    strokeWidth: "0.5px",
                    userSelect: "none",
                  }}
                >
                  3m Zone
                </text>
              )}

              <circle
                r={isConnected ? "3" : "2"}
                fill="#556b2f"
                opacity={isConnected ? "0.4" : "0.25"}
              />
              <circle
                r={isConnected ? "1.6" : "1.2"}
                fill={isConnected ? "#4d7c0f" : "#6b8e23"}
                stroke="#ffffff"
                strokeWidth={isConnected ? "0.6" : "0.4"}
              />

              <text
                x="0"
                y="-2.5"
                fill="#365314"
                fontSize="2.5"
                fontWeight="700"
                textAnchor="middle"
                style={{
                  paintOrder: "stroke",
                  stroke: "#ffffff",
                  strokeWidth: "0.6px",
                  userSelect: "none",
                }}
              >
                {ap.name?.replace(/^MB3-F\d+-/, "") || ap.name || ap.mac}
              </text>
              <title>{`${ap.name || "AP"} (${ap.mac || ""})${isConnected ? " [CONNECTED MIST]" : ""}\nModel: ${ap.model || "AP33"}\nCoords: (${Math.round(ap.x)}, ${Math.round(ap.y)})`}</title>
            </g>
          );
        })}
      </svg>

      <div className="map-zoom-controls">
        <button
          onClick={handleZoomIn}
          className="floor-btn-stack inactive map-zoom-btn"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={handleZoomOut}
          className="floor-btn-stack inactive map-zoom-btn"
        >
          <ZoomOut size={16} />
        </button>
        <button
          onClick={handleResetZoom}
          className="floor-btn-stack inactive map-zoom-btn"
        >
          <Maximize2 size={14} />
        </button>
      </div>

      <div className="floor-switcher-stack">
        <button
          onClick={() => onFloorChange("F1")}
          className={`floor-btn-stack ${floor === "F1" ? "active" : "inactive"}`}
        >
          F1
        </button>
        <button
          onClick={() => onFloorChange("GR")}
          className={`floor-btn-stack ${floor === "GR" ? "active" : "inactive"}`}
        >
          GR
        </button>
      </div>
    </div>
  );
}
