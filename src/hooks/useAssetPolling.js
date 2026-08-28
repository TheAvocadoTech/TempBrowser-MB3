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

        if (isMounted && result) {
          let rawList = [];
          if (Array.isArray(result.data)) {
            rawList = result.data;
          } else if (Array.isArray(result)) {
            rawList = result;
          } else if (result.assets && typeof result.assets === "object") {
            rawList = Object.entries(result.assets).map(([mac, data]) => ({
              mac,
              ...data,
            }));
          }

          if (rawList.length > 0) {
            const assetArray = rawList.map((data) => {
              const rawData = data.raw || data;
              return {
                mac: data.mac || rawData.mac,
                device_name: data.device_name || rawData.name || rawData.device_name || "Asset",
                position: data.position || {
                  x_m: data.x_m,
                  y_m: data.y_m,
                },
                position_px: data.position_px || {
                  x: rawData.x || data.x,
                  y: rawData.y || data.y,
                },
                ap_mac: data.ap_mac || rawData.ap_mac,
                beam: data.beam !== undefined ? data.beam : rawData.beam,
                rssi: data.rssi !== undefined ? data.rssi : rawData.rssi,
                raw_rssi: data.raw_rssi || rawData.rssi,
                best_rssi: data.best_rssi || data.rssi || rawData.rssi,
                stability: data.stability !== undefined ? data.stability : 1.0,
                is_stable: data.is_stable !== undefined ? data.is_stable : true,
                lastUpdate: data.lastUpdate || rawData.last_seen || Date.now(),
                map_id: data.map_id || rawData.map_id,
                apHistory: data.apHistory || [],
              };
            });

            dispatch(setAssets(assetArray));

            // Pick the asset with the strongest RSSI
            const primaryAsset = assetArray.reduce(
              (best, current) =>
                (current.rssi || -Infinity) > (best.rssi || -Infinity)
                  ? current
                  : best,
              assetArray[0]
            );

            if (primaryAsset) {
              dispatch(
                updateLiveLocation({
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
                    queueCapacity: 8,
                    rssiThreshold: -60,
                    tagMac: primaryAsset.mac,
                    tagName: primaryAsset.device_name,
                  },
                })
              );
            }
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