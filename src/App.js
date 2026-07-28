import React, { useEffect, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  setFloor,
  setFloorMapDetails,
  updateLiveLocation,
  setActiveRoute,
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
  LIFT_COORDINATES,
  CABINET_COORDINATES,
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
  // BLE signal diagnostics (rssi, beam, ap_mac, last_seen)
  const bleSignal = useSelector(selectBleSignal);

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
    try {
      const data = await getVisitorLocation("current");

      if (data && (data.success || data.location)) {
        dispatch(updateLiveLocation(data));

        const responseData = data.data || data;
        const bleX = responseData?.location?.x || 5004.59;
        const bleY = responseData?.location?.y || 2313.4;

        // Print Live BLE Location Coordinates to Console
        console.log(
          `📍 LIVE BLE LOCATION: X = ${bleX}, Y = ${bleY}`,
          responseData?.location,
        );

        // 📡 Beam & Signal Diagnostics — log all beam-related fields from backend
        const loc = responseData?.location;
        console.log("📡 BEAM DIAGNOSTICS", {
          rssi:        loc?.rssi        ?? "N/A",   // Signal strength in dBm
          beam:        loc?.beam        ?? "N/A",   // Antenna beam index (Juniper Mist)
          ap_mac:      loc?.ap_mac      ?? "N/A",   // MAC of the AP that detected the tag
          last_seen:   loc?.last_seen   ?? "N/A",   // Unix timestamp of last BLE frame
          mac:         loc?.mac         ?? "N/A",   // BLE tag MAC address
          name:        loc?.name        ?? "N/A",   // Tag display name
          map_id:      loc?.map_id      ?? "N/A",   // Floor map ID
          device_name: loc?.device_name ?? "N/A",   // Tag device name
          manufacture: loc?.manufacture ?? "N/A",   // Tag manufacturer
        });


        // Official wayfinding path is already included in getVisitorLocation payload (responseData.wayfinding.route_to_destination).
        // Using responseData.wayfinding.route_to_destination avoids unnecessary path re-calculation and flickering on every poll.
      }
    } catch (err) {
      console.warn("Realtime location poll notice:", err.message);
    }
  }, [dispatch]);

  // Real-time backend polling interval
  useEffect(() => {
    fetchRealtimeLocation();

    const interval = setInterval(() => {
      fetchRealtimeLocation();
    }, 2000);

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
          beam={bleSignal?.beam}
          ap_mac={bleSignal?.ap_mac}
          last_seen={bleSignal?.last_seen}
          x={bleSignal?.x}
          y={bleSignal?.y}
          x_m={bleSignal?.x_m}
          y_m={bleSignal?.y_m}
        />

        {/* Bottom Navigation Section */}
        {/* <CommonButton onClick={handleCommonButtonClick} /> */}
      </div>
    </div>
  );
}
