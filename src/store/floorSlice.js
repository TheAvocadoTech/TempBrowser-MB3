import { createSlice } from "@reduxjs/toolkit";
import {
  LIFT_COORDINATES,
  F1_LIFT_COORDINATES,
  CABINET_COORDINATES,
} from "../constants";

const initialState = {
  activeFloor: "GR", // 'GR' or 'F1'
  visitorInfo: null,
  visitorPos: null, // { x, y, name, mac, map_id }
  targetPos: { x: LIFT_COORDINATES.x, y: LIFT_COORDINATES.y }, // Default GR Lift target
  mapMeta: null,
  wayfindingData: null,
  // Separate Map Details & Wayfinding Nodes for each floor
  floorMapData: {
    GR: { mapMeta: null, wayfindingData: null },
    F1: { mapMeta: null, wayfindingData: null },
  },
  activeRoute: null,
  // Waypoint & Path Stabilization Queue State
  routeQueue: [],
  stableRoute: null,
  pendingRoute: null,
  routeMatchCount: 0,
  distance: null,
  proximity: "Tracking Active",
  assets: [],
  // AP MAC signal tracking & active anchor
  apCache: {}, // { [ap_mac]: { rssi, x, y, last_seen } }
  activeApMac: null,
  // High-speed location queue & moving average smoothing buffer (30 window)
  locationQueue: [],
  queueCapacity: 30, // Default queue size: 30 samples
  rssiThreshold: -60, // RSSI signal filter threshold (-60 dBm)
  // BLE signal diagnostics: rssi, beam, ap_mac from Juniper Mist
  bleSignal: {
    rssi: null,   // e.g. -72 (dBm)
    raw_rssi: null,
    beam: null,   // e.g. 3 (antenna beam index)
    ap_mac: null, // e.g. "c878678a984c"
    last_seen: null,
    queueSize: 0,
    queueCapacity: 30,
    rssiThreshold: -60,
  },
};

