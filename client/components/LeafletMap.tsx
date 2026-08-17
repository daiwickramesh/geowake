import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import L from 'leaflet';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const TILE_LAYERS = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};

interface LeafletMapProps {
  customPin: { lat: number; lng: number } | null;
  radius: number;
  userLocation: { lat: number; lng: number } | null;
  alarms: any[];
  mapStyle: 'dark' | 'light' | 'satellite';
  accentColor: string;
  routePoints: [number, number][] | null;
  focusLocation: { lat: number; lng: number; key: number } | null;
  isPinMode: boolean;
  recenterTrigger: number;
  onLocationSelect: (lat: number, lng: number) => void;
}

export default function LeafletMap({
  customPin,
  radius,
  userLocation,
  alarms,
  mapStyle,
  accentColor,
  routePoints,
  focusLocation,
  isPinMode,
  recenterTrigger,
  onLocationSelect,
}: LeafletMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletInstance = useRef<L.Map | null>(null);
  const currentTileLayer = useRef<L.TileLayer | null>(null);
  const targetMarkerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const alarmsLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
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

    currentTileLayer.current = L.tileLayer(TILE_LAYERS[mapStyle], { maxZoom: 19 }).addTo(map);
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

  // 1. Tile Switcher
  useEffect(() => {
    if (leafletInstance.current && currentTileLayer.current) {
      currentTileLayer.current.remove();
      currentTileLayer.current = L.tileLayer(TILE_LAYERS[mapStyle], { maxZoom: 19 }).addTo(leafletInstance.current);
    }
  }, [mapStyle]);

  // 2. User Live Location Marker
  useEffect(() => {
    if (!leafletInstance.current || !userLocation) return;

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
    if (focusLocation && leafletInstance.current) {
      leafletInstance.current.flyTo([focusLocation.lat, focusLocation.lng], 15, { duration: 1.5 });
    }
  }, [focusLocation]);

  // 4. Recenter
  useEffect(() => {
    if (recenterTrigger > 0 && leafletInstance.current && userLocation) {
      leafletInstance.current.flyTo([userLocation.lat, userLocation.lng], 16, { duration: 1.2 });
    }
  }, [recenterTrigger]);

  // 5. Custom Pin Preview with Dynamic Theme Accent Color
  useEffect(() => {
    if (!leafletInstance.current) return;

    if (customPin) {
      if (!targetMarkerRef.current) {
        targetMarkerRef.current = L.marker([customPin.lat, customPin.lng]).addTo(leafletInstance.current);
        circleRef.current = L.circle([customPin.lat, customPin.lng], {
          radius: radius,
          color: accentColor,
          weight: 2,
          fillColor: accentColor,
          fillOpacity: 0.22,
        }).addTo(leafletInstance.current);
      } else {
        targetMarkerRef.current.setLatLng([customPin.lat, customPin.lng]);
        circleRef.current?.setLatLng([customPin.lat, customPin.lng]);
        circleRef.current?.setRadius(radius);
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

  // 6. Red Active Alarms Layer
  useEffect(() => {
    if (!alarmsLayerRef.current) return;
    alarmsLayerRef.current.clearLayers();

    alarms.forEach((alarm) => {
      if (alarm.status === 'ACTIVE') {
        const marker = L.marker([alarm.latitude, alarm.longitude], { icon: redIcon }).bindPopup(
          `<b style="color:#000;">${alarm.title}</b><br/><span style="color:#666;">Radius: ${alarm.radiusMeters}m</span>`
        );
        const circle = L.circle([alarm.latitude, alarm.longitude], {
          radius: alarm.radiusMeters,
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

  // 7. Route Polyline
  useEffect(() => {
    if (!leafletInstance.current) return;

    if (routePoints && routePoints.length > 0) {
      if (!routeLayerRef.current) {
        routeLayerRef.current = L.polyline(routePoints, {
          color: accentColor,
          weight: 5,
          opacity: 0.9,
          lineJoin: 'round',
        }).addTo(leafletInstance.current);
      } else {
        routeLayerRef.current.setLatLngs(routePoints);
        routeLayerRef.current.setStyle({ color: accentColor });
      }
    } else {
      if (routeLayerRef.current) {
        routeLayerRef.current.remove();
        routeLayerRef.current = null;
      }
    }
  }, [routePoints, accentColor]);

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