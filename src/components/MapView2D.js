import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { LIFT_COORDINATES, CABINET_COORDINATES } from "../constants";

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
    offsetX: 35, // Shift X in SVG pixels
    offsetY: 0, // Shift Y in SVG pixels
  },
  F1: {
    rotation: 0, // Degrees (0, 90, 180, 270)
    scale: 0.8, // Scale multiplier (1.0 = default fit)
    offsetX: 20, // Shift X in SVG pixels
    offsetY: -10, // Shift Y in SVG pixels
  },
};

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
  activeRoute,
  distance,
  proximity,
}) {
  // Zoomed-in to 3.2x and panned -320px left to hide unused white area and show the right map edge
  const [zoom, setZoom] = useState(3.5);
  const [pan, setPan] = useState({ x: -350, y: 0 });
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

  // Real Map Dimensions from Mist API (e.g. width: 6400, height: 5120)
  const mapWidth = mapDetails?.width || 6400;
  const mapHeight = mapDetails?.height || 5120;

  // Pixels Per Meter (PPM) resolution from Mist API map metadata
  const ppm = mapDetails?.ppm || 50.07;

  // Calibration settings for current floor (GR or F1)
  const calib = FLOORPLAN_CALIBRATION[floor] || FLOORPLAN_CALIBRATION.GR;

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
    if (mapDetails?.url) return mapDetails.url;
    if (mapDetails?.image_url) return mapDetails.image_url;
    return floor === "GR" ? "/floorplans/GR.png" : "/floorplans/F1.png";
  }, [renderedPdfImage, floor, mapDetails]);

  // Calculate distance in meters
  const distanceInMeters = useMemo(() => {
    if (typeof distance !== "number" || isNaN(distance) || distance <= 0)
      return null;
    return (distance / ppm).toFixed(1);
  }, [distance, ppm]);

  /**
   * Convert real-world/Mist coordinates (x, y) to SVG viewBox coordinates
   */
  const transformCoords = useCallback(
    (x, y) => {
      if (x === undefined || y === undefined || x === null || y === null) {
        return { svgX: SVG_WIDTH / 2, svgY: SVG_HEIGHT / 2 };
      }
      const padding = 60;
      const svgX = padding + (x / mapWidth) * (SVG_WIDTH - padding * 2);
      const svgY = padding + (y / mapHeight) * (SVG_HEIGHT - padding * 2);
      return { svgX, svgY };
    },
    [mapWidth, mapHeight, SVG_WIDTH, SVG_HEIGHT],
  );

  // Live BLE Tag SVG Coordinates (Used on GR floor)
  const blePos = useMemo(() => {
    const rawX = bleLocation?.x ?? 5004.59;
    const rawY = bleLocation?.y ?? 2313.4;
    return transformCoords(rawX, rawY);
  }, [bleLocation, transformCoords]);

  // Start Point SVG Coordinates: Live BLE for GR, Lift for F1
  const startPos = useMemo(() => {
    if (floor === "F1") {
      // On F1 floor, path starts from Lift
      return transformCoords(LIFT_COORDINATES.x, LIFT_COORDINATES.y);
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

  // Extract ALL Real Wayfinding Nodes from mapDetails or wayfindingData
  const allGraphNodes = useMemo(() => {
    const rawNodes =
      mapDetails?.wayfinding_path?.nodes ||
      wayfindingData?.wayfinding_path?.nodes ||
      wayfindingData?.nodes;
    return normalizeGraphNodes(rawNodes);
  }, [mapDetails, wayfindingData]);

  // Extract Route Nodes
  const routeNodesList = useMemo(() => {
    const rawRoute =
      activeRoute?.nodes ||
      wayfindingData?.route_to_destination?.nodes ||
      wayfindingData?.route?.nodes;
    return normalizeGraphNodes(rawRoute);
  }, [activeRoute, wayfindingData]);

  // SVG Active Route Path String (Explicitly via N13 -> N9 on F1)
  const routePathD = useMemo(() => {
    const points = [];

    // Path starts at startPos (Live BLE for GR, Lift for F1)
    if (startPos) {
      points.push(startPos);
    }

    if (floor === "F1") {
      // On F1, explicitly route path through N13 -> N9 -> Cabinet
      const n13 = allGraphNodes.find(
        (n) => n.name && n.name.toUpperCase() === "N13",
      );
      const n9 = allGraphNodes.find(
        (n) => n.name && n.name.toUpperCase() === "N9",
      );

      if (n13 && n13.position) {
        points.push(transformCoords(n13.position.x, n13.position.y));
      }
      if (n9 && n9.position) {
        points.push(transformCoords(n9.position.x, n9.position.y));
      }
    } else if (routeNodesList && routeNodesList.length > 0) {
      routeNodesList.forEach((node) => {
        if (node.position) {
          const pt = transformCoords(node.position.x, node.position.y);
          points.push(pt);
        }
      });
    }

    // Path ends at destPos (Lift for GR, Cabinet for F1)
    if (destPos) {
      points.push(destPos);
    }

    if (points.length < 2) return "";

    return points.reduce((acc, pt, idx) => {
      return idx === 0
        ? `M ${pt.svgX} ${pt.svgY}`
        : `${acc} L ${pt.svgX} ${pt.svgY}`;
    }, "");
  }, [
    floor,
    allGraphNodes,
    routeNodesList,
    startPos,
    destPos,
    transformCoords,
  ]);

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
      wayfindingData?.edges || mapDetails?.wayfinding_path?.edges;
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
  }, [allGraphNodes, wayfindingData, mapDetails, transformCoords]);

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

        {/* 3. Graph Corridor Connection Lines */}
        {fullEdgeLines.map((edge) => (
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
        ))}

        {/* 4. Graph Wayfinding Nodes (37 Nodes: N1 through N65) */}
        {allGraphNodes.map((node, idx) => {
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
        })}

        {/* 5. Active Sleek Thin Animated Navigation Route Path */}
        {routePathD && (
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

        {/* 6. LIVE BLE LOCATION MARKER (Active on GR floor only; commented capsule label) */}
        {floor === "GR" && blePos && (
          <g transform={`translate(${blePos.svgX}, ${blePos.svgY})`}>
            <circle
              r="8"
              fill="#0085ff"
              opacity="0.3"
              className="ble-pulse-aura"
            />
            <circle r="5" fill="#0085ff" stroke="#ffffff" strokeWidth="0.5" />
            <circle r="2" fill="#ffffff" />

            {/* Commented out capsule label marking as requested:
            <g transform="translate(0, -26)">
              <rect
                x="-50"
                y="-11"
                width="100"
                height="22"
                rx="11"
                fill="#0085ff"
                stroke="#ffffff"
                strokeWidth="0.5"
              />
              <text
                x="0"
                y="3"
                fill="#ffffff"
                fontSize="10"
                fontWeight="500"
                textAnchor="middle"
              >
                📍 LIVE LOCATION
              </text>
            </g>
            */}
          </g>
        )}

        {/* 7. TARGET & START DESTINATION MARKERS FOR ACTIVE FLOOR */}
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

                {/* Commented out capsule label marking as requested:
                <g transform="translate(0, 20)">
                  <rect
                    x="-50"
                    y="-10"
                    width="100"
                    height="18"
                    rx="9"
                    fill="#9333ea"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  <text
                    x="0"
                    y="3"
                    fill="#ffffff"
                    fontSize="10"
                    fontWeight="500"
                    textAnchor="middle"
                  >
                    🛗 FINAL (LIFT)
                  </text>
                </g>
                */}
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

                    {/* Commented out capsule label marking as requested:
                    <g transform="translate(0, 20)">
                      <rect
                        x="-50"
                        y="-10"
                        width="100"
                        height="18"
                        rx="9"
                        fill="#9333ea"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                      <text
                        x="0"
                        y="3"
                        fill="#ffffff"
                        fontSize="10"
                        fontWeight="500"
                        textAnchor="middle"
                      >
                        🛗 LIFT (START)
                      </text>
                    </g>
                    */}
                  </g>
                )}

                {/* Cabinet Destination Marker on F1 */}
                <g transform={`translate(${destPos.svgX}, ${destPos.svgY})`}>
                  <circle
                    r="24"
                    fill="#ea580c"
                    opacity="0.3"
                    className="ble-pulse-aura"
                  />
                  <circle
                    r="13"
                    fill="#ea580c"
                    stroke="#ffffff"
                    strokeWidth="3"
                  />
                  <circle r="5" fill="#ffffff" />

                  {/* Commented out capsule label marking as requested:
                  <g transform="translate(0, 32)">
                    <rect
                      x="-65"
                      y="-11"
                      width="130"
                      height="22"
                      rx="11"
                      fill="#ea580c"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                    <text
                      x="0"
                      y="3"
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="500"
                      textAnchor="middle"
                    >
                      🎯 FINAL (CABINET)
                    </text>
                  </g>
                  */}
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
