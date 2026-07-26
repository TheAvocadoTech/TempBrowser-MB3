import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import {
  LIFT_COORDINATES,
  F1_LIFT_COORDINATES,
  CABINET_COORDINATES,
  TEMP_DOT_COORDINATES,
  GR_PROPOSED_START_COORDINATES,
} from "../constants";

/**
 * 🎯 2D FLOORPLAN BACKGROUND ALIGNMENT CONFIGURATION (Per Floor)
 * Adjust these values to align your PDF/PNG floor plan image directly underneath the wayfinding graph nodes & paths:
 * - rotation: Angle in degrees (e.g. 0, 90, 180, 270)
 * - scale: Image scale multiplier (1.0 = default fit)
 * - offsetX: Shift image left (-) or right (+) in SVG pixels
 * - offsetY: Shift image up (-) or down (+) in SVG pixels
 */
export const FLOORPLAN_CALIBRATION = {
  GR: {
    rotation: 0, // Degrees (0, 90, 180, 270)
    scale: 0.9, // Scale multiplier (1.0 = default fit)
    offsetX: -15, // Shift X in SVG pixels
    offsetY: 0, // Shift Y in SVG pixels
  },
  F1: {
    rotation: 0, // Degrees (0, 90, 180, 270)
    scale: 0.9, // Scale multiplier (1.0 = default fit)
    offsetX: -12, // Shift X in SVG pixels
    offsetY: 0, // Shift Y in SVG pixels
  },
};

/**
 * Extract waypoints from backend route structures (nodes, waypoints, path arrays/objects)
 */
