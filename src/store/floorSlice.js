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
        state.visitorPos = responseData.location;
      }

      // Update mapMeta & wayfindingData for GR floor only
      if (responseData.map) {
        state.floorMapData.GR.mapMeta = responseData.map;
        if (state.activeFloor === "GR") {
          state.mapMeta = responseData.map;
        }
      }

      const wayfindingPayload =
        responseData.wayfinding ||
        responseData.wayfinding_path ||
        responseData.map?.wayfinding_path;
      if (wayfindingPayload) {
        state.floorMapData.GR.wayfindingData = wayfindingPayload;
        if (state.activeFloor === "GR") {
          state.wayfindingData = wayfindingPayload;
          if (wayfindingPayload.route_to_destination) {
            state.activeRoute = wayfindingPayload.route_to_destination;
          }
        }
      }

      // Target coordinates for F1 (Cabinet) and GR (Lift)
      if (state.activeFloor === "F1") {
        state.targetPos = { x: CABINET_COORDINATES.x, y: CABINET_COORDINATES.y };
      } else if (state.activeFloor === "GR") {
        state.targetPos = { x: LIFT_COORDINATES.x, y: LIFT_COORDINATES.y };
      }

      // Distance calculation: from Live BLE on GR, from F1 Lift on F1
      const startX =
        state.activeFloor === "F1" ? F1_LIFT_COORDINATES.x : state.visitorPos?.x;
      const startY =
        state.activeFloor === "F1" ? F1_LIFT_COORDINATES.y : state.visitorPos?.y;

      if (startX !== undefined && state.targetPos?.x !== undefined) {
        const dx = state.targetPos.x - startX;
        const dy = state.targetPos.y - startY;
        state.distance = Math.sqrt(dx * dx + dy * dy);
      } else if (responseData.distance !== undefined) {
        state.distance = responseData.distance;
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
export default floorSlice.reducer;
