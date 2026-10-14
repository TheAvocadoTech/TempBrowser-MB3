import React, { useEffect, useCallback, useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  setFloor,
  setFloorMapDetails,
  updateLiveLocation,
  selectBleSignal,
  selectTagFloor,
} from "./store/floorSlice";
import Header from "./components/Header";
import MapView2D from "./components/MapView2D";
import MapView3D from "./components/MapView3D";
import BleSignalDiagnostics from "./components/BleSignalDiagnostics";
import { useAssetPolling } from "./hooks/useAssetPolling";
import {
  getVisitorLocation,
  getMapDetails,
  getWayfindingPath,
} from "./services/api";
import { FLOOR_MAP_IDS } from "./constants";

export default function App() {
  const dispatch = useDispatch();

  const [viewMode, setViewMode] = useState("2D"); // '2D' | '3D'

  const activeFloor = useSelector((state) => state.floor.activeFloor);
  const tagFloor = useSelector(selectTagFloor);
  const visitorPos = useSelector((state) => state.floor.visitorPos);
  const targetPos = useSelector((state) => state.floor.targetPos);
  const mapMeta = useSelector((state) => state.floor.mapMeta);
  const wayfindingData = useSelector((state) => state.floor.wayfindingData);
  const floorMapData = useSelector((state) => state.floor.floorMapData);
  const activeRoute = useSelector((state) => state.floor.activeRoute);
  const distance = useSelector((state) => state.floor.distance);
  const proximity = useSelector((state) => state.floor.proximity);
  const bleSignal = useSelector(selectBleSignal);
  const assets = useSelector((state) => state.floor.assets);

  const isFetchingRef = useRef(false);

  // Start asset polling every 5 seconds
  useAssetPolling(5000);

  // Load Map Details & Wayfinding Nodes for active floor (GR and F1)
  useEffect(() => {
    const fetchFloorMaps = async () => {
      console.log(
        "🚀 [App] Initializing Floor Maps and Wayfinding data for GR and F1...",
      );
      // Ground Floor
      try {
        const [grMapRes, grWfRes] = await Promise.allSettled([
          getMapDetails(FLOOR_MAP_IDS.GR),
          getWayfindingPath(FLOOR_MAP_IDS.GR),
        ]);

        const grMapData =
          grMapRes.status === "fulfilled" && grMapRes.value
            ? grMapRes.value.data || grMapRes.value
            : null;
        const grWfData =
          grWfRes.status === "fulfilled" && grWfRes.value
            ? grWfRes.value.data || grWfRes.value
            : grMapData?.wayfinding_path || null;

        console.log("🏢 [App] Ground Floor (GR) Map Data loaded:", {
          mapMeta: grMapData
            ? {
                id: grMapData.id,
                name: grMapData.name,
                ppm: grMapData.ppm,
                url: grMapData.url,
              }
            : null,
          wayfindingData: grWfData
            ? {
                nodes: grWfData.nodes?.length || 0,
                edges: Object.keys(grWfData.edges || {}).length,
              }
            : null,
        });

        if (grMapData || grWfData) {
          dispatch(
            setFloorMapDetails({
              floor: "GR",
              mapMeta: grMapData,
              wayfindingData: grWfData,
            }),
          );
        }
      } catch (err) {
        console.warn("GR Map init notice:", err.message);
      }

      // First Floor
      try {
        const [f1MapRes, f1WfRes] = await Promise.allSettled([
          getMapDetails(FLOOR_MAP_IDS.F1),
          getWayfindingPath(FLOOR_MAP_IDS.F1),
        ]);

        const f1MapData =
          f1MapRes.status === "fulfilled" && f1MapRes.value
            ? f1MapRes.value.data || f1MapRes.value
            : null;
        const f1WfData =
          f1WfRes.status === "fulfilled" && f1WfRes.value
            ? f1WfRes.value.data || f1WfRes.value
            : f1MapData?.wayfinding_path || null;

        console.log("🏢 [App] First Floor (F1) Map Data loaded:", {
          mapMeta: f1MapData
            ? {
                id: f1MapData.id,
                name: f1MapData.name,
                ppm: f1MapData.ppm,
                url: f1MapData.url,
              }
            : null,
          wayfindingData: f1WfData
            ? {
                nodes: f1WfData.nodes?.length || 0,
                edges: Object.keys(f1WfData.edges || {}).length,
              }
            : null,
        });

        if (f1MapData || f1WfData) {
          dispatch(
            setFloorMapDetails({
              floor: "F1",
              mapMeta: f1MapData,
              wayfindingData: f1WfData,
            }),
          );
        }
      } catch (err) {
        console.warn("F1 Map init notice:", err.message);
      }
    };

    fetchFloorMaps();
  }, [dispatch]);

  // Fetch real-time BLE location and wayfinding data for active visitor
  const fetchRealtimeLocation = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const rawData = await getVisitorLocation("current");
      const data = rawData?.data || rawData;

      // Console log incoming values for debugging
      console.log(
        "📡 [Frontend API Response] Live Location & Wayfinding Data:",
        {
          visitor: data?.visitor
            ? `${data.visitor.name || data.visitor.visitorName} (${data.visitor.idNumber || data.visitor.id})`
            : null,
          location: data?.location
            ? {
                x: data.location.x,
                y: data.location.y,
                x_m: data.location.x_m || data.location.smoothed_position?.x_m,
                y_m: data.location.y_m || data.location.smoothed_position?.y_m,
                rssi: data.location.rssi,
              }
            : null,
          target_coordinates: data?.target_coordinates || null,
          distance: data?.distance || null,
          proximity: data?.proximity || null,
          wayfinding: data?.wayfinding
            ? {
                total_nodes:
                  data.wayfinding.total_nodes || data.wayfinding.nodes?.length,
                route_nodes:
                  data.wayfinding.route_to_destination?.nodes?.length || 0,
                route_path: data.wayfinding.route_to_destination?.path || [],
                waypoints: data.wayfinding.route_to_destination?.nodes || [],
              }
            : "none",
        },
      );

      if (data && (data.success || data.location || data.target_coordinates)) {
        dispatch(updateLiveLocation(data));

        // ────────────────────────────────────────────────────────────
        // Derive bleSignal from data.location.
        // The backend does NOT send `data.bleSignal` — it sends everything
        // under `data.location`. Map that into the bleSignal shape that
        // BleSignalDiagnostics expects.
        // ────────────────────────────────────────────────────────────
        if (data.location) {
          const loc = data.location;
          const smoothed = loc.smoothed_position || {};
          const px = loc.pixel_coordinates || {};

          dispatch(
            updateLiveLocation({
              bleSignal: {
                rssi: loc.rssi,
                raw_rssi: loc.raw_rssi ?? loc.rssi,
                beam: loc.beam,
                ap_mac: loc.ap_mac,
                last_seen: Date.now() / 1000,
                // Pixel coords (used by "Smoothed Coords (px)" row)
                x: px.x ?? loc.x ?? null,
                y: px.y ?? loc.y ?? null,
                // Meter coords (used by "Smoothed Position (m)" row)
                x_m: smoothed.x_m ?? loc.x_m ?? null,
                y_m: smoothed.y_m ?? loc.y_m ?? null,
                // Diagnostics
                queueSize: 0,
                queueCapacity: 8,
                rssiThreshold: -65,
                distToMist: loc.mist_dist ?? null,
                tagMac: loc.mac,
                tagName: loc.device_name || loc.name,
              },
            }),
          );
        }
      } else {
        console.warn(
          "⚠️ [Frontend] Received empty or invalid location response:",
          data,
        );
      }
    } catch (err) {
      console.warn("Realtime location poll notice:", err.message);
    } finally {
      isFetchingRef.current = false;
    }
  }, [dispatch]);

  // Real-time backend polling interval (1000ms)
  useEffect(() => {
    fetchRealtimeLocation();

    const POLL_INTERVAL_MS = 1000;
    const interval = setInterval(() => {
      fetchRealtimeLocation();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchRealtimeLocation]);

  const handleFloorChange = (newFloor) => {
    if (newFloor !== activeFloor) {
      dispatch(setFloor(newFloor));
    }
  };

  return (
    <div className="app-viewport">
      <div className="mobile-card-container">
        <Header viewMode={viewMode} onViewModeChange={setViewMode} />

        <main className="main-map-section">
          {viewMode === "3D" ? (
            <MapView3D
              floor={activeFloor}
              tagFloor={tagFloor}
              onFloorChange={handleFloorChange}
              mapDetails={mapMeta}
              bleLocation={visitorPos}
              targetCoordinates={targetPos}
              wayfindingData={wayfindingData}
              floorMapData={floorMapData}
              activeRoute={activeRoute}
              distance={distance}
              proximity={proximity}
              assets={assets}
            />
          ) : (
            <MapView2D
              floor={activeFloor}
              tagFloor={tagFloor}
              onFloorChange={handleFloorChange}
              mapDetails={mapMeta}
              bleLocation={visitorPos}
              connectedApMac={bleSignal?.ap_mac || visitorPos?.ap_mac}
              targetCoordinates={targetPos}
              wayfindingData={wayfindingData}
              floorMapData={floorMapData}
              activeRoute={activeRoute}
              distance={distance}
              proximity={proximity}
              assets={assets}
            />
          )}
        </main>

        <BleSignalDiagnostics
          rssi={bleSignal?.rssi}
          rawRssi={bleSignal?.raw_rssi}
          beam={bleSignal?.beam}
          ap_mac={bleSignal?.ap_mac}
          last_seen={bleSignal?.last_seen}
          x={bleSignal?.x}
          y={bleSignal?.y}
          x_m={bleSignal?.x_m}
          y_m={bleSignal?.y_m}
          queueSize={bleSignal?.queueSize}
          queueCapacity={bleSignal?.queueCapacity}
          rssiThreshold={bleSignal?.rssiThreshold}
          tagMac={bleSignal?.tagMac}
          tagName={bleSignal?.tagName}
          distToMist={bleSignal?.distToMist}
        />
      </div>
    </div>
  );
}
