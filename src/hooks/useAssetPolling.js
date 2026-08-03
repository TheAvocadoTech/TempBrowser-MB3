// src/hooks/useAssetPolling.js
import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { setAssets } from "../store/floorSlice";
import { getAllAssets } from "../services/assetApi";

export const useAssetPolling = (interval = 5000) => {
  const dispatch = useDispatch();

  useEffect(() => {
    let isMounted = true;

    const fetchAssets = async () => {
      const result = await getAllAssets();
      if (isMounted && result && result.assets) {
        // Transform object { mac: { ... } } into array
        const assetArray = Object.entries(result.assets).map(([mac, data]) => ({
          mac,
          ...data,
        }));
        dispatch(setAssets(assetArray));
      }
    };

    fetchAssets();
    const timer = setInterval(fetchAssets, interval);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [dispatch, interval]);
};
