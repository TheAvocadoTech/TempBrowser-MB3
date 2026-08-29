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
      const data = await getVisitorLocation("current");

      // Console log incoming values for debugging
      console.log("📡 [Frontend API Response] Live Location & Wayfinding Data:", {
        visitor: data?.visitor ? `${data.visitor.name || data.visitor.visitorName} (${data.visitor.idNumber || data.visitor.id})` : null,
        location: data?.location ? { x: data.location.x, y: data.location.y, x_m: data.location.x_m || data.location.smoothed_position?.x_m, y_m: data.location.y_m || data.location.smoothed_position?.y_m, rssi: data.location.rssi } : null,
        target_coordinates: data?.target_coordinates || null,
        distance: data?.distance || null,
        proximity: data?.proximity || null,
        wayfinding: data?.wayfinding ? {
          total_nodes: data.wayfinding.total_nodes || data.wayfinding.nodes?.length,
          route_nodes: data.wayfinding.route_to_destination?.nodes?.length || 0,
          route_path: data.wayfinding.route_to_destination?.path || [],
          waypoints: data.wayfinding.route_to_destination?.nodes || []
        } : "none",
      });

      if (data && (data.success || data.location || data.target_coordinates)) {
        dispatch(updateLiveLocation(data));
        
        // If the response contains bleSignal, pass it via updateLiveLocation
        if (data.bleSignal) {
          dispatch(updateLiveLocation({
            bleSignal: {
              rssi: data.bleSignal.rssi,
              raw_rssi: data.bleSignal.raw_rssi,
              beam: data.bleSignal.beam,
              ap_mac: data.bleSignal.ap_mac,
              last_seen: data.bleSignal.last_seen || Date.now() / 1000,
              x: data.bleSignal.x,
              y: data.bleSignal.y,
              x_m: data.bleSignal.x_m,
              y_m: data.bleSignal.y_m,
              queueSize: data.bleSignal.queueSize,
              queueCapacity: data.bleSignal.queueCapacity,
              rssiThreshold: data.bleSignal.rssiThreshold,
            }
          }));
        }
      } else {
        console.warn("⚠️ [Frontend] Received empty or invalid location response:", data);
      }
    } catch (err) {
      console.warn("Realtime location poll notice:", err.message);
    } finally {
      isFetchingRef.current = false;
    }
  }, [dispatch]);

  // Real-time backend polling interval (1000ms) with client-side 60fps LERP smoothing
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
        />
      </div>
    </div>
  );
}