export const floorSlice = createSlice({
  name: "floor",
  initialState,
  reducers: {
    setFloor: (state, action) => {
      const newFloor = action.payload;
      state.activeFloor = newFloor;
      state.activeRoute = null;

      // Update active mapMeta and wayfindingData for the selected floor
      if (state.floorMapData[newFloor]) {
        state.mapMeta = state.floorMapData[newFloor].mapMeta;
        state.wayfindingData = state.floorMapData[newFloor].wayfindingData;
      }

      // Update target position based on floor selection
      if (newFloor === "GR") {
        state.targetPos = { x: LIFT_COORDINATES.x, y: LIFT_COORDINATES.y };
      } else if (newFloor === "F1") {
        state.targetPos = { x: CABINET_COORDINATES.x, y: CABINET_COORDINATES.y };
      }
    },

    setQueueCapacity: (state, action) => {
      const capacity = Number(action.payload);
      if (!isNaN(capacity) && capacity >= 5 && capacity <= 50) {
        state.queueCapacity = capacity;
        if (state.locationQueue.length > capacity) {
          state.locationQueue = state.locationQueue.slice(-capacity);
        }
      }
    },

    setRssiThreshold: (state, action) => {
      const threshold = Number(action.payload);
      if (!isNaN(threshold)) {
        state.rssiThreshold = threshold;
      }
    },

    setFloorMapDetails: (state, action) => {
      const { floor, mapMeta, wayfindingData } = action.payload;
      if (floor) {
        state.floorMapData[floor] = {
          mapMeta: mapMeta || null,
          wayfindingData: wayfindingData || null,
        };

        // If the active floor matches, update current mapMeta & wayfindingData
        if (state.activeFloor === floor) {
          state.mapMeta = mapMeta || null;
          state.wayfindingData = wayfindingData || null;
        }
      }
    },

    updateLiveLocation: (state, action) => {
      const payload = action.payload;
      if (!payload) return;

      const responseData = payload.data || payload;

      if (responseData.visitor) {
        state.visitorInfo = responseData.visitor;
      }

      if (responseData.location) {
        const rawX = responseData.location.pixel_coordinates?.x ?? responseData.location.x;
        const rawY = responseData.location.pixel_coordinates?.y ?? responseData.location.y;
        const rawXM = responseData.location.smoothed_position?.x_m ?? responseData.location.x_m ?? null;
        const rawYM = responseData.location.smoothed_position?.y_m ?? responseData.location.y_m ?? null;
        const rawRssi = responseData.location.rssi ?? null;
        const rawBeam = responseData.location.beam ?? null;
        const rawApMac = responseData.location.ap_mac ?? null;

        const currentThreshold = state.rssiThreshold ?? -60;
        const isInitialLoad = state.locationQueue.length === 0;
        const isValidCoords = rawX !== undefined && rawY !== undefined && !isNaN(Number(rawX)) && !isNaN(Number(rawY));
        const passesThreshold = rawRssi === null || isNaN(Number(rawRssi)) || Number(rawRssi) > currentThreshold;

        // 1. Initial Load / Refresh: Always seed 1st sample to queue regardless of RSSI for instant display
        // 2. Subsequent Polls: Push samples into queue ONLY if they pass RSSI threshold (> -60 dBm)
        if (isValidCoords) {
          if (isInitialLoad) {
            console.log(`📌 Initial Load / Refresh: Seeded queue with 1st reading (RSSI: ${rawRssi} dBm, X: ${rawX}, Y: ${rawY}).`);
            state.locationQueue.push({
              x: Number(rawX),
              y: Number(rawY),
              x_m: rawXM !== null && !isNaN(Number(rawXM)) ? Number(rawXM) : null,
              y_m: rawYM !== null && !isNaN(Number(rawYM)) ? Number(rawYM) : null,
              rssi: rawRssi !== null && !isNaN(Number(rawRssi)) ? Number(rawRssi) : null,
              timestamp: responseData.location.last_seen || Date.now(),
            });
          } else if (passesThreshold) {
            state.locationQueue.push({
              x: Number(rawX),
              y: Number(rawY),
              x_m: rawXM !== null && !isNaN(Number(rawXM)) ? Number(rawXM) : null,
              y_m: rawYM !== null && !isNaN(Number(rawYM)) ? Number(rawYM) : null,
              rssi: rawRssi !== null && !isNaN(Number(rawRssi)) ? Number(rawRssi) : null,
              timestamp: responseData.location.last_seen || Date.now(),
            });
          } else {
            console.log(`⚠️ Blocked RSSI sample (${rawRssi} dBm <= ${currentThreshold} dBm threshold). Preserved previous queue state.`);
          }
        }

        // 2. Maintain fixed sliding window size (e.g. 20-30 max samples)
        if (state.locationQueue.length > state.queueCapacity) {
          state.locationQueue = state.locationQueue.slice(-state.queueCapacity);
        }

        // 3. Compute moving average for (x, y, x_m, y_m, rssi) over queued samples
        const qLength = state.locationQueue.length;
        if (qLength > 0) {
          let sumX = 0, sumY = 0, sumXM = 0, sumYM = 0, sumRssi = 0;
          let countXM = 0, countYM = 0, countRssi = 0;

          for (let i = 0; i < qLength; i++) {
            const item = state.locationQueue[i];
            sumX += item.x;
            sumY += item.y;
            if (item.x_m !== null) { sumXM += item.x_m; countXM++; }
            if (item.y_m !== null) { sumYM += item.y_m; countYM++; }
            if (item.rssi !== null) { sumRssi += item.rssi; countRssi++; }
          }

          const avgX = sumX / qLength;
          const avgY = sumY / qLength;
          const avgXM = countXM > 0 ? sumXM / countXM : null;
          const avgYM = countYM > 0 ? sumYM / countYM : null;
          const avgRssi = countRssi > 0 ? Math.round(sumRssi / countRssi) : rawRssi;

          const incomingAveraged = {
            ...responseData.location,
            x: avgX,
            y: avgY,
            raw_x: rawX,
            raw_y: rawY,
            x_m: avgXM,
            y_m: avgYM,
          };

          state.visitorPos = incomingAveraged;
          if (rawApMac) state.activeApMac = rawApMac;

          state.bleSignal = {
            rssi: avgRssi,
            raw_rssi: rawRssi,
            beam: rawBeam,
            ap_mac: rawApMac,
            last_seen: responseData.location.last_seen ?? null,
            x: avgX,
            y: avgY,
            x_m: avgXM,
            y_m: avgYM,
            queueSize: qLength,
            queueCapacity: state.queueCapacity,
            rssiThreshold: currentThreshold,
          };

          console.log(
            `📊 Location Queue [${qLength}/${state.queueCapacity}]: Averaged X=${avgX.toFixed(1)}, Y=${avgY.toFixed(1)} (Raw X=${rawX}, Y=${rawY}), RSSI=${avgRssi}dBm`
          );
        }
      }

      // Update mapMeta & wayfindingData for appropriate floor
      const activeFloorKey =
        responseData.map?.id === "cfa55e13-794f-4081-b1b7-e35f1ea67325" ||
        responseData.location?.map_id === "cfa55e13-794f-4081-b1b7-e35f1ea67325"
          ? "F1"
          : "GR";

      if (responseData.map) {
        state.floorMapData[activeFloorKey].mapMeta = responseData.map;
        if (state.activeFloor === activeFloorKey) {
          state.mapMeta = responseData.map;
        }
      }

      const wayfindingPayload =
        responseData.wayfinding ||
        responseData.wayfinding_path ||
        responseData.map?.wayfinding_path;
      if (wayfindingPayload) {
        state.floorMapData[activeFloorKey].wayfindingData = wayfindingPayload;
        if (state.activeFloor === activeFloorKey) {
          state.wayfindingData = wayfindingPayload;

          const incomingRoute = wayfindingPayload.route_to_destination || wayfindingPayload.route || wayfindingPayload;

          if (incomingRoute) {
            // Unpack incoming route waypoints/nodes structure
            const incomingWaypoints = Array.isArray(incomingRoute)
              ? incomingRoute
              : incomingRoute.waypoints || incomingRoute.nodes || incomingRoute.path || [];

            // 1. Initial Load: set stableRoute & activeRoute
            if (!state.stableRoute || !state.activeRoute) {
              state.stableRoute = incomingRoute;
              state.activeRoute = incomingRoute;
              state.routeQueue = [incomingWaypoints];
              state.pendingRoute = null;
              state.routeMatchCount = 0;
            } else {
              // 2. Compare incoming waypoints structure with active stableRoute
              const currentWaypoints = Array.isArray(state.stableRoute)
                ? state.stableRoute
                : state.stableRoute.waypoints || state.stableRoute.nodes || state.stableRoute.path || [];

              // Check if node length/sequence matches current stable route
              const isSameNodeLength = incomingWaypoints.length === currentWaypoints.length;

              if (isSameNodeLength && incomingWaypoints.length > 0) {
                // Same graph branch: Smooth waypoint coordinates over 5-sample route queue
                state.pendingRoute = null;
                state.routeMatchCount = 0;
                state.routeQueue.push(incomingWaypoints);
                if (state.routeQueue.length > 5) {
                  state.routeQueue = state.routeQueue.slice(-5);
                }

                // Average waypoint (x, y) coordinates across routeQueue for identical indices
                const queueLen = state.routeQueue.length;
                const smoothedWaypoints = incomingWaypoints.map((wp, idx) => {
                  let sumX = 0, sumY = 0, count = 0;
                  for (let q = 0; q < queueLen; q++) {
                    const qWp = state.routeQueue[q][idx];
                    if (qWp) {
                      const qx = qWp.x ?? qWp[0] ?? qWp.position?.x;
                      const qy = qWp.y ?? qWp[1] ?? qWp.position?.y;
                      if (qx !== undefined && qy !== undefined && !isNaN(Number(qx)) && !isNaN(Number(qy))) {
                        sumX += Number(qx);
                        sumY += Number(qy);
                        count++;
                      }
                    }
                  }
                  if (count > 0) {
                    return {
                      ...wp,
                      x: sumX / count,
                      y: sumY / count,
                      position: { x: sumX / count, y: sumY / count },
                    };
                  }
                  return wp;
                });

                state.activeRoute = {
                  ...incomingRoute,
                  waypoints: smoothedWaypoints,
                  nodes: smoothedWaypoints,
                  path: smoothedWaypoints,
                };
              } else {
                // Different graph branch proposed: apply 3-poll confirmation hysteresis lock
                state.routeMatchCount += 1;
                if (state.routeMatchCount >= 3) {
                  // Confirmed over 3 polls (750ms hysteresis lock) -> Update stable route
                  state.stableRoute = incomingRoute;
                  state.activeRoute = incomingRoute;
                  state.routeQueue = [incomingWaypoints];
                  state.pendingRoute = null;
                  state.routeMatchCount = 0;
                }
              }
            }
          }
        }
      }

      // Target coordinates for F1 (Cabinet) and GR (Lift)
      if (responseData.target_coordinates?.x !== undefined && responseData.target_coordinates?.y !== undefined) {
        state.targetPos = {
          x: responseData.target_coordinates.x,
          y: responseData.target_coordinates.y,
          x_m: responseData.target_coordinates.x_m,
          y_m: responseData.target_coordinates.y_m,
        };
      } else if (state.activeFloor === "F1") {
        state.targetPos = { x: CABINET_COORDINATES.x, y: CABINET_COORDINATES.y };
      } else if (state.activeFloor === "GR") {
        state.targetPos = { x: LIFT_COORDINATES.x, y: LIFT_COORDINATES.y };
      }

      // Distance calculation (Meters): Prioritize backend responseData.distance.meters
      if (responseData.distance?.meters !== undefined) {
        state.distance = responseData.distance.meters;
      } else if (typeof responseData.distance === "number") {
        const activePpm = state.mapMeta?.ppm || 50.07391564392213;
        state.distance = responseData.distance / activePpm;
      } else {
        const startX =
          state.activeFloor === "F1" ? F1_LIFT_COORDINATES.x : state.visitorPos?.x;
        const startY =
          state.activeFloor === "F1" ? F1_LIFT_COORDINATES.y : state.visitorPos?.y;

        if (startX !== undefined && state.targetPos?.x !== undefined) {
          const dx = state.targetPos.x - startX;
          const dy = state.targetPos.y - startY;
          const distPixels = Math.sqrt(dx * dx + dy * dy);
          const activePpm = state.mapMeta?.ppm || 50.07391564392213;
          state.distance = distPixels / activePpm;
        }
      }

      if (responseData.proximity) {
        state.proximity = responseData.proximity;
      }
    },

    setActiveRoute: (state, action) => {
      state.activeRoute = action.payload;
    },

    setAssets: (state, action) => {
      state.assets = action.payload;
    },
  },
});

export const {
  setFloor,
  setQueueCapacity,
  setRssiThreshold,
  setFloorMapDetails,
  updateLiveLocation,
  setActiveRoute,
  setAssets,
} = floorSlice.actions;

// Selector: BLE signal diagnostics
export const selectBleSignal = (state) => state.floor.bleSignal;
export default floorSlice.reducer;
