import React, { useEffect, useCallback, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  setFloor,
  setFloorMapDetails,
  updateLiveLocation,
  selectBleSignal,
} from "./store/floorSlice"; // <-- remove updateBleSignal
import Header from "./components/Header";
import MapView2D from "./components/MapView2D";
import BleSignalDiagnostics from "./components/BleSignalDiagnostics";
import { useAssetPolling } from "./hooks/useAssetPolling";
import { getVisitorLocation, getMapDetails } from "./services/api";
import { FLOOR_MAP_IDS } from "./constants";

export default function App() {
  const dispatch = useDispatch();

  const activeFloor = useSelector((state) => state.floor.activeFloor);
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
      try {
        const grRes = await getMapDetails(FLOOR_MAP_IDS.GR);
        if (grRes && (grRes.data || grRes.id)) {
          const grData = grRes.data || grRes;
          dispatch(
            setFloorMapDetails({
              floor: "GR",
              mapMeta: grData,
              wayfindingData: grData.wayfinding_path,
            }),
          );
        }
      } catch (err) {
        console.warn("GR Map init notice:", err.message);
      }

      try {
        const f1Res = await getMapDetails(FLOOR_MAP_IDS.F1);
        if (f1Res && (f1Res.data || f1Res.id)) {
          const f1Data = f1Res.data || f1Res;
          dispatch(
            setFloorMapDetails({
              floor: "F1",
              mapMeta: f1Data,
              wayfindingData: f1Data.wayfinding_path,
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

      if (data && (data.success || data.location)) {
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
      }
    } catch (err) {
      console.warn("Realtime location poll notice:", err.message);
    } finally {
      isFetchingRef.current = false;
    }
  }, [dispatch]);

  // Real-time high-speed backend polling interval (250ms)
  useEffect(() => {
    fetchRealtimeLocation();

    const FAST_POLL_INTERVAL_MS = 250;
    const interval = setInterval(() => {
      fetchRealtimeLocation();
    }, FAST_POLL_INTERVAL_MS);

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
        <Header />

        <main className="main-map-section">
          <MapView2D
            floor={activeFloor}
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
          tagMac={bleSignal?.tagMac}        // passed from useAssetPolling
          tagName={bleSignal?.tagName}
        />
      </div>
    </div>
  );
}