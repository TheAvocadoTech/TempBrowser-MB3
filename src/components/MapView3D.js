// MapView3D.js – final backend‑only version

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

export const MODEL_CALIBRATION = { /* ... unchanged ... */ };

function createDashedTexture() { /* ... unchanged ... */ }

export default function MapView3D({
  floor,
  onFloorChange,
  mapDetails,
  bleLocation,
  targetCoordinates: targetPos,
  wayfindingData,
  activeRoute,
  distance,
  proximity,
  assets = [],
}) {
  // ... (scene setup, refs, state) ...

  const mapWidth = mapDetails?.width || 6400;
  const mapHeight = mapDetails?.height || 5120;
  const ppm = mapDetails?.ppm || 50.07;
  const widthMeters = mapDetails?.width_m || mapWidth / ppm;
  const heightMeters = mapDetails?.height_m || mapHeight / ppm;

  const mapTo3D = useCallback(/* ... */, [ppm, widthMeters, heightMeters]);

  // Load 3D model – unchanged

  // Render markers and path
  useEffect(() => {
    if (!markersGroupRef.current) return;
    const markersGroup = markersGroupRef.current;
    // Clear previous markers
    while (markersGroup.children.length) markersGroup.remove(markersGroup.children[0]);

    // 1. Live BLE Location
    const bleX = bleLocation?.x ?? 5004.59;
    const bleY = bleLocation?.y ?? 2313.4;
    const blePos3D = mapTo3D(bleX, bleY, 1.8);
    // ... create bleMesh and ringMesh ...

    // 2. TARGET DESTINATION (from backend)
    let destX, destY, destColor;
    if (targetPos && targetPos.x !== undefined && targetPos.y !== undefined) {
      destX = targetPos.x;
      destY = targetPos.y;
      destColor = floor === "GR" ? 0x9333ea : 0xea580c;
    } else {
      // No target – skip
      return;
    }
    const destPos3D = mapTo3D(destX, destY, 2.0);
    // ... create destMesh ...

    // 3. Wayfinding Nodes – from backend (activeRoute or wayfindingData)
    const allGraphNodes = activeRoute?.nodes || wayfindingData?.nodes || [];
    // ... create node spheres ...

    // 4. Route Path – from backend waypoints
    const routeNodes = activeRoute?.nodes || wayfindingData?.route_to_destination?.nodes || [];
    const routePoints = [blePos3D];
    if (routeNodes && routeNodes.length > 0) {
      routeNodes.forEach((node) => {
        const pos = node.position || node;
        if (pos && pos.x !== undefined && pos.y !== undefined) {
          routePoints.push(mapTo3D(pos.x, pos.y, 0.6));
        }
      });
    }
    routePoints.push(destPos3D);
    if (routePoints.length >= 2 && dashedTextureRef.current) {
      // ... create ribbon mesh ...
    }

    // 5. Other Assets
    if (assets && assets.length > 0) {
      const otherGeom = new THREE.SphereGeometry(0.8, 16, 16);
      const otherMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.3 });
      assets.forEach((asset) => {
        if (asset.map_id !== mapDetails?.id) return;
        const px = asset.position?.x_m;
        const py = asset.position?.y_m;
        if (px == null || py == null) return;
        const pixelX = px * ppm;
        const pixelY = py * ppm;
        const pos3D = mapTo3D(pixelX, pixelY, 0.8);
        const mesh = new THREE.Mesh(otherGeom, otherMat);
        mesh.position.copy(pos3D);
        markersGroup.add(mesh);
      });
    }
  }, [bleLocation, targetPos, floor, mapDetails, wayfindingData, activeRoute, mapTo3D, ppm, assets]);

  // ... zoom controls, render ...
}