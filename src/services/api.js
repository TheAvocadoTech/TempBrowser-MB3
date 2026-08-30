import axios from "axios";
//

// Base URL points to local running backend or REACT_APP_API_URL
const configuredUrl =
  process.env.REACT_APP_API_URL || "http://localhost:8000/api/IDVisitor";
const rawBaseUrl = configuredUrl.replace(/^https:\/\/localhost/i, "http://localhost").replace(/^https:\/\/127\.0\.0\.1/i, "http://127.0.0.1");

const API_BASE_URL = rawBaseUrl.endsWith("/IDVisitor")
  ? rawBaseUrl
  : `${rawBaseUrl.replace(/\/+$/, "")}/IDVisitor`;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Automatic fallback to local backend if remote API is unreachable or returns 404/5xx
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (!config || config._isRetry) {
      return Promise.reject(error);
    }

    const isRemote = config.baseURL && !config.baseURL.includes("localhost:8000");
    if (isRemote) {
      config._isRetry = true;
      config.baseURL = "http://localhost:8000/api/IDVisitor";
      try {
        return await axios(config);
      } catch (localErr) {
        return Promise.reject(localErr);
      }
    }
    return Promise.reject(error);
  }
);

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
      const urlMac = urlParams.get("mac") || urlParams.get("tagMac");
      const urlTag = urlParams.get("tag") || urlParams.get("tagId");

      if (urlVisitorId) {
        targetId = urlVisitorId;
      } else if (urlToken) {
        const tokenRes = await getVisitorByToken(urlToken);
        if (tokenRes && (tokenRes.data || tokenRes.id)) {
          const vData = tokenRes.data || tokenRes;
          targetId = vData._id || vData.id;
        }
      } else if (urlMac || urlTag) {
        const visitorsRes = await getAllVisitors();
        const vList = visitorsRes?.data || (Array.isArray(visitorsRes) ? visitorsRes : []);
        const match = vList.find(
          (v) =>
            (urlMac && (v.tagMac?.toLowerCase() === urlMac.toLowerCase() || v.mistMacAddress?.toLowerCase() === urlMac.toLowerCase())) ||
            (urlTag && (v.tagNickname?.toLowerCase() === urlTag.toLowerCase() || v.idNumber?.toLowerCase() === urlTag.toLowerCase() || v.tagId?._id === urlTag))
        );
        if (match) {
          targetId = match._id || match.id;
        }
      }
    }

    const isValidMongoId = (id) =>
      typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);

    // 2. Resolve cached or active visitor ID if targetId is still not valid Mongo ID
    if (!isValidMongoId(targetId)) {
      if (cachedVisitorId) {
        targetId = cachedVisitorId;
      } else {
        const visitorsRes = await getAllVisitors();
        const vList = visitorsRes?.data || (Array.isArray(visitorsRes) ? visitorsRes : []);
        if (Array.isArray(vList) && vList.length > 0) {
          const activeVisitor = vList.find((v) => v.idNumber || v._id) || vList[0];
          targetId = activeVisitor._id || activeVisitor.id;
          cachedVisitorId = targetId;
        }
      }
    }

    // Fallback default active visitor ID (Sarath Suresh in DB)
    if (!targetId || !isValidMongoId(targetId)) {
      targetId = "6a80369e83f5e8026f6444a9";
    }

    // Try fetching location for targetId
    try {
      const response = await apiClient.get(
        `/visitors/${targetId}/location?includePath=true`
      );
      const resPayload = response?.data?.data || response?.data;
      if (resPayload && (resPayload.location || resPayload.visitor || resPayload.target_coordinates)) {
        cachedVisitorId = targetId;
        return { success: true, ...resPayload };
      }
    } catch (reqErr) {
      console.warn(`Location fetch for ${targetId} failed, retrying with fresh visitor lookup...`, reqErr.message);
      cachedVisitorId = null;
    }

    // If initial fetch failed, query active visitors directly from DB
    const visitorsRes = await getAllVisitors();
    const vList = visitorsRes?.data || (Array.isArray(visitorsRes) ? visitorsRes : []);
    if (Array.isArray(vList) && vList.length > 0) {
      const activeVisitor = vList[0];
      targetId = activeVisitor._id || activeVisitor.id;
      cachedVisitorId = targetId;

      const fallbackRes = await apiClient.get(
        `/visitors/${targetId}/location?includePath=true`
      );
      const fallbackPayload = fallbackRes?.data?.data || fallbackRes?.data;
      return { success: true, ...fallbackPayload };
    }

    return {
      success: false,
      message: "Failed to fetch visitor location",
      data: null,
    };
  } catch (error) {
    cachedVisitorId = null;
    return {
      success: false,
      message: error.message || "Failed to fetch visitor location",
      data: null,
    };
  }
};

/**
 * Fetch map details directly by mapId
 */
export const getMapDetails = async (mapId) => {
  try {
    console.log(`🗺️ [API] Requesting map details for mapId: ${mapId}`);
    const response = await apiClient.get(`/maps/${mapId}`);
    console.log(`✅ [API] Map details response received for ${mapId}:`, {
      id: response.data?.id,
      name: response.data?.name,
      ppm: response.data?.ppm,
      width: response.data?.width,
      height: response.data?.height,
      url: response.data?.url,
      hasWayfinding: !!response.data?.wayfinding_path,
    });
    return response.data;
  } catch (error) {
    console.warn("❌ [API] Map details API notice:", error.message);
    return null;
  }
};

/**
 * Fetch wayfinding path (nodes & edges) for map
 */
export const getWayfindingPath = async (mapId) => {
  try {
    console.log(`🧭 [API] Requesting wayfinding path for mapId: ${mapId}`);
    const response = await apiClient.get(`/maps/${mapId}/wayfinding`);
    console.log(`✅ [API] Wayfinding response for ${mapId}:`, {
      nodesCount: response.data?.nodes?.length || (Array.isArray(response.data) ? response.data.length : 0),
      edgesCount: response.data?.edges ? Object.keys(response.data.edges).length : 0,
    });
    return response.data;
  } catch (error) {
    console.warn("❌ [API] Wayfinding path API notice:", error.message);
    return null;
  }
};

export default apiClient;
