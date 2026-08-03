// src/api/assetApi.js
import axios from "axios";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "https://api.avocadotech.in/api";

export const getAllAssets = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/assets`);
    return response.data; // { timestamp, assets: { mac: { ... } } }
  } catch (error) {
    console.error("Failed to fetch assets:", error);
    return null;
  }
};
