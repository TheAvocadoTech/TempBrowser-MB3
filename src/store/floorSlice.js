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
  distance: null,
  proximity: "Tracking Active",
  assets: [],
  // AP MAC signal tracking & active anchor
  apCache: {}, // { [ap_mac]: { rssi, x, y, last_seen } }
  activeApMac: null,
  // BLE signal diagnostics: rssi, beam, ap_mac from Juniper Mist
  bleSignal: {
    rssi: null,   // e.g. -72 (dBm)
    beam: null,   // e.g. 3 (antenna beam index)
    ap_mac: null, // e.g. "c878678a984c"
    last_seen: null,
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
        const incoming = {
          ...responseData.location,
          x: responseData.location.pixel_coordinates?.x ?? responseData.location.x,
          y: responseData.location.pixel_coordinates?.y ?? responseData.location.y,
        };
        const prev = state.visitorPos;

        const incomingRssi = incoming.rssi ?? null;
        const incomingBeam = incoming.beam ?? null;
        const incomingApMac = incoming.ap_mac ?? null;

        // --- 1. AP MAC Tracking & Dominant AP Selection ---
        let isDominantAp = true;

        if (incomingApMac && incomingRssi !== null) {
          const now = Date.now();
          // Store/update reading in AP cache
          state.apCache[incomingApMac] = {
            rssi: incomingRssi,
            x: incoming.x,
            y: incoming.y,
            last_seen: incoming.last_seen || now,
          };

          // Find AP MAC with strongest (highest) RSSI reading
          let bestApMac = incomingApMac;
          let bestRssi = incomingRssi;

          Object.keys(state.apCache).forEach((mac) => {
            const entry = state.apCache[mac];
            const timestamp = entry.last_seen > 1e11 ? entry.last_seen : entry.last_seen * 1000;
            if (now - timestamp > 15000) {
              delete state.apCache[mac];
            } else if (entry.rssi > bestRssi) {
              bestRssi = entry.rssi;
              bestApMac = mac;
            }
          });

          state.activeApMac = bestApMac;

          // Only accept (x,y) update if coming from the dominant AP (or within 5 dBm of top AP)
          if (incomingApMac !== bestApMac && incomingRssi < bestRssi - 5) {
            isDominantAp = false;
          }
        }

        // --- 2. Position Quality Gate, AP Locking & Smoothing ---
        if (!prev) {
          // First load — initialize position directly
          state.visitorPos = incoming;
        } else if (incoming.x !== undefined && incoming.y !== undefined) {
          const dx = incoming.x - prev.x;
          const dy = incoming.y - prev.y;
          const dist = Math.hypot(dx, dy);

          const DEADBAND_THRESHOLD = 30; // ~0.5m noise threshold
          const MAX_JUMP_THRESHOLD = 500;
          const isWeakSignal = incomingRssi !== null && incomingRssi < -75;

          if (!isDominantAp) {
            // Reading came from a weak/distant AP — lock position to current location
            state.visitorPos = { ...prev, ...incoming, x: prev.x, y: prev.y };
          } else if (isWeakSignal && dist > DEADBAND_THRESHOLD) {
            // Weak overall signal — reject position jump
            state.visitorPos = { ...prev, ...incoming, x: prev.x, y: prev.y };
          } else if (dist < DEADBAND_THRESHOLD) {
            // Stationary tag — freeze x/y to eliminate micro-jitter
            state.visitorPos = { ...prev, ...incoming, x: prev.x, y: prev.y };
          } else {
            // Tag is moving under dominant AP — apply EMA position smoothing (alpha = 0.35)
            const alpha = dist > MAX_JUMP_THRESHOLD ? 1.0 : 0.35;
            const smoothedX = prev.x + alpha * dx;
            const smoothedY = prev.y + alpha * dy;

            state.visitorPos = {
              ...prev,
              ...incoming,
              x: smoothedX,
              y: smoothedY,
            };
          }
        }

        // --- 3. BLE Signal Quality Gate (Diagnostics Box) ---
        if (incomingRssi !== null && incomingRssi !== undefined) {
          state.bleSignal = {
            rssi: incomingRssi,
            beam: incomingBeam,
            ap_mac: incomingApMac,
            last_seen: incoming.last_seen ?? null,
            x: incoming.x ?? null,
            y: incoming.y ?? null,
            x_m: incoming.smoothed_position?.x_m ?? null,
            y_m: incoming.smoothed_position?.y_m ?? null,
          };
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
          if (wayfindingPayload.route_to_destination) {
            state.activeRoute = wayfindingPayload.route_to_destination;
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
  setFloorMapDetails,
  updateLiveLocation,
  setActiveRoute,
  setAssets,
} = floorSlice.actions;

// Selector: BLE signal diagnostics
export const selectBleSignal = (state) => state.floor.bleSignal;
export default floorSlice.reducer;