function extractWaypoints(rawRoute) {
  if (!rawRoute) return [];

  let list = [];
  if (Array.isArray(rawRoute)) {
    list = rawRoute;
  } else if (rawRoute.nodes && Array.isArray(rawRoute.nodes)) {
    list = rawRoute.nodes;
  } else if (rawRoute.waypoints && Array.isArray(rawRoute.waypoints)) {
    list = rawRoute.waypoints;
  } else if (rawRoute.path && Array.isArray(rawRoute.path)) {
    list = rawRoute.path;
  } else if (typeof rawRoute === "object") {
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

/**
 * Robust helper to extract and normalize wayfinding nodes from Array or Object structures
 */
function normalizeGraphNodes(rawNodes) {
  if (!rawNodes) return [];
  let list = [];
  if (Array.isArray(rawNodes)) {
    list = rawNodes;
  } else if (typeof rawNodes === "object") {
    list = Object.keys(rawNodes).map((key) => {
      const item = rawNodes[key];
      return {
        name: item.name || item.id || key,
        ...item,
      };
    });
  }

  return list
    .map((item, idx) => {
      const name = item.name || item.id || `N${idx + 1}`;
      let posX, posY;
      if (
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

      return {
        name,
        position:
          posX !== undefined &&
          !isNaN(posX) &&
          posY !== undefined &&
          !isNaN(posY)
            ? { x: posX, y: posY }
            : null,
        edges: item.edges || item.connections || {},
      };
    })
    .filter((n) => n.position !== null);
}

export default function MapView2D({
  floor,
  onFloorChange,
  mapDetails,
  bleLocation,
  targetCoordinates,
  wayfindingData,
  floorMapData,
  activeRoute,
  distance,
  proximity,
}) {
  // Zoomed-in to 3.2x and panned -320px left to hide unused white area and show the right map edge
  const [zoom, setZoom] = useState(3.2);
  const [pan, setPan] = useState({ x: -320, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [renderedPdfImage, setRenderedPdfImage] = useState({
    GR: null,
    F1: null,
  });
  const containerRef = useRef(null);

  // SVG Viewport canvas size
  const SVG_WIDTH = 900;
  const SVG_HEIGHT = 600;

  // Active Floor Map Details & Wayfinding Data
  const activeFloorData = floorMapData?.[floor] || {};
  const activeMapMeta = activeFloorData.mapMeta || mapDetails;
  const activeWayfinding = activeFloorData.wayfindingData || wayfindingData;

  // Real Map Dimensions from Mist API (e.g. width: 6400, height: 5120)
  const mapWidth = activeMapMeta?.width || 6400;
  const mapHeight = activeMapMeta?.height || 5120;

  // Pixels Per Meter (PPM) resolution from Mist API map metadata per floor
  const ppm = activeMapMeta?.ppm || (floor === "GR" ? 50.07 : 57.28);

  // Calibration settings for current floor (GR or F1)
  const calib = FLOORPLAN_CALIBRATION[floor] || FLOORPLAN_CALIBRATION.GR;

  // Log Live BLE Coordinates on update
  useEffect(() => {
    if (bleLocation?.x !== undefined && bleLocation?.y !== undefined) {
      console.log(
        `📍 [MapView2D] Live BLE Location Coordinates: X = ${bleLocation.x}, Y = ${bleLocation.y}`,
        bleLocation,
      );
    }
  }, [bleLocation]);

  // Dynamically load PDF.js engine and auto-render /floorplans/GR.pdf or /floorplans/F1.pdf
  useEffect(() => {
    const loadPdfEngineAndRender = async () => {
      // 1. Ensure PDF.js is loaded
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

      // 2. Auto-fetch and render PDF from /floorplans/GR.pdf or /floorplans/F1.pdf
      if (window.pdfjsLib && !renderedPdfImage[floor]) {
        const pdfPath = `/floorplans/${floor}.pdf`;
        try {
          console.log(`📄 Auto-rendering floorplan PDF: ${pdfPath}`);
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

          setRenderedPdfImage((prev) => ({ ...prev, [floor]: pngDataUrl }));
          console.log(
            `✅ Rendered ${floor}.pdf into high-res background image!`,
          );
        } catch (err) {
          console.warn(
            `Could not load ${pdfPath}, checking image fallbacks:`,
            err.message,
          );
        }
      }
    };

    loadPdfEngineAndRender();
  }, [floor, renderedPdfImage]);

  // Floorplan image URL priority: Rendered PDF Data URL -> Mist API URL -> Local PNG fallback
  const floorplanImageUrl = useMemo(() => {
    if (renderedPdfImage[floor]) return renderedPdfImage[floor];
    if (activeMapMeta?.url) return activeMapMeta.url;
    if (activeMapMeta?.image_url) return activeMapMeta.image_url;
    return floor === "GR" ? "/floorplans/GR.png" : "/floorplans/F1.png";
  }, [renderedPdfImage, floor, activeMapMeta]);

  // Calculate distance in meters
  const distanceInMeters = useMemo(() => {
    if (typeof distance !== "number" || isNaN(distance) || distance <= 0)
      return null;
    return (distance / ppm).toFixed(1);
  }, [distance, ppm]);

  /**
   * 🎯 UNIFORM 1:1 ASPECT RATIO COORDINATE CONVERTER
   * Converts real-world Mist map coordinates (x, y) into SVG ViewBox coordinates
   * maintaining exact 1:1 aspect ratio with zero spatial distortion.
   */
  const transformCoords = useCallback(
    (x, y) => {
      if (x === undefined || y === undefined || x === null || y === null) {
        return { svgX: SVG_WIDTH / 2, svgY: SVG_HEIGHT / 2 };
      }
      const padding = 50;
      const scaleX = (SVG_WIDTH - padding * 2) / mapWidth;
      const scaleY = (SVG_HEIGHT - padding * 2) / mapHeight;

      // Uniform scale factor to prevent non-proportional stretching
      const scale = Math.min(scaleX, scaleY);

      // Centered offsets
      const offsetX = (SVG_WIDTH - mapWidth * scale) / 2;
      const offsetY = (SVG_HEIGHT - mapHeight * scale) / 2;

      const svgX = offsetX + x * scale;
      const svgY = offsetY + y * scale;

      return { svgX, svgY };
    },
    [mapWidth, mapHeight, SVG_WIDTH, SVG_HEIGHT],
  );

  // Live BLE Tag SVG Coordinates
  const blePos = useMemo(() => {
    const rawX = bleLocation?.x ?? 5004.59;
    const rawY = bleLocation?.y ?? 2313.4;
    return transformCoords(rawX, rawY);
  }, [bleLocation, transformCoords]);

  // Start Point SVG Coordinates: Live BLE for GR, F1_LIFT_COORDINATES for F1
  const startPos = useMemo(() => {
    if (floor === "F1") {
      // On F1 floor, path starts from F1 Lift constant
      return transformCoords(F1_LIFT_COORDINATES.x, F1_LIFT_COORDINATES.y);
    } else {
      // On GR floor, path starts from Live BLE location
      const rawX = bleLocation?.x ?? 5004.59;
      const rawY = bleLocation?.y ?? 2313.4;
      return transformCoords(rawX, rawY);
    }
  }, [floor, bleLocation, transformCoords]);

  // Target Destination SVG Coordinates according to active floor
  const destPos = useMemo(() => {
    if (floor === "GR") {
      return transformCoords(LIFT_COORDINATES.x, LIFT_COORDINATES.y);
    } else {
      // Hardcoded Cabinet coordinates for F1:
      return transformCoords(CABINET_COORDINATES.x, CABINET_COORDINATES.y);
    }
  }, [floor, transformCoords]);

  // Temp Dot SVG Coordinates for F1
  const tempDotPos = useMemo(() => {
    return transformCoords(TEMP_DOT_COORDINATES.x, TEMP_DOT_COORDINATES.y);
  }, [transformCoords]);

  // Extract Backend Waypoints array for Live Route
  const backendWaypoints = useMemo(() => {
    const rawWaypoints =
      activeRoute?.waypoints ||
      activeRoute?.nodes ||
      activeRoute?.path ||
      activeWayfinding?.route_to_destination?.waypoints ||
      activeWayfinding?.route_to_destination?.nodes ||
      activeWayfinding?.route?.waypoints ||
      activeWayfinding?.route?.nodes;

    return extractWaypoints(rawWaypoints);
  }, [activeRoute, activeWayfinding]);

  // Extract ALL Real Wayfinding Nodes strictly for the active floor
  const allGraphNodes = useMemo(() => {
    const rawNodes =
      activeWayfinding?.wayfinding_path?.nodes ||
      activeWayfinding?.nodes ||
      activeMapMeta?.wayfinding_path?.nodes ||
      activeMapMeta?.nodes;

    return normalizeGraphNodes(rawNodes);
  }, [activeWayfinding, activeMapMeta]);

  // N48 Node position lookup for F1
  const n48NodePos = useMemo(() => {
    const node = allGraphNodes.find(
      (n) => n.name && (n.name.toUpperCase() === "N48" || n.name === "48"),
    );
    if (node && node.position) return node.position;
    return { x: 5454.1586, y: 1711.6878 }; // F1 N48 node coordinates from Mist API
  }, [allGraphNodes]);

  // Static/Reference Path String (Lift -> N48 -> Temp Dot -> Cabinet on F1; Live BLE -> Waypoints -> Lift on GR)
  const routePathD = useMemo(() => {
    const points = [];

    if (floor === "F1") {
      // F1 Reference Path Sequence: F1 Lift -> N48 -> Temp Dot -> Cabinet
      if (startPos) points.push(startPos); // 1. F1 Lift

      if (n48NodePos) {
        points.push(transformCoords(n48NodePos.x, n48NodePos.y)); // 2. Node N48
      }

      if (tempDotPos) points.push(tempDotPos); // 3. Temp Dot

      if (destPos) points.push(destPos); // 4. Cabinet
    } else {
      // GR Path Sequence: Live BLE -> Backend Waypoints -> GR Lift
      if (startPos) points.push(startPos);

      if (backendWaypoints && backendWaypoints.length > 0) {
        backendWaypoints.forEach((pt) => {
          points.push(transformCoords(pt.x, pt.y));
        });
      }

      if (destPos) points.push(destPos);
    }

    if (points.length < 2) return "";

    return points.reduce((acc, pt, idx) => {
      return idx === 0
        ? `M ${pt.svgX} ${pt.svgY}`
        : `${acc} L ${pt.svgX} ${pt.svgY}`;
    }, "");
  }, [
    floor,
    startPos,
    n48NodePos,
    tempDotPos,
    destPos,
    backendWaypoints,
    transformCoords,
  ]);

  // F1 Live Animated Blue Path (Live BLE Location -> Backend Waypoints -> Cabinet Target)
  const f1LiveRoutePathD = useMemo(() => {
    if (floor !== "F1") return "";

    const points = [];

    // 1. Live BLE Start Point
    if (blePos) points.push(blePos);

    // 2. Exact Backend Waypoints from API
    if (backendWaypoints && backendWaypoints.length > 0) {
      backendWaypoints.forEach((pt) => {
        points.push(transformCoords(pt.x, pt.y));
      });
    }

    // 3. Cabinet Target Destination
    if (destPos) points.push(destPos);

    if (points.length < 2) return "";

    return points.reduce((acc, pt, idx) => {
      return idx === 0
        ? `M ${pt.svgX} ${pt.svgY}`
        : `${acc} L ${pt.svgX} ${pt.svgY}`;
    }, "");
  }, [floor, blePos, backendWaypoints, destPos, transformCoords]);

  // SVG Proposed Ground Floor Route Path String (Light Blue)
  // Sequence: Proposed Start Point (right of N9) -> N9 -> N13 -> Lift
  const proposedRoutePathD = useMemo(() => {
    if (floor !== "GR") return "";

    const points = [];

    // 1. Proposed Start Point (right of N9)
    const proposedStartPt = transformCoords(
      GR_PROPOSED_START_COORDINATES.x,
      GR_PROPOSED_START_COORDINATES.y,
    );
    points.push(proposedStartPt);

    // 2. N9 Node
    const n9Node = allGraphNodes.find(
      (n) => n.name && (n.name.toUpperCase() === "N9" || n.name === "9"),
    );
    if (n9Node && n9Node.position) {
      points.push(transformCoords(n9Node.position.x, n9Node.position.y));
    } else {
      points.push(transformCoords(5854.67, 3646.69));
    }

    // 3. N13 Node
    const n13Node = allGraphNodes.find(
      (n) => n.name && (n.name.toUpperCase() === "N13" || n.name === "13"),
    );
    if (n13Node && n13Node.position) {
      points.push(transformCoords(n13Node.position.x, n13Node.position.y));
    } else {
      points.push(transformCoords(6362.34, 3470.36));
    }

    // 4. GR Lift Target
    if (destPos) {
      points.push(destPos);
    }

    if (points.length < 2) return "";

    return points.reduce((acc, pt, idx) => {
      return idx === 0
        ? `M ${pt.svgX} ${pt.svgY}`
        : `${acc} L ${pt.svgX} ${pt.svgY}`;
    }, "");
  }, [floor, allGraphNodes, destPos, transformCoords]);

  // Build Edge Lines Array for full graph mesh rendering
  const fullEdgeLines = useMemo(() => {
    if (!allGraphNodes || allGraphNodes.length === 0) return [];

    const nodeMap = new Map();
    allGraphNodes.forEach((node) => {
      if (node.name && node.position) {
        nodeMap.set(
          node.name,
          transformCoords(node.position.x, node.position.y),
        );
      }
    });

    const lines = [];
    const drawn = new Set();

    allGraphNodes.forEach((node) => {
      const sourceName = node.name;
      const sourcePt = nodeMap.get(sourceName);
      if (sourcePt && node.edges) {
        Object.keys(node.edges).forEach((targetName) => {
          const targetPt = nodeMap.get(targetName);
          const edgeKey = [sourceName, targetName].sort().join("---");
          if (targetPt && !drawn.has(edgeKey)) {
            drawn.add(edgeKey);
            lines.push({
              x1: sourcePt.svgX,
              y1: sourcePt.svgY,
              x2: targetPt.svgX,
              y2: targetPt.svgY,
              key: edgeKey,
            });
          }
        });
      }
    });

    const globalEdges =
      activeWayfinding?.edges || activeMapMeta?.wayfinding_path?.edges;
    if (globalEdges && typeof globalEdges === "object") {
      Object.keys(globalEdges).forEach((sourceName) => {
        const targets = globalEdges[sourceName];
        const sourcePt = nodeMap.get(sourceName);
        if (sourcePt && targets) {
          Object.keys(targets).forEach((targetName) => {
            const targetPt = nodeMap.get(targetName);
            const edgeKey = [sourceName, targetName].sort().join("---");
            if (targetPt && !drawn.has(edgeKey)) {
              drawn.add(edgeKey);
              lines.push({
                x1: sourcePt.svgX,
                y1: sourcePt.svgY,
                x2: targetPt.svgX,
                y2: targetPt.svgY,
                key: edgeKey,
              });
            }
          });
        }
      });
    }

    return lines;
  }, [allGraphNodes, activeWayfinding, activeMapMeta, transformCoords]);

  // Zoom / Pan Handlers
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
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
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
      {/* Live Navigation Status Badge (Top Left) */}
      <div className="nav-status-badge">
        <span className="nav-icon-dot"></span>
        <div className="nav-badge-texts">
          <span className="nav-badge-title">
            {proximity || "Live Tracking Active"}
          </span>
          <span className="nav-badge-subtitle">
            {distanceInMeters !== null
              ? `${distanceInMeters} m to Target`
              : "Updating Location..."}
          </span>
        </div>
      </div>

      {/* Centered 2D Interactive SVG Map */}
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
          {/* Small sleek arrow head marker */}
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

          {/* Light Blue arrow head marker for proposed path */}
          <marker
            id="proposedRouteArrow"
            markerWidth="3"
            markerHeight="3"
            refX="2"
            refY="1.5"
            orient="auto"
          >
            <path d="M 0 0 L 3 1.5 L 0 3 z" fill="#062835" />
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

        {/* 1. Base Canvas */}
        <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="#f1f5f9" />
        <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#gridPattern)" />

        {/* Floorplan Outer Perimeter */}
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

        {/* 2. 🖼️ BACKGROUND FLOORPLAN PDF/IMAGE LAYER (With 2D Rotation, Scale, and Offset Calibration) */}
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

        {/* 3. Graph Corridor Connection Lines (Commented out for clean visual map) */}
        {/* {fullEdgeLines.map((edge) => (
          <line
            key={edge.key}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke="#64748b"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        ))} */}

        {/* 4. Graph Wayfinding Nodes (Commented out for clean visual map) */}
        {/* {allGraphNodes.map((node, idx) => {
          if (!node.position) return null;
          const { svgX, svgY } = transformCoords(
            node.position.x,
            node.position.y,
          );
          return (
            <g key={node.name || idx}>
              <circle
                r="4"
                cx={svgX}
                cy={svgY}
                fill="#334155"
                stroke="#ffffff"
                strokeWidth="1.2"
              />
              {node.name && (
                <text
                  x={svgX}
                  y={svgY + 12}
                  fill="#1e293b"
                  fontSize="8"
                  fontWeight="800"
                  textAnchor="middle"
                >
                  {node.name}
                </text>
              )}
            </g>
          );
        })} */}

        {/* Temp Dot Marker on F1 */}
        {floor === "F1" && tempDotPos && (
          <g transform={`translate(${tempDotPos.svgX}, ${tempDotPos.svgY})`}>
            <circle r="4" fill="#0085ff" stroke="#ffffff" strokeWidth="1.2" />
          </g>
        )}

        {/* Proposed Start Dot on GR */}
        {floor === "GR" && (
          <g
            transform={`translate(${transformCoords(GR_PROPOSED_START_COORDINATES.x, GR_PROPOSED_START_COORDINATES.y).svgX}, ${transformCoords(GR_PROPOSED_START_COORDINATES.x, GR_PROPOSED_START_COORDINATES.y).svgY})`}
          >
            <circle
              r="6"
              fill="#38bdf8"
              opacity="0.4"
              className="ble-pulse-aura"
            />
            <circle r="4" fill="#38bdf8" stroke="#ffffff" strokeWidth="0.8" />
          </g>
        )}

        {/* Proposed Light Blue Future Path on Ground Floor */}
        {floor === "GR" && proposedRoutePathD && (
          <g>
            <path
              d={proposedRoutePathD}
              fill="none"
              stroke="rgba(56, 189, 248, 0.25)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={proposedRoutePathD}
              fill="none"
              stroke="#062835"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="6 6"
              markerEnd="url(#proposedRouteArrow)"
            />
          </g>
        )}

        {/* 5. Static / Hardcoded Map Reference Path */}
        {routePathD && (
          <g>
            {floor === "F1" ? (
              // F1 Static Path Style: Black Dotted Hardcoded Map Style
              <g>
                <path
                  d={routePathD}
                  fill="none"
                  stroke="rgba(6, 40, 53, 0.25)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={routePathD}
                  fill="none"
                  stroke="#062835"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="6 6"
                  markerEnd="url(#proposedRouteArrow)"
                />
              </g>
            ) : (
              // GR Active Navigation Route Style: Animated Blue Path
              <g>
                <path
                  d={routePathD}
                  fill="none"
                  stroke="rgba(0, 133, 255, 0.2)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={routePathD}
                  fill="none"
                  stroke="#0085ff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  markerEnd="url(#routeArrow)"
                />
                <path
                  d={routePathD}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeDasharray="4 4"
                  className="path-animated"
                />
              </g>
            )}
          </g>
        )}

        {/* 6. Live Animated Blue Path on F1 (Live BLE Location -> Backend Waypoints -> Cabinet) */}
        {floor === "F1" && f1LiveRoutePathD && (
          <g>
            <path
              d={f1LiveRoutePathD}
              fill="none"
              stroke="rgba(0, 133, 255, 0.2)"
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
              strokeLinecap="round"
              strokeDasharray="4 4"
              className="path-animated"
            />
          </g>
        )}

        {/* 7. LIVE BLE LOCATION MARKER (Active on both GR & F1 floors) */}
        {blePos && (
          <g transform={`translate(${blePos.svgX}, ${blePos.svgY})`}>
            <circle
              r="6"
              fill="#0085ff"
              opacity="0.3"
              className="ble-pulse-aura"
            />
            <circle r="4" fill="#0085ff" stroke="#ffffff" strokeWidth="0.5" />
            <circle r="1" fill="#ffffff" />
          </g>
        )}

        {/* 8. TARGET & START DESTINATION MARKERS FOR ACTIVE FLOOR */}
        {destPos && (
          <g>
            {floor === "GR" ? (
              // GR Floor: Lift Target
              <g transform={`translate(${destPos.svgX}, ${destPos.svgY})`}>
                <circle
                  r="8"
                  fill="#9333ea"
                  opacity="0.25"
                  className="ble-pulse-aura"
                />
                <circle
                  r="5"
                  fill="#9333ea"
                  stroke="#ffffff"
                  strokeWidth="0.5"
                />
                <text
                  x="0"
                  y="2.5"
                  fill="#ffffff"
                  fontSize="7.5"
                  fontWeight="500"
                  textAnchor="middle"
                >
                  🛗
                </text>
              </g>
            ) : (
              // F1 Floor: Lift (Start) & Cabinet (Destination)
              <g>
                {/* Lift Start Marker on F1 */}
                {startPos && (
                  <g
                    transform={`translate(${startPos.svgX}, ${startPos.svgY})`}
                  >
                    <circle
                      r="8"
                      fill="#9333ea"
                      opacity="0.25"
                      className="ble-pulse-aura"
                    />
                    <circle
                      r="5"
                      fill="#9333ea"
                      stroke="#ffffff"
                      strokeWidth="0.5"
                    />
                    <text
                      x="0"
                      y="2.5"
                      fill="#ffffff"
                      fontSize="7.5"
                      fontWeight="500"
                      textAnchor="middle"
                    >
                      🛗
                    </text>
                  </g>
                )}

                {/* Cabinet Destination Marker on F1 */}
                <g transform={`translate(${destPos.svgX}, ${destPos.svgY})`}>
                  <circle
                    r="8"
                    fill="#ea580c"
                    opacity="0.3"
                    className="ble-pulse-aura"
                  />
                  <circle
                    r="5"
                    fill="#ea580c"
                    stroke="#ffffff"
                    strokeWidth="1"
                  />
                  <circle r="2" fill="#ffffff" />
                </g>
              </g>
            )}
          </g>
        )}
      </svg>

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
