// src/store/floorSlice.js
import { createSlice } from "@reduxjs/toolkit";
import apList from "../services/ap_list.json";

const normalizeMac = (m) =>
  m ? String(m).replace(/[:-]/g, "").toLowerCase().trim() : "";

function getMistApForLocation(
  apMac,
  mapId,
  targetFloor,
  rawX,
  rawY,
  rawXM,
  rawYM,
  ppm
) {
  if (!Array.isArray(apList) || apList.length === 0) return null;
  const normTarget = normalizeMac(apMac);

  if (normTarget) {
    const matched = apList.find((ap) => {
      const normAp = normalizeMac(ap.mac);
      if (normAp && normAp === normTarget) return true;
      if (ap.id && normalizeMac(ap.id).endsWith(normTarget)) return true;
      return false;
    });
    if (matched) return matched;
  }

  // Filter APs for this floor
  const floorAps = apList.filter((ap) => {
    if (ap.x === undefined || ap.y === undefined) return false;
    if (mapId && ap.map_id === mapId) return true;
    if (targetFloor === "GR" && (ap.name?.includes("-F00-") || ap.name?.includes("-GR-"))) return true;
    if (targetFloor === "F1" && (ap.name?.includes("-F01-") || ap.name?.includes("-F1-"))) return true;
    return false;
  });

  const candidates = floorAps.length > 0 ? floorAps : apList;
  let nearest = null;
  let minDist = Infinity;
  for (const ap of candidates) {
    let d;
    if (rawXM != null && rawYM != null && ap.x_m != null && ap.y_m != null) {
      d = Math.hypot(Number(rawXM) - ap.x_m, Number(rawYM) - ap.y_m);
    } else if (rawX != null && rawY != null && ap.x != null && ap.y != null) {
      d = Math.hypot(Number(rawX) - ap.x, Number(rawY) - ap.y) / (ppm || 50.07391564392213);
    }
    if (d !== undefined && d < minDist) {
      minDist = d;
      nearest = ap;
    }
  }
  return nearest;
}

