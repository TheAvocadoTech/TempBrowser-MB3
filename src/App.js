import React, { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setFloor, updateLiveLocation, setActiveRoute } from './store/floorSlice';
import Header from './components/Header';
import MapView2D from './components/MapView2D';
import CommonButton from './components/CommonButton';
import { getVisitorLocation, getNavigationRoute, getMapDetails } from './services/api';
import { LIFT_COORDINATES } from './constants';

export default function App() {
  const dispatch = useDispatch();

  // Redux state selectors
  const activeFloor = useSelector((state) => state.floor.activeFloor);
  const visitorPos = useSelector((state) => state.floor.visitorPos);
  const targetPos = useSelector((state) => state.floor.targetPos);
  const mapMeta = useSelector((state) => state.floor.mapMeta);
  const wayfindingData = useSelector((state) => state.floor.wayfindingData);
  const activeRoute = useSelector((state) => state.floor.activeRoute);
  const distance = useSelector((state) => state.floor.distance);
  const proximity = useSelector((state) => state.floor.proximity);

  // 1. Initial Load: Fetch map details & 37 wayfinding nodes directly from backend
  useEffect(() => {
    const initData = async () => {
      try {
        const defaultMapId = "cfa55e13-794f-4081-b1b7-e35f1ea67325";
        const mapRes = await getMapDetails(defaultMapId);
        if (mapRes && mapRes.data) {
          dispatch(updateLiveLocation({ map: mapRes.data, wayfinding_path: mapRes.data.wayfinding_path }));
        } else if (mapRes) {
          dispatch(updateLiveLocation({ map: mapRes, wayfinding_path: mapRes.wayfinding_path }));
        }
      } catch (err) {
        console.warn("Map details init notice:", err.message);
      }
    };

    initData();
  }, [dispatch]);

  // 2. Fetch real-time BLE location for active visitor
  const fetchRealtimeLocation = useCallback(async () => {
    try {
      const data = await getVisitorLocation('current');

      if (data && (data.success || data.location)) {
        dispatch(updateLiveLocation(data));

        const responseData = data.data || data;
        const bleX = responseData?.location?.x;
        const bleY = responseData?.location?.y;
        const mapId = responseData?.location?.map_id || "cfa55e13-794f-4081-b1b7-e35f1ea67325";

        let finalX, finalY;
        if (activeFloor === 'GR') {
          finalX = LIFT_COORDINATES.x;
          finalY = LIFT_COORDINATES.y;
        } else {
          finalX = responseData?.target_coordinates?.x || 5525.30;
          finalY = responseData?.target_coordinates?.y || 2491.84;
        }

        // Calculate navigation route
        if (mapId && bleX !== undefined && bleY !== undefined && finalX !== undefined && finalY !== undefined) {
          try {
            const routeRes = await getNavigationRoute(mapId, bleX, bleY, finalX, finalY);
            if (routeRes && routeRes.route) {
              dispatch(setActiveRoute(routeRes.route));
            }
          } catch (routeErr) {
            console.warn("Route API notice:", routeErr.message);
          }
        }
      }
    } catch (err) {
      console.warn("Realtime location poll notice:", err.message);
    }
  }, [activeFloor, dispatch]);

  // Real-time backend polling interval
  useEffect(() => {
    fetchRealtimeLocation();

    const interval = setInterval(() => {
      fetchRealtimeLocation();
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchRealtimeLocation]);

  const handleFloorChange = (newFloor) => {
    if (newFloor !== activeFloor) {
      dispatch(setFloor(newFloor));
    }
  };

  const handleCommonButtonClick = () => {
    console.log('Common action clicked');
  };

  return (
    <div className="app-viewport">
      <div className="mobile-card-container">
        {/* Header Section */}
        <Header />

        {/* 2D Interactive SVG Navigation Map View */}
        <main className="main-map-section">
          <MapView2D
            floor={activeFloor}
            onFloorChange={handleFloorChange}
            mapDetails={mapMeta}
            bleLocation={visitorPos}
            targetCoordinates={targetPos}
            wayfindingData={wayfindingData}
            activeRoute={activeRoute}
            distance={distance}
            proximity={proximity}
          />
        </main>

        {/* Bottom Navigation Section */}
        <CommonButton onClick={handleCommonButtonClick} />
      </div>
    </div>
  );
}
