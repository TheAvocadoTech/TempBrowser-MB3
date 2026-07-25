import { createSlice } from "@reduxjs/toolkit";
import { LIFT_COORDINATES, CABINET_COORDINATES } from "../constants";

const initialState = {
  activeFloor: "GR", // 'GR' or 'F1'
  visitorInfo: null,
  visitorPos: null, // { x, y, name, mac, map_id }
  targetPos: { x: LIFT_COORDINATES.x, y: LIFT_COORDINATES.y }, // Default GR Lift target
  mapMeta: null, // { id, name, width, height, ppm, origin_x, origin_y, wayfinding_path }
  wayfindingData: null, // { total_nodes, total_edges, nodes, edges, route_to_destination, nearest_node }
  activeRoute: null, // { path, nodes, segments }
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

      // Update target position based on floor selection
      if (newFloor === "GR") {
        state.targetPos = { x: LIFT_COORDINATES.x, y: LIFT_COORDINATES.y };
      } else if (newFloor === "F1") {
        state.targetPos = { x: CABINET_COORDINATES.x, y: CABINET_COORDINATES.y };
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

      if (responseData.map) {
        state.mapMeta = responseData.map;
      }

      // Handle both wayfinding (from location API) and wayfinding_path (from map details API)
      const wayfindingPayload =
        responseData.wayfinding ||
        responseData.wayfinding_path ||
        responseData.map?.wayfinding_path;
      if (wayfindingPayload) {
        state.wayfindingData = wayfindingPayload;
        if (wayfindingPayload.route_to_destination) {
          state.activeRoute = wayfindingPayload.route_to_destination;
        }
      }

      // Target coordinates for F1 (Cabinet) and GR (Lift)
      if (state.activeFloor === "F1") {
        state.targetPos = { x: CABINET_COORDINATES.x, y: CABINET_COORDINATES.y };
      } else if (state.activeFloor === "GR") {
        state.targetPos = { x: LIFT_COORDINATES.x, y: LIFT_COORDINATES.y };
      }

      // Distance calculation: from Live BLE on GR, from Lift on F1
      const startX = state.activeFloor === "F1" ? LIFT_COORDINATES.x : state.visitorPos?.x;
      const startY = state.activeFloor === "F1" ? LIFT_COORDINATES.y : state.visitorPos?.y;

      if (
        startX !== undefined &&
        state.targetPos?.x !== undefined
      ) {
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

export const { setFloor, updateLiveLocation, setActiveRoute, setAssets } =
  floorSlice.actions;
export default floorSlice.reducer;
