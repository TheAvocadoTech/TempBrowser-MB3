import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { LIFT_COORDINATES } from "../constants";

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
    rotation: 270, // Degrees (0, 90, 180, 270)
    scale: 3.2, // Scale multiplier (1.0 = default fit)
    offsetX: 550, // Shift X in SVG pixels
    offsetY: 750, // Shift Y in SVG pixels
  },
  F1: {
    rotation: 270, // Degrees (0, 90, 180, 270)
    scale: 3.2, // Scale multiplier (1.0 = default fit)
    offsetX: 550, // Shift X in SVG pixels
    offsetY: 850, // Shift Y in SVG pixels
  },
};

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
  // Zoomed-in to 1.7x and panned -280px left to hide unused white area and show the right map edge
  const [zoom, setZoom] = useState(1.7);
  const [pan, setPan] = useState({ x: -150, y: 0 });
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

  // Live BLE Tag SVG Coordinates
  const blePos = useMemo(() => {
    const rawX = bleLocation?.x ?? 5004.59;
    const rawY = bleLocation?.y ?? 2313.4;
    return transformCoords(rawX, rawY);
  }, [bleLocation, transformCoords]);

  // Target Destination SVG Coordinates according to active floor
  const destPos = useMemo(() => {
    if (floor === "GR") {
      return transformCoords(LIFT_COORDINATES.x, LIFT_COORDINATES.y);
    } else {
      const rawX = targetCoordinates?.x ?? 5525.3;
      const rawY = targetCoordinates?.y ?? 2491.84;
      return transformCoords(rawX, rawY);
    }
  }, [floor, targetCoordinates, transformCoords]);

  // Extract Route Nodes
  const routeNodesList = useMemo(() => {
    if (
      activeRoute?.nodes &&
      Array.isArray(activeRoute.nodes) &&
      activeRoute.nodes.length > 0
    ) {
      return activeRoute.nodes;
    }
    if (
      wayfindingData?.route_to_destination?.nodes &&
      Array.isArray(wayfindingData.route_to_destination.nodes)
    ) {
      return wayfindingData.route_to_destination.nodes;
    }
    return [];
  }, [activeRoute, wayfindingData]);

  // SVG Active Route Path String
  const routePathD = useMemo(() => {
    const points = [];

    if (blePos) {
      points.push(blePos);
    }

    if (routeNodesList && routeNodesList.length > 0) {
      routeNodesList.forEach((node) => {
        const pos = node.position || node;
        if (pos && pos.x !== undefined && pos.y !== undefined) {
          const pt = transformCoords(pos.x, pos.y);
          points.push(pt);
        }
      });
    }

    if (destPos) {
      points.push(destPos);
    }

    if (points.length < 2) return "";

    return points.reduce((acc, pt, idx) => {
      return idx === 0
        ? `M ${pt.svgX} ${pt.svgY}`
        : `${acc} L ${pt.svgX} ${pt.svgY}`;
    }, "");
  }, [routeNodesList, blePos, destPos, transformCoords]);

  // Extract ALL 37 Real Wayfinding Nodes
  const allGraphNodes = useMemo(() => {
    if (
      mapDetails?.wayfinding_path?.nodes &&
      Array.isArray(mapDetails.wayfinding_path.nodes) &&
      mapDetails.wayfinding_path.nodes.length > 0
    ) {
      return mapDetails.wayfinding_path.nodes;
    }
    if (
      wayfindingData?.wayfinding_path?.nodes &&
      Array.isArray(wayfindingData.wayfinding_path.nodes) &&
      wayfindingData.wayfinding_path.nodes.length > 0
    ) {
      return wayfindingData.wayfinding_path.nodes;
    }
    if (
      wayfindingData?.nodes &&
      Array.isArray(wayfindingData.nodes) &&
      wayfindingData.nodes.length > 0
    ) {
      return wayfindingData.nodes;
    }
    return [];
  }, [mapDetails, wayfindingData]);

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

    const globalEdges = wayfindingData?.edges;
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
  }, [allGraphNodes, wayfindingData, transformCoords]);

  // Zoom / Pan Handlers
  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.35, 4.0));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.35, 0.7));
  const handleResetZoom = () => {
    setZoom(1.7);
    setPan({ x: -280, y: 0 });
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

  const displayBleX = bleLocation?.x ?? 5004.59;
  const displayBleY = bleLocation?.y ?? 2313.4;

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
          <marker
            id="routeArrow"
            markerWidth="6"
            markerHeight="6"
            refX="4"
            refY="3"
            orient="auto"
          >
            <path d="M 0 0 L 6 3 L 0 6 z" fill="#0085ff" />
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
                r="5"
                cx={svgX}
                cy={svgY}
                fill="#334155"
                stroke="#ffffff"
                strokeWidth="1.5"
              />
              {node.name && (
                <text
                  x={svgX}
                  y={svgY + 14}
                  fill="#1e293b"
                  fontSize="9"
                  fontWeight="800"
                  textAnchor="middle"
                >
                  {node.name}
                </text>
              )}
            </g>
          );
        })}

        {/* 5. Active Animated Navigation Route Path */}
        {routePathD && (
          <g>
            <path
              d={routePathD}
              fill="none"
              stroke="rgba(0, 133, 255, 0.25)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={routePathD}
              fill="none"
              stroke="#0085ff"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#routeArrow)"
            />
            <path
              d={routePathD}
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="6 6"
              className="path-animated"
            />
          </g>
        )}

        {/* 6. LIVE BLE LOCATION MARKER */}
        {blePos && (
          <g transform={`translate(${blePos.svgX}, ${blePos.svgY})`}>
            <circle
              r="24"
              fill="#0085ff"
              opacity="0.3"
              className="ble-pulse-aura"
            />
            <circle r="13" fill="#0085ff" stroke="#ffffff" strokeWidth="3" />
            <circle r="5" fill="#ffffff" />

            <g transform="translate(0, -26)">
              <rect
                x="-75"
                y="-12"
                width="150"
                height="22"
                rx="11"
                fill="#0085ff"
                stroke="#ffffff"
                strokeWidth="1.5"
              />
              <text
                x="0"
                y="3"
                fill="#ffffff"
                fontSize="10"
                fontWeight="900"
                textAnchor="middle"
              >
                📍 LIVE: ({Math.round(displayBleX)}, {Math.round(displayBleY)})
              </text>
            </g>
          </g>
        )}

        {/* 7. TARGET DESTINATION MARKER */}
        {destPos && (
          <g transform={`translate(${destPos.svgX}, ${destPos.svgY})`}>
            {floor === "GR" ? (
              // GR Floor: Lift Target
              <g>
                <circle
                  r="24"
                  fill="#9333ea"
                  opacity="0.25"
                  className="ble-pulse-aura"
                />
                <circle
                  r="13"
                  fill="#9333ea"
                  stroke="#ffffff"
                  strokeWidth="3"
                />
                <text
                  x="0"
                  y="4"
                  fill="#ffffff"
                  fontSize="11"
                  fontWeight="900"
                  textAnchor="middle"
                >
                  🛗
                </text>

                <g transform="translate(0, 32)">
                  <rect
                    x="-85"
                    y="-12"
                    width="170"
                    height="22"
                    rx="11"
                    fill="#9333ea"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  <text
                    x="0"
                    y="3"
                    fill="#ffffff"
                    fontSize="10"
                    fontWeight="900"
                    textAnchor="middle"
                  >
                    🛗 FINAL (LIFT): ({Math.round(LIFT_COORDINATES.x)},{" "}
                    {Math.round(LIFT_COORDINATES.y)})
                  </text>
                </g>
              </g>
            ) : (
              // F1 Floor: Cabinet Target
              <g>
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

                <g transform="translate(0, 32)">
                  <rect
                    x="-95"
                    y="-12"
                    width="190"
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
                    fontWeight="900"
                    textAnchor="middle"
                  >
                    🎯 FINAL (CABINET): (
                    {targetCoordinates?.x
                      ? Math.round(targetCoordinates.x)
                      : "5525"}
                    ,{" "}
                    {targetCoordinates?.y
                      ? Math.round(targetCoordinates.y)
                      : "2492"}
                    )
                  </text>
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
