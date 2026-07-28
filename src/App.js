import React, { useEffect, useCallback, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  setFloor,
  setFloorMapDetails,
  updateLiveLocation,
  selectBleSignal,
} from "./store/floorSlice";
import Header from "./components/Header";
import MapView2D from "./components/MapView2D";
import BleSignalDiagnostics from "./components/BleSignalDiagnostics";
// CommonButton is currently unused — kept for future use
// import CommonButton from "./components/CommonButton";
import {
  getVisitorLocation,
  getMapDetails,
} from "./services/api";
import {
  FLOOR_MAP_IDS,
} from "./constants";

export default function App() {
  const dispatch = useDispatch();

  // Redux state selectors
  const activeFloor = useSelector((state) => state.floor.activeFloor);
  const visitorPos = useSelector((state) => state.floor.visitorPos);
  const targetPos = useSelector((state) => state.floor.targetPos);
  const mapMeta = useSelector((state) => state.floor.mapMeta);
  const wayfindingData = useSelector((state) => state.floor.wayfindingData);
  const floorMapData = useSelector((state) => state.floor.floorMapData);
  const activeRoute = useSelector((state) => state.floor.activeRoute);
  const distance = useSelector((state) => state.floor.distance);
  const proximity = useSelector((state) => state.floor.proximity);
  // BLE signal diagnostics (rssi, beam, ap_mac, last_seen, queueSize, queueCapacity)
  const bleSignal = useSelector(selectBleSignal);

  // In-flight fetch guard so rapid 250ms polling does not stack pending HTTP requests
  const isFetchingRef = useRef(false);

  // Load Map Details & Wayfinding Nodes for active floor (GR and F1)
  useEffect(() => {
    const fetchFloorMaps = async () => {
      // 1. Fetch GR Floor Map (MB3-F00: 8 nodes)
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

      // 2. Fetch F1 Floor Map (MB3-F01: 37 nodes)
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
        {/* Header Section */}
        <Header />

        {/* 2D Interactive SVG Navigation Map View */}
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
          />
        </main>

        {/* BLE Signal & Live Diagnostics — shown inside the map card area */}
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
        />

        {/* Bottom Navigation Section */}
        {/* <CommonButton onClick={handleCommonButtonClick} /> */}
      </div>
    </div>
  );
}
