import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import L from 'leaflet';

// Fix standard Leaflet default icon path
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// 📍 Glowing Red Alarm Pin (Vector HTML DivIcon - 100% Reliable & Sharp)
const createRedAlarmIcon = (title: string) => {
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

  // 4. Recenter Button
  useEffect(() => {
    if (recenterTrigger > 0 && leafletInstance.current && userLocation) {
      leafletInstance.current.flyTo([userLocation.lat, userLocation.lng], 16, { duration: 1.2 });
    }
  }, [recenterTrigger]);

  // 5. Custom Pin Preview (Cyan during creation)
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

  // 6. 🔥 Render ALL Active Alarms as Glowing Red Pins & Red Geofence Circles
  useEffect(() => {
    if (!alarmsLayerRef.current) return;

    // Clear previous markers
    alarmsLayerRef.current.clearLayers();

    alarms.forEach((alarm) => {
      const lat = Number(alarm.latitude);
      const lng = Number(alarm.longitude);
      const rad = Number(alarm.radiusMeters) || 500;

      if (!isNaN(lat) && !isNaN(lng) && alarm.status === 'ACTIVE') {
        const marker = L.marker([lat, lng], {
          icon: createRedAlarmIcon(alarm.title),
        }).bindPopup(`
          <div style="font-family:sans-serif; padding:4px;">
            <b style="color:#ef4444; font-size:14px;">🚨 ${alarm.title}</b>
            <div style="color:#64748b; font-size:12px; margin-top:2px;">Radius: ${rad}m</div>
          </div>
        `);

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