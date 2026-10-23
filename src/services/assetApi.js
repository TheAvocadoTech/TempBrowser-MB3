// src/api/assetApi.js
import axios from "axios";

const rawUrl =
  process.env.REACT_APP_API_URL || "https://api.avocadotech.in/api/IDVisitor";
const API_BASE_URL = rawUrl.replace(/^https:\/\/localhost/i, "http://localhost").replace(/^https:\/\/127\.0\.0\.1/i, "http://127.0.0.1");

export const getAllAssets = async () => {
  try {
    const baseUrl = API_BASE_URL.endsWith("/IDVisitor")
      ? API_BASE_URL
      : `${API_BASE_URL}/IDVisitor`;
    const response = await axios.get(`${baseUrl}/assets/locations`);
    return response.data; // { timestamp, assets: { mac: { ... } } }
  } catch (error) {
    console.warn("Failed to fetch assets:", error.message);
    return null;
  }
};
