// src/hooks/useAssetPolling.js
import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { setAssets, updateLiveLocation } from "../store/floorSlice";
import { getAllAssets } from "../services/assetApi";

export const useAssetPolling = (interval = 5000) => {
  const dispatch = useDispatch();

  useEffect(() => {
    let isMounted = true;

    const fetchAssets = async () => {
      try {
        const result = await getAllAssets();

        if (isMounted && result && result.assets) {
          const assetArray = Object.entries(result.assets).map(([mac, data]) => ({
            mac,
            device_name: data.device_name,
            position: data.position,
            position_px: data.position_px,
            ap_mac: data.ap_mac,
            beam: data.beam,
            rssi: data.rssi,
            raw_rssi: data.raw_rssi,
            best_rssi: data.best_rssi,
            stability: data.stability,
            is_stable: data.is_stable,
            lastUpdate: data.lastUpdate,
            map_id: data.map_id,
            apHistory: data.apHistory || [],
          }));

          dispatch(setAssets(assetArray));

          if (assetArray.length > 0) {
            // Pick the asset with the strongest RSSI (or you could pick a specific one)
            const primaryAsset = assetArray.reduce((best, current) =>
              (current.rssi || -Infinity) > (best.rssi || -Infinity) ? current : best
            , assetArray[0]);

            dispatch(updateLiveLocation({
              bleSignal: {
                rssi: primaryAsset.rssi,
                raw_rssi: primaryAsset.raw_rssi,
                beam: primaryAsset.beam,
                ap_mac: primaryAsset.ap_mac,
                last_seen: primaryAsset.lastUpdate
                  ? Math.floor(primaryAsset.lastUpdate / 1000)
                  : null,
                x: primaryAsset.position_px?.x,
                y: primaryAsset.position_px?.y,
                x_m: primaryAsset.position?.x_m,
                y_m: primaryAsset.position?.y_m,
                queueSize: assetArray.length,
                queueCapacity: 80,
                rssiThreshold: -60,
                // NEW: pass tag identity
                tagMac: primaryAsset.mac,
                tagName: primaryAsset.device_name,
              }
            }));
          }
        }
      } catch (error) {
        console.error("Asset polling error:", error);
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