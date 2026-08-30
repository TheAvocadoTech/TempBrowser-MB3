// src/components/MapView2D.js
import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

export const FLOORPLAN_CALIBRATION = {
  GR: { rotation: 0, scale: 0.9, offsetX: -15, offsetY: 0 },
  F1: { rotation: 0, scale: 0.9, offsetX: -12, offsetY: 0 },
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

const SVG_WIDTH = 900;
const SVG_HEIGHT = 600;

export default function MapView2D({
  floor,
  tagFloor = "GR",
  onFloorChange,
  mapDetails,
  bleLocation,
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
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [renderedPdfImage, setRenderedPdfImage] = useState({
    GR: null,
    F1: null,
  });
  const renderedPdfImageRef = useRef({ GR: null, F1: null });
  const containerRef = useRef(null);

  const activeFloorData = floorMapData?.[floor] || {};
  const activeMapMeta = activeFloorData.mapMeta || mapDetails;
  const rawWayfinding = activeFloorData.wayfindingData || wayfindingData;
  const activeWayfinding = useMemo(() => {
    if (!rawWayfinding) return null;
    const nodes =
      rawWayfinding.nodes ||
      rawWayfinding.wayfinding_path?.nodes ||
      rawWayfinding.data?.nodes ||
      [];
    let edges =
      rawWayfinding.edges ||
      rawWayfinding.wayfinding_path?.edges ||
      rawWayfinding.data?.edges ||
      {};

    if (Object.keys(edges).length === 0 && nodes.length > 0) {
      const extracted = {};
      nodes.forEach((n) => {
        if (n.edges) extracted[n.name] = n.edges;
      });
      edges = extracted;
    }
    return { nodes, edges };
  }, [rawWayfinding]);
  const mapWidth = activeMapMeta?.width || 6400;
  const mapHeight = activeMapMeta?.height || 5120;
  const ppm = activeMapMeta?.ppm || 50.07391564392213;
  const calib = FLOORPLAN_CALIBRATION[floor] || FLOORPLAN_CALIBRATION.GR;

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

  const isLiveFloor = floor === tagFloor;

  // Resolve lift coordinates for GR (midpoint of N12 & N7)
  const grLiftPos = useMemo(() => {
    const grWf =
      floorMapData?.GR?.wayfindingData ||
      (floor === "GR" ? activeWayfinding : null);
    const grNodes = grWf?.nodes || [];
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
  }, [floorMapData, floor, activeWayfinding]);

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
    // If viewing F1 while tag is in GR, navigation starts from the F1 Lift (between N48 and N45)
    if (!isLiveFloor && floor === "F1") {
      return f1LiftPos;
    }

    let rawX = bleLocation?.x;
    let rawY = bleLocation?.y;

    if (bleLocation?.x_m != null && (rawX == null || rawX < 300)) {
      rawX = bleLocation.x_m * ppm;
    }
    if (bleLocation?.y_m != null && (rawY == null || rawY < 300)) {
      rawY = bleLocation.y_m * ppm;
    }

    if (rawX == null || isNaN(rawX)) rawX = liftPos.x;
    if (rawY == null || isNaN(rawY)) rawY = liftPos.y;

    return { x: rawX, y: rawY };
  }, [isLiveFloor, floor, bleLocation, ppm, liftPos, f1LiftPos]);

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

  const backendWaypoints = useMemo(() => {
    if (floor === "GR") {
      return calculateDijkstraPath(
        activeWayfinding?.nodes || [],
        activeWayfinding?.edges || {},
        rawStartPos,
        effectiveTargetPos,
      );
    }

    // On F1: if not on live floor (previewing from GR), route starts from F1 Lift (N48 & N45 midpoint) to Target Cabinet
    if (floor === "F1" && !isLiveFloor) {
      return calculateDijkstraPath(
        activeWayfinding?.nodes || [],
        activeWayfinding?.edges || {},
        f1LiftPos,
        effectiveTargetPos,
      );
    }

    // On F1 and live floor
    const rawWaypoints =
      activeRoute?.waypoints || activeRoute?.nodes || activeRoute?.path;
    const extracted = extractWaypoints(rawWaypoints);
    if (extracted.length === 0 && effectiveTargetPos) {
      return calculateDijkstraPath(
        activeWayfinding?.nodes || [],
        activeWayfinding?.edges || {},
        rawStartPos,
        effectiveTargetPos,
      );
    }
    return extracted;
  }, [
    floor,
    isLiveFloor,
    f1LiftPos,
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

    // Find closest waypoint ahead of startPos
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
    return points.reduce(
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

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.35, 5.0));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.35, 0.7));
  const handleResetZoom = () => {
    setZoom(3.2);
    setPan({ x: -320, y: 0 });
  };
  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const handleMouseUp = () => setIsDragging(false);

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
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          cursor: isDragging ? "grabbing" : "grab",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: isDragging
            ? "none"
            : "transform 0.2s cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        <defs>
          <marker
            id="routeArrow"
            markerWidth="3"
            markerHeight="3"
            refX="2"
            refY="1.5"
            orient="auto"
          >
            <path d="M 0 0 L 3 1.5 L 0 3 z" fill="#0085ff" />
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
              (n) => n.name === sourceName,
            );
            if (!sourceNode) return null;
            const sourcePos = transformCoords(
              sourceNode.position.x,
              sourceNode.position.y,
            );
            const targets = activeWayfinding.edges[sourceName];
            return Object.keys(targets).map((targetName) => {
              const targetNode = activeWayfinding.nodes.find(
                (n) => n.name === targetName,
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
                  stroke="#94a3b8"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                  opacity="0.65"
                />
              );
            });
          })}

        {/* ---- WAYFINDING NODES: Small dots (temporary) ---- */}
        {activeWayfinding?.nodes &&
          activeWayfinding.nodes.map((node) => {
            if (!node.position) return null;
            const { svgX, svgY } = transformCoords(
              node.position.x,
              node.position.y,
            );
            return (
              <g key={node.name} transform={`translate(${svgX}, ${svgY})`}>
                <circle
                  r="3.5"
                  fill="#0ea5e9"
                  stroke="#ffffff"
                  strokeWidth="1"
                  className="wayfinding-node"
                />
                <text
                  x="0"
                  y="-10"
                  fill="#0f172a"
                  fontSize="8"
                  fontWeight="700"
                  textAnchor="middle"
                  style={{
                    paintOrder: "stroke",
                    stroke: "#ffffff",
                    strokeWidth: "2px",
                  }}
                >
                  {node.name}
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
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={liveRoutePathD}
              fill="none"
              stroke="#0085ff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#routeArrow)"
            />
            <path
              d={liveRoutePathD}
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.2"
              strokeDasharray="4 4"
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
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={f1LiveRoutePathD}
              fill="none"
              stroke="#0085ff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#routeArrow)"
            />
            <path
              d={f1LiveRoutePathD}
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.2"
              strokeDasharray="4 4"
              className="path-animated"
            />
          </g>
        )}

        {/* ---- VISITOR LIVE MARKER (Rendered ONLY on the visitor's current live floor) ---- */}
        {isLiveFloor && startPos && (
          <g transform={`translate(${startPos.svgX}, ${startPos.svgY})`}>
            {/* Outer Pulsing Aura */}
            <circle
              r="12"
              fill="#0085ff"
              opacity="0.25"
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
                  points="14,0 4,-5 6,0 4,5"
                  fill="#0085ff"
                  stroke="#ffffff"
                  strokeWidth="1"
                />
              </g>
            )}
          </g>
        )}

        {/* ---- LIFT START PIN (When previewing F1 from GR) ---- */}
        {!isLiveFloor && floor === "F1" && startPos && (
          <g transform={`translate(${startPos.svgX}, ${startPos.svgY})`}>
            <circle
              r="12"
              fill="#0284c7"
              opacity="0.25"
              className="ble-pulse-aura"
            />
            <circle r="7" fill="#0284c7" stroke="#ffffff" strokeWidth="1.5" />
            <text
              x="0"
              y="-12"
              fill="#0369a1"
              fontSize="9"
              fontWeight="800"
              textAnchor="middle"
              style={{
                paintOrder: "stroke",
                stroke: "#ffffff",
                strokeWidth: "2px",
              }}
            >
              LIFT
            </text>
          </g>
        )}

        {destPos && (
          <g transform={`translate(${destPos.svgX}, ${destPos.svgY})`}>
            {/* Outer Red Target Halo */}
            <circle
              r="14"
              fill="#ef4444"
              opacity="0.28"
              className="ble-pulse-aura"
            />
            {/* Inner Red Target Pin Disc */}
            <circle r="7.5" fill="#ef4444" stroke="#ffffff" strokeWidth="1.5" />
            <circle r="3" fill="#ffffff" />
          </g>
        )}

        {assets.map((asset) => {
          if (asset.map_id !== activeMapMeta?.id) return null;
          const pixelX = asset.position.x_m * ppm;
          const pixelY = asset.position.y_m * ppm;
          const { svgX, svgY } = transformCoords(pixelX, pixelY);
          if (!isFinite(svgX) || !isFinite(svgY)) return null;
          return (
            <g key={asset.mac} transform={`translate(${svgX}, ${svgY})`}>
              <circle
                r="5"
                fill="#f59e0b"
                stroke="#ffffff"
                strokeWidth="1.5"
                opacity="0.85"
              />
              <title>{asset.device_name || asset.mac}</title>
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
