// src/store/floorSlice.js
import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  activeFloor: "GR",
  visitorInfo: null,
  visitorPos: null,
  targetPos: null,
  mapMeta: null,
  wayfindingData: null,
  floorMapData: {
    GR: { mapMeta: null, wayfindingData: null },
    F1: { mapMeta: null, wayfindingData: null },
  },
  activeRoute: null,
  routeQueue: [],
  stableRoute: null,
  pendingRoute: null,
  routeMatchCount: 0,
  lastPathPos: null,
  minPathMovementMeters: 0.5,
  distance: null,
  proximity: "Tracking Active",
  assets: [],
  apCache: {},
  activeApMac: null,
  locationQueue: [],
  queueCapacity: 80, // increased for smoother averaging
  rssiThreshold: -60,
  bleSignal: {
    rssi: null,
    raw_rssi: null,
    beam: null,
    ap_mac: null,
    last_seen: null,
    queueSize: 0,
    queueCapacity: 150,
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
      if (state.floorMapData[newFloor]) {
        state.mapMeta = state.floorMapData[newFloor].mapMeta;
        state.wayfindingData = state.floorMapData[newFloor].wayfindingData;
      }
    },

    setQueueCapacity: (state, action) => {
      const capacity = Number(action.payload);
      if (!isNaN(capacity) && capacity >= 5 && capacity <= 80) {
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
        state.floorMapData[floor] = { mapMeta, wayfindingData };
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

      // ---- LOCATION & BLE SIGNAL ----
      if (responseData.location) {
        const rawX =
          responseData.location.x ?? responseData.location.pixel_coordinates?.x;
        const rawY =
          responseData.location.y ?? responseData.location.pixel_coordinates?.y;
        const rawXM =
          responseData.location.smoothed_position?.x_m ??
          responseData.location.x_m ??
          null;
        const rawYM =
          responseData.location.smoothed_position?.y_m ??
          responseData.location.y_m ??
          null;
        const rawRssi = responseData.location.rssi ?? null;
        const rawBeam = responseData.location.beam ?? null;
        const rawApMac = responseData.location.ap_mac ?? null;

        // Always update visitorPos
        state.visitorPos = {
          x: rawX ?? null,
          y: rawY ?? null,
          x_m: rawXM,
          y_m: rawYM,
          rssi: rawRssi,
          beam: rawBeam,
          ap_mac: rawApMac,
        };

        // Update bleSignal immediately
        state.bleSignal = {
          rssi: rawRssi,
          raw_rssi: rawRssi,
          beam: rawBeam,
          ap_mac: rawApMac,
          last_seen: responseData.location.last_seen ?? null,
          x: rawX,
          y: rawY,
          x_m: rawXM,
          y_m: rawYM,
          queueSize: state.locationQueue.length,
          queueCapacity: state.queueCapacity,
          rssiThreshold: state.rssiThreshold,
        };

        // Queue logic
        const isValidCoords =
          rawX !== undefined &&
          rawX !== null &&
          !isNaN(Number(rawX)) &&
          rawY !== undefined &&
          rawY !== null &&
          !isNaN(Number(rawY));
        const passesThreshold =
          rawRssi === null ||
          isNaN(Number(rawRssi)) ||
          Number(rawRssi) > state.rssiThreshold;

        if (isValidCoords) {
          if (state.locationQueue.length === 0 || passesThreshold) {
            state.locationQueue.push({
              x: Number(rawX),
              y: Number(rawY),
              x_m:
                rawXM !== null && !isNaN(Number(rawXM)) ? Number(rawXM) : null,
              y_m:
                rawYM !== null && !isNaN(Number(rawYM)) ? Number(rawYM) : null,
              rssi:
                rawRssi !== null && !isNaN(Number(rawRssi))
                  ? Number(rawRssi)
                  : null,
              timestamp: responseData.location.last_seen || Date.now(),
            });
          }

          if (state.locationQueue.length > state.queueCapacity) {
            state.locationQueue = state.locationQueue.slice(
              -state.queueCapacity,
            );
          }

          // Weighted averaging
          const qLength = state.locationQueue.length;
          if (qLength > 0) {
            const weights = [];
            let sumWeight = 0;
            for (let i = 0; i < qLength; i++) {
              const w = Math.pow(0.9, qLength - 1 - i);
              weights.push(w);
              sumWeight += w;
            }

            let sumX = 0,
              sumY = 0,
              sumXM = 0,
              sumYM = 0,
              sumRssi = 0;
            let countXM = 0,
              countYM = 0,
              countRssi = 0;

            for (let i = 0; i < qLength; i++) {
              const item = state.locationQueue[i];
              const w = weights[i];
              sumX += item.x * w;
              sumY += item.y * w;
              if (item.x_m !== null) {
                sumXM += item.x_m * w;
                countXM += w;
              }
              if (item.y_m !== null) {
                sumYM += item.y_m * w;
                countYM += w;
              }
              if (item.rssi !== null) {
                sumRssi += item.rssi * w;
                countRssi += w;
              }
            }

            const avgX = sumX / sumWeight;
            const avgY = sumY / sumWeight;
            const avgXM = countXM > 0 ? sumXM / countXM : null;
            const avgYM = countYM > 0 ? sumYM / countYM : null;
            const avgRssi =
              countRssi > 0 ? Math.round(sumRssi / countRssi) : rawRssi;

            state.visitorPos = {
              ...state.visitorPos,
              x: avgX,
              y: avgY,
              x_m: avgXM,
              y_m: avgYM,
              rssi: avgRssi,
            };

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
              rssiThreshold: state.rssiThreshold,
            };

            if (rawApMac) state.activeApMac = rawApMac;
          }
        }
      }

      // ---- MAP & TARGET ----
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

      // ---- WAYFINDING ----
      if (responseData.wayfinding) {
        state.wayfindingData = responseData.wayfinding;
        if (state.floorMapData[activeFloorKey]) {
          state.floorMapData[activeFloorKey].wayfindingData =
            responseData.wayfinding;
        }
        if (responseData.wayfinding.route_to_destination) {
          state.activeRoute = responseData.wayfinding.route_to_destination;
        }
      }

      // ---- TARGET ----
      if (
        responseData.target_coordinates?.x !== undefined &&
        responseData.target_coordinates?.y !== undefined
      ) {
        state.targetPos = {
          x: responseData.target_coordinates.x,
          y: responseData.target_coordinates.y,
          x_m: responseData.target_coordinates.x_m,
          y_m: responseData.target_coordinates.y_m,
        };
      }

      // ---- DISTANCE & PROXIMITY ----
      if (responseData.distance?.meters !== undefined) {
        state.distance = responseData.distance.meters;
      } else if (typeof responseData.distance === "number") {
        const activePpm = state.mapMeta?.ppm || 50.07391564392213;
        state.distance = responseData.distance / activePpm;
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

export const selectBleSignal = (state) => state.floor.bleSignal;
export default floorSlice.reducer;
