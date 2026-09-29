import React, { memo, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import L from 'leaflet';
import { DEFAULT_RADIUS_METERS, isValidCoordinate } from '../config';

// Fix standard Leaflet default icon path
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

/** Alarm titles are user input and are rendered into a Leaflet popup. */
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// 📍 Glowing Red Alarm Pin (Vector HTML DivIcon - 100% Reliable & Sharp)
const createRedAlarmIcon = (_title: string) => {
  return L.divIcon({
    className: 'custom-red-alarm-marker',
    html: `
      <div style="position:relative; width:32px; height:32px; display:flex; justify-content:center; align-items:center;">
        <div style="position:absolute; width:28px; height:28px; border-radius:50%; background:rgba(239,68,68,0.3); animation:pulseGlow 2s infinite;"></div>
        <div style="width:18px; height:18px; border-radius:50%; background:#ef4444; border:2.5px solid #ffffff; box-shadow:0 0 10px #ef4444;"></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  });
};

/**
 * Tile sources, all keyless.
 *
 * CARTO's `basemaps.cartocdn.com` now demands an API key and answers with a
 * placeholder image for every coordinate, so it is deliberately not used here.
 * `errorTileUrl` points at a blank tile so a provider failure degrades to an
 * empty background instead of a repeating "api key required" graphic.
 */
const TILE_ERROR_URL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const TILE_LAYERS: Record<LeafletMapStyle, string> = {
  dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  light: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};

/**
 * Transparent label overlays. The Esri dark canvas and imagery layers ship
 * without place names, so these are stacked on top; the OSM light style already
 * labels its own tiles.
 */
const TILE_LABEL_LAYERS: Partial<Record<LeafletMapStyle, string>> = {
  dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
};

/** Tried in order if a style's primary provider fails to load. */
const TILE_FALLBACKS: Record<LeafletMapStyle, string[]> = {
  dark: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  light: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
  // No keyless imagery mirror, so degrade to the dark canvas rather than
  // repeating the same failing URL, which would spin the swap loop forever.
  satellite: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
};

/**
 * Builds the tile layer for a style and, if the provider starts returning
 * errors, transparently swaps in the next source. This is what stops a
 * key-gated or rate-limited provider from showing a broken/placeholder map.
 */
const createTileLayer = (style: LeafletMapStyle): L.TileLayer => {
  const candidates = [TILE_LAYERS[style], ...TILE_FALLBACKS[style]];
  let index = 0;
  let warned = false;

  const layer = L.tileLayer(candidates[index], {
    maxZoom: 19,
    errorTileUrl: TILE_ERROR_URL,
  });

  layer.on('tileerror', () => {
    if (index < candidates.length - 1) {
      // Give the next provider a chance before showing anything.
      index += 1;
      layer.setUrl(candidates[index]);
      return;
    }
    if (!warned) {
      warned = true;
      console.warn(`Map tiles for "${style}" are unavailable from every configured provider.`);
    }
  });

  return layer;
};

/** The optional label overlay for a style, if it needs one. */
const createLabelLayer = (style: LeafletMapStyle): L.TileLayer | null => {
  const url = TILE_LABEL_LAYERS[style];
  if (!url) return null;
  return L.tileLayer(url, { maxZoom: 19, errorTileUrl: TILE_ERROR_URL, pane: 'tilePane' });
};

export type LeafletMapStyle = 'dark' | 'light' | 'satellite';

interface LeafletMapProps {
  customPin: { lat: number; lng: number } | null;
  radius: number;
  userLocation: { lat: number; lng: number } | null;
  alarms: any[];
  mapStyle: LeafletMapStyle;
  accentColor: string;
  focusLocation: { lat: number; lng: number; key: number } | null;
  isPinMode: boolean;
  onLocationSelect: (lat: number, lng: number) => void;
}

function LeafletMapInner({
  customPin,
  radius,
  userLocation,
  alarms,
  mapStyle,
  accentColor,
  focusLocation,
  isPinMode,
  onLocationSelect,
}: LeafletMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletInstance = useRef<L.Map | null>(null);
  const currentTileLayer = useRef<L.TileLayer | null>(null);
  const currentLabelLayer = useRef<L.TileLayer | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const alarmsLayerRef = useRef<L.LayerGroup | null>(null);
  const hasAutoCentered = useRef<boolean>(false);
  const pinModeRef = useRef<boolean>(isPinMode);

  useEffect(() => {
    pinModeRef.current = isPinMode;
  }, [isPinMode]);

  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if (!mapRef.current || leafletInstance.current) return;

    const startLat = userLocation ? userLocation.lat : 12.9716;
    const startLng = userLocation ? userLocation.lng : 77.5946;

    const map = L.map(mapRef.current, { zoomControl: false }).setView([startLat, startLng], 14);
    leafletInstance.current = map;

    currentTileLayer.current = createTileLayer(mapStyle).addTo(map);
    currentLabelLayer.current = createLabelLayer(mapStyle)?.addTo(map) ?? null;

    // Layer group dedicated to all active red alarm markers
    alarmsLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (pinModeRef.current) {
        onLocationSelect(e.latlng.lat, e.latlng.lng);
      }
    });

    return () => {
      map.remove();
      leafletInstance.current = null;
    };
  }, []);

  // 1. Switch Tiles
  useEffect(() => {
    if (leafletInstance.current) {
      currentTileLayer.current?.remove();
      currentLabelLayer.current?.remove();
      currentTileLayer.current = createTileLayer(mapStyle).addTo(leafletInstance.current);
      currentLabelLayer.current = createLabelLayer(mapStyle)?.addTo(leafletInstance.current) ?? null;
    }
  }, [mapStyle]);

  // 2. User Live Location Marker
  useEffect(() => {
    if (!leafletInstance.current || !userLocation) return;
    if (!isValidCoordinate(userLocation.lat, userLocation.lng)) return;

    if (!userMarkerRef.current) {
      userMarkerRef.current = L.circleMarker([userLocation.lat, userLocation.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 1,
      }).addTo(leafletInstance.current);
    } else {
      userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
    }

    if (!hasAutoCentered.current) {
      leafletInstance.current.flyTo([userLocation.lat, userLocation.lng], 15, { duration: 1.5 });
      hasAutoCentered.current = true;
    }
  }, [userLocation]);

  // 3. Auto-Fly on Focus
  useEffect(() => {
    if (focusLocation && isValidCoordinate(focusLocation.lat, focusLocation.lng) && leafletInstance.current) {
      leafletInstance.current.flyTo([focusLocation.lat, focusLocation.lng], 15, { duration: 1.5 });
    }
  }, [focusLocation]);

  // 4. Custom Pin Preview (cyan while creating)
  useEffect(() => {
    if (!leafletInstance.current) return;

    if (customPin && isValidCoordinate(customPin.lat, customPin.lng)) {
      const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_RADIUS_METERS;
      if (!targetMarkerRef.current) {
        targetMarkerRef.current = L.marker([customPin.lat, customPin.lng]).addTo(leafletInstance.current);
        circleRef.current = L.circle([customPin.lat, customPin.lng], {
          radius: safeRadius,
          color: accentColor,
          weight: 2,
          fillColor: accentColor,
          fillOpacity: 0.22,
        }).addTo(leafletInstance.current);
      } else {
        targetMarkerRef.current.setLatLng([customPin.lat, customPin.lng]);
        circleRef.current?.setLatLng([customPin.lat, customPin.lng]);
        circleRef.current?.setRadius(safeRadius);
        circleRef.current?.setStyle({ color: accentColor, fillColor: accentColor });
      }
    } else {
      if (targetMarkerRef.current) {
        targetMarkerRef.current.remove();
        targetMarkerRef.current = null;
      }
      if (circleRef.current) {
        circleRef.current.remove();
        circleRef.current = null;
      }
    }
  }, [customPin, radius, accentColor]);

  // 5. 🔥 Render ACTIVE alarms as glowing red pins + red geofence circles
  useEffect(() => {
    if (!alarmsLayerRef.current) return;

    alarmsLayerRef.current.clearLayers();

    alarms.forEach((alarm) => {
      const lat = Number(alarm.latitude);
      const lng = Number(alarm.longitude);
      const rad = Number(alarm.radiusMeters) || DEFAULT_RADIUS_METERS;

      if (isValidCoordinate(lat, lng) && alarm.status === 'ACTIVE') {
        const marker = L.marker([lat, lng], {
          icon: createRedAlarmIcon(alarm.title),
        }).bindPopup(
          `<div style="font-family:sans-serif; padding:4px;">
             <b style="color:#ef4444; font-size:14px;">🚨 ${escapeHtml(String(alarm.title))}</b>
             <div style="color:#64748b; font-size:12px; margin-top:2px;">Radius: ${rad}m</div>
           </div>`,
        );

        const circle = L.circle([lat, lng], {
          radius: rad,
          color: '#ef4444',
          weight: 2,
          fillColor: '#ef4444',
          fillOpacity: 0.2,
        });

        alarmsLayerRef.current?.addLayer(marker);
        alarmsLayerRef.current?.addLayer(circle);
      }
    });
  }, [alarms]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <div
        ref={mapRef}
        style={{
          width: '100vw',
          height: '100vh',
          cursor: isPinMode ? 'crosshair' : 'grab',
        }}
      />
    </View>
  );
}

/**
 * The map owns a live Leaflet instance driven by imperative effects, so it gains
 * nothing from re-rendering. `App.tsx` updates the map far less often than it
 * updates toasts, modals and search text, and every prop is either memoised
 * upstream or a primitive, so this skips those unrelated render passes.
 */
export default memo(LeafletMapInner);