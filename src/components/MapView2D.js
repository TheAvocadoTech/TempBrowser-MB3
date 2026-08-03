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

const SVG_WIDTH = 900;
const SVG_HEIGHT = 600;

export default function MapView2D({
  floor,
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
  const activeWayfinding = activeFloorData.wayfindingData || wayfindingData;
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

  const startPos = useMemo(() => {
    const rawX = bleLocation?.x ?? SVG_WIDTH / 2;
    const rawY = bleLocation?.y ?? SVG_HEIGHT / 2;
    return transformCoords(rawX, rawY);
  }, [bleLocation, transformCoords]);

  const destPos = useMemo(() => {
    if (targetPos && targetPos.x !== undefined && targetPos.y !== undefined) {
      return transformCoords(targetPos.x, targetPos.y);
    }
    return transformCoords(SVG_WIDTH / 2, SVG_HEIGHT / 2);
  }, [targetPos, transformCoords]);

  const backendWaypoints = useMemo(() => {
    const rawWaypoints =
      activeRoute?.waypoints || activeRoute?.nodes || activeRoute?.path;
    return extractWaypoints(rawWaypoints);
  }, [activeRoute]);

  const liveRoutePathD = useMemo(() => {
    const points = [];
    if (startPos) points.push(startPos);
    if (backendWaypoints && backendWaypoints.length > 0) {
      backendWaypoints.forEach((pt) =>
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
  }, [startPos, backendWaypoints, destPos, transformCoords]);

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
            {proximity || "Live Tracking Active"}
          </span>
          <span className="nav-badge-subtitle">
            {distanceInMeters !== null
              ? `${distanceInMeters} m to Target`
              : "Updating Location..."}
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
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  opacity="0.6"
                />
              );
            });
          })}

        {/* ---- WAYFINDING NODES ---- */}
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
                  r="6"
                  fill="#1e293b"
                  stroke="#38bdf8"
                  strokeWidth="2"
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

        {/* ---- MARKERS ---- */}
        {startPos && (
          <g transform={`translate(${startPos.svgX}, ${startPos.svgY})`}>
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

        {destPos && (
          <g transform={`translate(${destPos.svgX}, ${destPos.svgY})`}>
            <circle
              r="8"
              fill="#9333ea"
              opacity="0.25"
              className="ble-pulse-aura"
            />
            <circle r="5" fill="#9333ea" stroke="#ffffff" strokeWidth="0.5" />
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