const initialState = {
  activeFloor: "GR",
  tagFloor: "GR", // Physical floor where the visitor tag is currently located
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
  mistNearbyRadius: 3.0, // Only store raw locations within 3m radius around Mist AP
  locationQueue: [],
  queueCapacity: 8, // optimized for low-latency live walking
  rssiThreshold: -65,
  bleSignal: {
    rssi: null,
    raw_rssi: null,
    beam: null,
    ap_mac: null,
    last_seen: null,
    queueSize: 0,
    queueCapacity: 8,
    rssiThreshold: -65,
    distToMist: null,
    isNearbyMist: true,
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

        if (rawApMac) state.activeApMac = rawApMac;

        const effectiveApMac = rawApMac || state.activeApMac;
        const currentFloor = state.activeFloor || "GR";
        const mapId = responseData.location.map_id;

        // Find associated Mist AP
        const mistAp = getMistApForLocation(
          effectiveApMac,
          mapId,
          currentFloor,
          rawX,
          rawY,
          rawXM,
          rawYM,
          state.mapMeta?.ppm
        );

        // Calculate distance from incoming raw coordinates to Mist AP
        let distToMistMeters = null;
        if (mistAp) {
          if (
            rawXM !== null &&
            rawYM !== null &&
            !isNaN(Number(rawXM)) &&
            !isNaN(Number(rawYM)) &&
            mistAp.x_m !== undefined &&
            mistAp.y_m !== undefined &&
            mistAp.x_m !== null &&
            mistAp.y_m !== null
          ) {
            distToMistMeters = Math.hypot(
              Number(rawXM) - mistAp.x_m,
              Number(rawYM) - mistAp.y_m
            );
          } else if (
            rawX !== null &&
            rawY !== null &&
            !isNaN(Number(rawX)) &&
            !isNaN(Number(rawY)) &&
            mistAp.x !== undefined &&
            mistAp.y !== undefined &&
            mistAp.x !== null &&
            mistAp.y !== null
          ) {
            const distPx = Math.hypot(
              Number(rawX) - mistAp.x,
              Number(rawY) - mistAp.y
            );
            const activePpm =
              state.mapMeta?.ppm ||
              state.floorMapData?.[currentFloor]?.mapMeta?.ppm ||
              50.07391564392213;
            distToMistMeters = distPx / activePpm;
          }
        }

        const nearbyRadius = state.mistNearbyRadius ?? 3.0;
        // Accept location only if nearby the Mist AP (within 3m radius)
        const isNearbyMist =
          distToMistMeters === null || distToMistMeters <= nearbyRadius;

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

        // ONLY STORE raw locations that are NEARBY THE MIST (<= 3m)
        if (isValidCoords && isNearbyMist) {
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
              distToMist: distToMistMeters,
              timestamp: responseData.location.last_seen || Date.now(),
            });
          }

          if (state.locationQueue.length > state.queueCapacity) {
            state.locationQueue = state.locationQueue.slice(
              -state.queueCapacity,
            );
          }

          // Weighted averaging with responsive recent bias
          const qLength = state.locationQueue.length;
          if (qLength > 0) {
            const weights = [];
            let sumWeight = 0;
            for (let i = 0; i < qLength; i++) {
              const w = Math.pow(0.75, qLength - 1 - i); // Faster response to recent changes
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
              x: avgX,
              y: avgY,
              x_m: avgXM,
              y_m: avgYM,
              rssi: avgRssi,
              beam: rawBeam,
              ap_mac: rawApMac,
              distToMist: distToMistMeters,
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
              distToMist: distToMistMeters,
              isNearbyMist: true,
            };
          } else {
            // First valid nearby location
            state.visitorPos = {
              x: Number(rawX),
              y: Number(rawY),
              x_m: rawXM,
              y_m: rawYM,
              rssi: rawRssi,
              beam: rawBeam,
              ap_mac: rawApMac,
              distToMist: distToMistMeters,
            };

            state.bleSignal = {
              rssi: rawRssi,
              raw_rssi: rawRssi,
              beam: rawBeam,
              ap_mac: rawApMac,
              last_seen: responseData.location.last_seen ?? null,
              x: Number(rawX),
              y: Number(rawY),
              x_m: rawXM,
              y_m: rawYM,
              queueSize: 1,
              queueCapacity: state.queueCapacity,
              rssiThreshold: state.rssiThreshold,
              distToMist: distToMistMeters,
              isNearbyMist: true,
            };
          }
        } else if (!isNearbyMist && distToMistMeters !== null) {
          // Location is outside the 3m Mist radius - ignore/drop from queue
          console.warn(
            `⚠️ [Location Filter] Dropping raw location (${Number(rawX).toFixed(1)}, ${Number(rawY).toFixed(1)}): ` +
            `${distToMistMeters.toFixed(2)}m from Mist AP "${mistAp?.name || mistAp?.mac || "AP"}" (exceeds ${nearbyRadius}m nearby radius)`
          );

          // Update diagnostics without overwriting visitorPos
          state.bleSignal = {
            ...state.bleSignal,
            rssi: rawRssi,
            raw_rssi: rawRssi,
            beam: rawBeam,
            ap_mac: rawApMac,
            last_seen: responseData.location.last_seen ?? null,
            distToMist: distToMistMeters,
            isNearbyMist: false,
          };
        } else if (isValidCoords && !state.visitorPos) {
          // If no mist AP was resolvable at all, store as fallback
          state.visitorPos = {
            x: Number(rawX),
            y: Number(rawY),
            x_m: rawXM,
            y_m: rawYM,
            rssi: rawRssi,
            beam: rawBeam,
            ap_mac: rawApMac,
            distToMist: null,
          };
        }
      }

      // ---- MAP & TARGET ----
      const incomingTagFloor =
        responseData.location?.map_id === "cfa55e13-794f-4081-b1b7-e35f1ea67325" ||
        responseData.map?.id === "cfa55e13-794f-4081-b1b7-e35f1ea67325"
          ? "F1"
          : "GR";

      // Detect if tag physically transitioned to a different floor
      if (responseData.location?.map_id && state.tagFloor !== incomingTagFloor) {
        state.tagFloor = incomingTagFloor;
        // Auto-sync activeFloor when the tag physically arrives on a new floor
        state.activeFloor = incomingTagFloor;
      }

      if (responseData.map) {
        state.floorMapData[incomingTagFloor].mapMeta = responseData.map;
        if (state.activeFloor === incomingTagFloor) {
          state.mapMeta = responseData.map;
        }
      }

      // ---- WAYFINDING ----
      if (responseData.wayfinding) {
        if (state.floorMapData[incomingTagFloor]) {
          state.floorMapData[incomingTagFloor].wayfindingData =
            responseData.wayfinding;
        }
        if (state.activeFloor === incomingTagFloor) {
          state.wayfindingData = responseData.wayfinding;
          if (responseData.wayfinding.route_to_destination) {
            state.activeRoute = responseData.wayfinding.route_to_destination;
          }
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

    setMistNearbyRadius: (state, action) => {
      const val = Number(action.payload);
      if (!isNaN(val) && val > 0) {
        state.mistNearbyRadius = val;
      }
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
  setMistNearbyRadius,
} = floorSlice.actions;

export const selectBleSignal = (state) => state.floor.bleSignal;
export const selectTagFloor = (state) => state.floor.tagFloor;
export default floorSlice.reducer;
