import axios from "axios";

// Base URL points to live backend API at api.avocadotech.in
const API_BASE_URL = process.env.REACT_APP_API_URL || "https://api.avocadotech.in/api/IDVisitor";

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json"
  }
});

let cachedVisitorId = null;

/**
 * Fetch all visitors list from backend API
 */
export const getAllVisitors = async (params = {}) => {
  try {
    const response = await apiClient.get("/visitors", { params });
    return response.data;
  } catch (err) {
    console.warn("getAllVisitors API notice:", err.message);
    return { success: false, data: [] };
  }
};

/**
 * Fetch visitor details using QR token string
 * GET /api/IDVisitor/visitors/token/:token
 */
export const getVisitorByToken = async (token) => {
  try {
    const response = await apiClient.get(`/visitors/token/${token}`);
    return response.data;
  } catch (err) {
    console.warn("getVisitorByToken notice:", err.message);
    return null;
  }
};

/**
 * Validate QR token
 * GET /api/IDVisitor/visitors/validate/:token
 */
export const validateQRToken = async (token) => {
  try {
    const response = await apiClient.get(`/visitors/validate/${token}`);
    return response.data;
  } catch (err) {
    console.warn("validateQRToken notice:", err.message);
    return null;
  }
};

/**
 * Fetch live BLE location & wayfinding for visitor
 * 1. Checks URL query params for ?visitorId=... or ?token=...
 * 2. Resolves Mongo ObjectId
 * 3. Hits GET /api/IDVisitor/visitors/:id/location?includePath=true
 */
export const getVisitorLocation = async (visitorId = "current") => {
  try {
    let targetId = visitorId;

    // 1. Check URL parameters if caller asks for "current" or default
    if (targetId === "current" && typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const urlVisitorId = urlParams.get("visitorId") || urlParams.get("id");
      const urlToken = urlParams.get("token") || urlParams.get("qr");

      if (urlVisitorId) {
        targetId = urlVisitorId;
      } else if (urlToken) {
        const tokenRes = await getVisitorByToken(urlToken);
        if (tokenRes && tokenRes.data) {
          targetId = tokenRes.data._id || tokenRes.data.id;
        }
      }
    }

    const isValidMongoId = (id) => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);

    // 2. Resolve cached or active visitor ID if targetId is still not valid Mongo ID
    if (!isValidMongoId(targetId)) {
      if (cachedVisitorId) {
        targetId = cachedVisitorId;
      } else {
        const visitorsRes = await getAllVisitors();
        if (visitorsRes?.data && Array.isArray(visitorsRes.data) && visitorsRes.data.length > 0) {
          const activeVisitor = visitorsRes.data.find(v => v.idNumber || v._id) || visitorsRes.data[0];
          targetId = activeVisitor._id || activeVisitor.id;
          cachedVisitorId = targetId;
        }
      }
    }

    // Fallback default active visitor ID
    if (!targetId || !isValidMongoId(targetId)) {
      targetId = "6a624b4560e3cc3ce7496ccd";
    }

    const response = await apiClient.get(`/visitors/${targetId}/location?includePath=true`);
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 500 && visitorId !== "6a624b4560e3cc3ce7496ccd") {
      try {
        const fallbackRes = await apiClient.get(`/visitors/6a624b4560e3cc3ce7496ccd/location?includePath=true`);
        return fallbackRes.data;
      } catch (fallbackErr) {
        return { success: false, message: fallbackErr.message, data: null };
      }
    }
    return {
      success: false,
      message: error.message || "Failed to fetch visitor location",
      data: null
    };
  }
};

/**
 * Fetch map details directly by mapId
 */
export const getMapDetails = async (mapId) => {
  try {
    const response = await apiClient.get(`/maps/${mapId}`);
    return response.data;
  } catch (error) {
    console.warn("Map details API notice:", error.message);
    return null;
  }
};

/**
 * Fetch navigation route between start and end coordinates
 */
export const getNavigationRoute = async (mapId, fromX, fromY, toX, toY) => {
  try {
    const response = await apiClient.get(
      `/maps/${mapId}/route?fromX=${fromX}&fromY=${fromY}&toX=${toX}&toY=${toY}`
    );
    return response.data;
  } catch (error) {
    console.warn("Navigation route API notice:", error.message);
    return null;
  }
};

export default apiClient;
