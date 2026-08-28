// src/api/assetApi.js
import axios from "axios";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:8000/api/IDVisitor";

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
