import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { io } from 'socket.io-client';
import LeafletMap from './components/LeafletMap';

const API = 'http://localhost:5000/api';
let socket: any;

const THEMES = [
  { id: 'cyan', name: 'Cyber Cyan', primary: '#020617', card: '#0f172a', border: '#1e293b', accent: '#06b6d4', text: '#ffffff' },
  { id: 'emerald', name: 'Emerald Matrix', primary: '#021209', card: '#062817', border: '#0b4528', accent: '#10b981', text: '#ffffff' },
  { id: 'purple', name: 'Neon Synthwave', primary: '#090414', card: '#180a30', border: '#2f145e', accent: '#c084fc', text: '#ffffff' },
  { id: 'amber', name: 'Amber Sunset', primary: '#140c04', card: '#291807', border: '#4d2d0b', accent: '#f59e0b', text: '#ffffff' },
  { id: 'crimson', name: 'Crimson Rogue', primary: '#140507', card: '#2b0a10', border: '#541420', accent: '#f43f5e', text: '#ffffff' },
];

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [alarms, setAlarms] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isLayersModalOpen, setIsLayersModalOpen] = useState(false);
  const [isFavModalOpen, setIsFavModalOpen] = useState(false);

  const [selectedTheme, setSelectedTheme] = useState(THEMES[0]);
  const [mapTheme, setMapTheme] = useState<'dark' | 'light' | 'satellite'>('dark');

  // AI State
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Favorite form state
  const [favLabel, setFavLabel] = useState('Home');
  const [favRadius, setFavRadius] = useState('500');

  // Routing
  const [travelMode, setTravelMode] = useState<'driving' | 'cycling' | 'walking' | 'off'>('off');
  const [routePoints, setRoutePoints] = useState<[number, number][] | null>(null);
  const [routeStats, setRouteStats] = useState<{ distKm: string; durationMin: number } | null>(null);

  // GPS & Map States
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [recenterCount, setRecenterCount] = useState(0);
  const [focusLocation, setFocusLocation] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const [isPinMode, setIsPinMode] = useState(false);
  const [customPin, setCustomPin] = useState<{ lat: number; lng: number } | null>(null);

  // Search & Form States
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [auth, setAuth] = useState({ email: 'daiwick@test.com', password: 'password123' });
  const [form, setForm] = useState({ title: '', radius: '500' });
  const debounceTimer = useRef<any>(null);

  const showSuccessNotification = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  useEffect(() => {
    if (!userId) return;
    socket = io('http://localhost:5000');
    socket.on('alarm:trigger', (d: any) => {
      setAlertMsg(`🚨 WAKE UP! Reached "${d.title}" (${d.distance}m away)`);
      fetchAlarms(token!);
    });

    if ('geolocation' in navigator) {
      const id = navigator.geolocation.watchPosition(
        (p) => {
          const { latitude: lat, longitude: lng } = p.coords;
          setUserLocation({ lat, lng });
          socket.emit('location:update', { userId, latitude: lat, longitude: lng });
        },
        () => {},
        { enableHighAccuracy: true }
      );
      return () => { navigator.geolocation.clearWatch(id); socket.disconnect(); };
    }
  }, [userId]);

  // Route Fetcher
  useEffect(() => {
    if (travelMode === 'off' || !userLocation || !customPin) {
      setRoutePoints(null);
      setRouteStats(null);
      return;
    }

    const fetchRoute = async () => {
      try {
        const profile = travelMode === 'cycling' ? 'cycling' : travelMode === 'walking' ? 'walking' : 'driving';
        const url = `https://router.project-osrm.org/route/v1/${profile}/${userLocation.lng},${userLocation.lat};${customPin.lng},${customPin.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url).then((r) => r.json());

        if (res.routes && res.routes[0]) {
          const coords = res.routes[0].geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]);
          setRoutePoints(coords);
          setRouteStats({
            distKm: (res.routes[0].distance / 1000).toFixed(1),
            durationMin: Math.round(res.routes[0].duration / 60),
          });
        }
      } catch (err) {
        console.error('Routing error:', err);
      }
    };

    fetchRoute();
  }, [travelMode, userLocation, customPin]);

  // AI Handler
  const handleAiSubmit = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);
    setAiError(null);

    try {
      const res = await fetch(`${API}/ai/parse-alarm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          prompt: aiPrompt,
          userLat: userLocation?.lat || 12.9716,
          userLng: userLocation?.lng || 77.5946,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI could not resolve place.');

      await fetch(`${API}/alarms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: data.title,
          destinationName: data.title,
          latitude: data.latitude,
          longitude: data.longitude,
          radiusMeters: data.radiusMeters,
        }),
      });

      fetchAlarms(token!);
      setFocusLocation({ lat: data.latitude, lng: data.longitude, key: Date.now() });
      showSuccessNotification(`✅ AI Activated Alarm: "${data.title}" (${data.radiusMeters}m)`);
      setIsAiModalOpen(false);
      setAiPrompt('');
      setCustomPin(null);
      setIsPinMode(false);
    } catch (err: any) {
      setAiError(err.message);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleSearch = (text: string) => {
    setSearch(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (text.length < 2) return setSuggestions([]);
    debounceTimer.current = setTimeout(async () => {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=5`).then((r) => r.json());
      setSuggestions(res.features || []);
    }, 300);
  };

  const selectPlace = (f: any) => {
    const [lng, lat] = f.geometry.coordinates;
    const name = f.properties.name || f.properties.street || 'Target';
    const targetLat = parseFloat(lat.toFixed(4));
    const targetLng = parseFloat(lng.toFixed(4));

    setCustomPin({ lat: targetLat, lng: targetLng });
    setForm({ ...form, title: name });
    setSearch(name);
    setSuggestions([]);
    setFocusLocation({ lat: targetLat, lng: targetLng, key: Date.now() });
    setIsPinMode(true);
  };

  const handleLogin = async () => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(auth),
    }).then((r) => r.json());
    if (res.token) {
      setToken(res.token);
      setUserId(res.user.id);
      fetchAlarms(res.token);
      fetchFavorites(res.token);
    }
  };

  const fetchAlarms = async (tok: string) => {
    const res = await fetch(`${API}/alarms`, { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.json());
    setAlarms(res.alarms || []);
  };

  const fetchFavorites = async (tok: string) => {
    const res = await fetch(`${API}/favorites`, { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.json());
    setFavorites(res.favorites || []);
  };

  const handleSaveFavorite = async () => {
    if (!customPin) return;
    await fetch(`${API}/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        label: favLabel,
        addressName: form.title || favLabel,
        latitude: customPin.lat,
        longitude: customPin.lng,
        radiusMeters: parseFloat(favRadius) || 500,
      }),
    });
    fetchFavorites(token!);
    setIsFavModalOpen(false);
    showSuccessNotification(`⭐ Saved "${favLabel}" to Favorites!`);
  };

  // 1-Click Activate from Favorite Chip
  const handleActivateFavorite = async (fav: any) => {
    await fetch(`${API}/alarms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: fav.label,
        destinationName: fav.addressName,
        latitude: fav.latitude,
        longitude: fav.longitude,
        radiusMeters: fav.radiusMeters,
      }),
    });
    fetchAlarms(token!);
    setFocusLocation({ lat: fav.latitude, lng: fav.longitude, key: Date.now() });
    showSuccessNotification(`🔔 Activated Alarm for Favorite: "${fav.label}" (${fav.radiusMeters}m)`);
  };

  const handleSaveAlarm = async () => {
    if (!customPin) return;

    const savedLat = customPin.lat;
    const savedLng = customPin.lng;
    const alarmTitle = form.title || 'Transit Stop';
    const alarmRadius = parseFloat(form.radius) || 500;

    await fetch(`${API}/alarms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: alarmTitle,
        destinationName: alarmTitle,
        latitude: savedLat,
        longitude: savedLng,
        radiusMeters: alarmRadius,
      }),
    });

    fetchAlarms(token!);
    setFocusLocation({ lat: savedLat, lng: savedLng, key: Date.now() });
    showSuccessNotification(`✅ Alarm Activated: "${alarmTitle}" (Radius: ${alarmRadius}m)`);
    setCustomPin(null);
    setIsPinMode(false);
    setTravelMode('off');
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API}/alarms/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    fetchAlarms(token!);
  };

  if (!token) {
    return (
      <View style={[s.c, { backgroundColor: selectedTheme.primary, justifyContent: 'center', alignItems: 'center' }]}>
        <View style={[s.card, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}>
          <Text style={[s.h1, { color: selectedTheme.accent }]}>🛰️ SMART GPS ALARM</Text>
          <TextInput style={s.inp} value={auth.email} onChangeText={(t) => setAuth({ ...auth, email: t })} placeholder="Email" placeholderTextColor="#64748b" />
          <TextInput style={s.inp} value={auth.password} onChangeText={(t) => setAuth({ ...auth, password: t })} secureTextEntry placeholder="Password" placeholderTextColor="#64748b" />
          <TouchableOpacity style={[s.btn, { backgroundColor: selectedTheme.accent }]} onPress={handleLogin}>
            <Text style={s.btnTxt}>Enter Dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.c, { backgroundColor: selectedTheme.primary }]}>
      <LeafletMap
        customPin={customPin}
        radius={parseFloat(form.radius) || 500}
        userLocation={userLocation}
        alarms={alarms}
        mapStyle={mapTheme}
        accentColor={selectedTheme.accent}
        routePoints={routePoints}
        focusLocation={focusLocation}
        isPinMode={isPinMode}
        recenterTrigger={recenterCount}
        onLocationSelect={(lat, lng) => setCustomPin({ lat: parseFloat(lat.toFixed(4)), lng: parseFloat(lng.toFixed(4)) })}
      />

      {/* Top Bar with Search & Theme */}
      <View style={s.top}>
        <View style={[s.badge, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}>
          <Text style={{ color: selectedTheme.text, fontWeight: 'bold', fontSize: 12 }}>SMART GPS ALARM 🟢</Text>
        </View>

        <View style={{ flex: 1, maxWidth: 280, position: 'relative' }}>
          <TextInput
            style={{
              backgroundColor: selectedTheme.card,
              borderColor: selectedTheme.border,
              borderWidth: 1.5,
              color: selectedTheme.text,
              padding: 10,
              paddingHorizontal: 14,
              borderRadius: 8,
              fontSize: 13,
            }}
            value={search}
            onChangeText={handleSearch}
            placeholder="🔍 Search destination..."
            placeholderTextColor="#94a3b8"
          />
          {suggestions.length > 0 && (
            <View style={[s.drop, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}>
              {suggestions.map((item, i) => (
                <TouchableOpacity key={i} style={[s.dropItem, { borderBottomColor: selectedTheme.border }]} onPress={() => selectPlace(item)}>
                  <Text style={{ color: selectedTheme.text, fontSize: 12 }}>{item.properties.name || 'Location'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* ✨ AI Button */}
        <TouchableOpacity style={[s.aiBtn, { backgroundColor: selectedTheme.accent }]} onPress={() => setIsAiModalOpen(true)}>
          <Text style={{ color: '#020617', fontWeight: 'bold', fontSize: 12 }}>✨ AI Prompt</Text>
        </TouchableOpacity>

        {/* 🥞 Layer Stack Icon */}
        <TouchableOpacity
          style={[s.layersBtn, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.accent }]}
          onPress={() => setIsLayersModalOpen(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={selectedTheme.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        </TouchableOpacity>

        <TouchableOpacity style={[s.badge, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]} onPress={() => setIsModalOpen(true)}>
          <Text style={{ color: selectedTheme.accent, fontWeight: 'bold' }}>🔔 Alarms ({alarms.length})</Text>
        </TouchableOpacity>
      </View>

      {/* ⭐ QUICK FAVORITE CHIPS BAR */}
      <View style={s.favBar}>
        <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', marginRight: 4 }}>⭐ Favorites:</Text>
        {favorites.map((fav) => (
          <TouchableOpacity
            key={fav.id}
            style={[s.favChip, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}
            onPress={() => handleActivateFavorite(fav)}
          >
            <Text style={{ color: selectedTheme.accent, fontSize: 11, fontWeight: 'bold' }}>
              📍 {fav.label}
            </Text>
          </TouchableOpacity>
        ))}
        {customPin && (
          <TouchableOpacity
            style={[s.favChip, { backgroundColor: selectedTheme.accent, borderColor: selectedTheme.accent }]}
            onPress={() => setIsFavModalOpen(true)}
          >
            <Text style={{ color: '#020617', fontSize: 11, fontWeight: 'bold' }}>+ Save Pin as Fav</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Success Popup */}
      {successMsg && (
        <View style={s.successBanner}>
          <Text style={s.successText}>{successMsg}</Text>
        </View>
      )}

      {/* Red Alert Banner */}
      {alertMsg && (
        <View style={s.alert}><Text style={{ color: '#fff', fontWeight: 'bold', flex: 1 }}>{alertMsg}</Text><TouchableOpacity onPress={() => setAlertMsg(null)}><Text style={{ color: '#fff' }}>✕</Text></TouchableOpacity></View>
      )}

      {/* Directions ETA Banner */}
      {routeStats && (
        <View style={[s.routeEtaBanner, { borderColor: selectedTheme.accent }]}>
          <Text style={{ color: selectedTheme.accent, fontWeight: 'bold', fontSize: 13 }}>
            🛣️ {routeStats.distKm} km • ⏱️ {routeStats.durationMin} mins ({travelMode.toUpperCase()})
          </Text>
        </View>
      )}

      {/* Bottom Telemetry HUD */}
      <View style={[s.hudCard, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}>
        <View style={s.hudIconCircle}><Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>N</Text></View>
        <View style={s.hudItem}>
          <Text style={s.hudTitle}>📡 GPS Telemetry</Text>
          <Text style={s.hudSubtitle}>{userLocation ? 'High Accuracy Active' : 'Acquiring Signal...'}</Text>
        </View>
        <View style={s.hudDivider} />
        <View style={s.hudItem}>
          <Text style={s.hudTitle}>🛡️ {alarms.length} Monitored Zones</Text>
          <Text style={s.hudSubtitle}>Geofence Guard</Text>
        </View>
        <View style={s.hudDivider} />
        <View style={s.hudItem}>
          <Text style={s.hudTitle}>📶 WebSocket Stream</Text>
          <Text style={s.hudLive}>Live Syncing</Text>
        </View>
      </View>

      {/* Recenter Button */}
      {userLocation && (
        <TouchableOpacity style={s.recenter} onPress={() => setRecenterCount((c) => c + 1)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={selectedTheme.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="22" y1="12" x2="18" y2="12" /><line x1="6" y1="12" x2="2" y2="12" /><line x1="12" y1="6" x2="12" y2="2" /><line x1="12" y1="22" x2="12" y2="18" />
          </svg>
        </TouchableOpacity>
      )}

      {/* Drop Pin Button */}
      <TouchableOpacity style={[s.fab, { backgroundColor: selectedTheme.accent }, isPinMode && { backgroundColor: '#ef4444' }]} onPress={() => { setIsPinMode(!isPinMode); if (isPinMode) { setCustomPin(null); setTravelMode('off'); } }}>
        <Text style={{ color: '#020617', fontWeight: 'bold' }}>{isPinMode ? '✕ Cancel' : '+ Drop Custom Pin'}</Text>
      </TouchableOpacity>

      {/* Slide-Up Pin Config & Direction Modes Card */}
      {customPin && (
        <View style={[s.configCard, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}>
          <Text style={{ color: '#fff', fontWeight: 'bold', marginBottom: 6 }}>📍 Setup Geofence Guard</Text>

          <Text style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>🧭 Directions Mode:</Text>
          <View style={s.directionRow}>
            <TouchableOpacity style={[s.dirBtn, travelMode === 'driving' && { backgroundColor: selectedTheme.accent }]} onPress={() => setTravelMode('driving')}><Text style={{ fontSize: 12 }}>🚗 Car</Text></TouchableOpacity>
            <TouchableOpacity style={[s.dirBtn, travelMode === 'cycling' && { backgroundColor: selectedTheme.accent }]} onPress={() => setTravelMode('cycling')}><Text style={{ fontSize: 12 }}>🏍️ Bike</Text></TouchableOpacity>
            <TouchableOpacity style={[s.dirBtn, travelMode === 'walking' && { backgroundColor: selectedTheme.accent }]} onPress={() => setTravelMode('walking')}><Text style={{ fontSize: 12 }}>🚶 Walk</Text></TouchableOpacity>
            <TouchableOpacity style={[s.dirBtn, travelMode === 'off' && { backgroundColor: selectedTheme.accent }]} onPress={() => setTravelMode('off')}><Text style={{ fontSize: 12 }}>✕ Off</Text></TouchableOpacity>
          </View>

          <TextInput style={s.inp} value={form.title} onChangeText={(t) => setForm({ ...form, title: t })} placeholder="Alarm Name" placeholderTextColor="#64748b" />
          <TextInput style={s.inp} value={form.radius} onChangeText={(t) => setForm({ ...form, radius: t })} placeholder="Radius (Meters)" placeholderTextColor="#64748b" />
          <TouchableOpacity style={[s.btn, { backgroundColor: selectedTheme.accent }]} onPress={handleSaveAlarm}>
            <Text style={s.btnTxt}>Activate Alarm Guard 🔔</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ⭐ Save Favorite Modal */}
      <Modal visible={isFavModalOpen} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.card, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.accent }]}>
            <Text style={{ color: selectedTheme.accent, fontWeight: 'bold', fontSize: 16, textAlign: 'center', marginBottom: 12 }}>
              ⭐ Save Place to Favorites
            </Text>
            <TextInput style={s.inp} value={favLabel} onChangeText={setFavLabel} placeholder="Label (e.g. Home, College, Gym)" placeholderTextColor="#64748b" />
            <TextInput style={s.inp} value={favRadius} onChangeText={setFavRadius} placeholder="Radius (Meters)" placeholderTextColor="#64748b" />
            <TouchableOpacity style={[s.btn, { backgroundColor: selectedTheme.accent, marginTop: 8 }]} onPress={handleSaveFavorite}>
              <Text style={s.btnTxt}>Save to Favorites</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsFavModalOpen(false)}>
              <Text style={{ color: '#64748b', textAlign: 'center', marginTop: 12 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🥞 Theme Customizer Modal */}
      <Modal visible={isLayersModalOpen} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={[s.themeModalCard, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.accent }]}>
            <Text style={[s.themeModalTitle, { color: selectedTheme.accent }]}>🥞 Theme & Layers Customizer</Text>
            <Text style={s.themeSectionHeader}>🎨 UI Color Palettes (Primary & Secondary):</Text>
            <View style={{ gap: 8, marginBottom: 16 }}>
              {THEMES.map((theme) => (
                <TouchableOpacity
                  key={theme.id}
                  style={[s.paletteRow, selectedTheme.id === theme.id && { borderColor: theme.accent, backgroundColor: 'rgba(255,255,255,0.05)' }]}
                  onPress={() => setSelectedTheme(theme)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={[s.colorCircle, { backgroundColor: theme.primary, borderColor: theme.accent, borderWidth: 2 }]} />
                    <View style={[s.colorCircle, { backgroundColor: theme.accent }]} />
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>{theme.name}</Text>
                  </View>
                  {selectedTheme.id === theme.id && <Text style={{ color: theme.accent, fontWeight: 'bold' }}>✓ Active</Text>}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.themeSectionHeader}>🗺️ Map Base View:</Text>
            <View style={s.mapLayerRow}>
              <TouchableOpacity style={[s.mapLayerBtn, mapTheme === 'dark' && { backgroundColor: selectedTheme.accent }]} onPress={() => setMapTheme('dark')}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: mapTheme === 'dark' ? '#020617' : '#fff' }}>🌙 Dark</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.mapLayerBtn, mapTheme === 'light' && { backgroundColor: selectedTheme.accent }]} onPress={() => setMapTheme('light')}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: mapTheme === 'light' ? '#020617' : '#fff' }}>☀️ Light</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.mapLayerBtn, mapTheme === 'satellite' && { backgroundColor: selectedTheme.accent }]} onPress={() => setMapTheme('satellite')}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: mapTheme === 'satellite' ? '#020617' : '#fff' }}>🛰️ Satellite</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[s.btn, { backgroundColor: selectedTheme.accent, marginTop: 16 }]} onPress={() => setIsLayersModalOpen(false)}>
              <Text style={s.btnTxt}>Apply Theme</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* AI Modal */}
      <Modal visible={isAiModalOpen} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.aiCard, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.accent }]}>
            <Text style={[s.aiModalTitle, { color: selectedTheme.accent }]}>✨ AI Natural Language Assistant</Text>
            <Text style={s.aiModalSub}>Type naturally (e.g. "Wake me up at Home" or "Alert me 1km before Airport").</Text>
            {aiError && <Text style={{ color: '#ef4444', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{aiError}</Text>}
            <TextInput
              style={[s.inp, { minHeight: 70 }]}
              value={aiPrompt}
              onChangeText={setAiPrompt}
              placeholder="e.g. Wake me up when I reach Home"
              placeholderTextColor="#64748b"
              multiline
            />
            <TouchableOpacity style={[s.aiSubmitBtn, { backgroundColor: selectedTheme.accent }]} onPress={handleAiSubmit} disabled={isAiLoading}>
              {isAiLoading ? <ActivityIndicator color="#020617" /> : <Text style={s.btnTxt}>⚡ Activate Smart Alarm with AI</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsAiModalOpen(false)}>
              <Text style={{ color: '#64748b', textAlign: 'center', marginTop: 12 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Alarms Modal */}
      <Modal visible={isModalOpen} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.card, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}>
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16, marginBottom: 10 }}>Active Alarms ({alarms.length})</Text>
            <ScrollView style={{ maxHeight: 200 }}>
              {alarms.map((a) => (
                <View key={a.id} style={s.alarmRow}>
                  <Text style={{ color: '#fff', flex: 1, fontSize: 12 }}>{a.title} ({a.radiusMeters}m)</Text>
                  <TouchableOpacity onPress={() => handleDelete(a.id)}><Text style={{ color: '#f87171', fontWeight: 'bold' }}>🗑️</Text></TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setIsModalOpen(false)}><Text style={{ color: '#64748b', textAlign: 'center', marginTop: 10 }}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1 },
  top: { position: 'absolute', top: 15, left: 15, right: 15, flexDirection: 'row', alignItems: 'center', zIndex: 1000, gap: 8 },
  favBar: { position: 'absolute', top: 68, left: 15, flexDirection: 'row', alignItems: 'center', zIndex: 1000, gap: 6 },
  favChip: { padding: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1 },
  badge: { padding: 10, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1 },
  drop: { position: 'absolute', top: 44, left: 0, right: 0, borderRadius: 8, borderWidth: 1, zIndex: 2000, overflow: 'hidden' },
  dropItem: { padding: 10, borderBottomWidth: 1 },
  aiBtn: { padding: 10, paddingHorizontal: 14, borderRadius: 8, justifyContent: 'center' },
  layersBtn: { width: 42, height: 42, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5 },
  successBanner: { position: 'absolute', top: 100, alignSelf: 'center', backgroundColor: '#065f46', padding: 12, paddingHorizontal: 20, borderRadius: 25, borderWidth: 1, borderColor: '#10b981', zIndex: 2500 },
  successText: { color: '#ecfdf5', fontWeight: 'bold', fontSize: 13 },
  routeEtaBanner: { position: 'absolute', top: 100, alignSelf: 'center', backgroundColor: 'rgba(15, 23, 42, 0.95)', padding: 10, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1, zIndex: 1000 },
  directionRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  dirBtn: { flex: 1, backgroundColor: '#020617', padding: 6, borderRadius: 6, alignItems: 'center', borderWidth: 1, borderColor: '#1e293b' },
  hudCard: { position: 'absolute', bottom: 18, left: 18, flexDirection: 'row', alignItems: 'center', padding: 12, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1, zIndex: 1000, gap: 16 },
  hudIconCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#020617', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  hudItem: { justifyContent: 'center' },
  hudTitle: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
  hudSubtitle: { color: '#64748b', fontSize: 10, marginTop: 2 },
  hudLive: { color: '#10b981', fontSize: 10, fontWeight: 'bold', marginTop: 2 },
  hudDivider: { width: 1, height: 24, backgroundColor: '#334155' },
  recenter: { position: 'absolute', bottom: 70, right: 18, backgroundColor: 'rgba(15,23,42,0.9)', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', zIndex: 1000, borderWidth: 1, borderColor: '#334155' },
  fab: { position: 'absolute', bottom: 18, right: 18, padding: 14, paddingHorizontal: 20, borderRadius: 30, zIndex: 1000 },
  alert: { position: 'absolute', top: 100, alignSelf: 'center', backgroundColor: '#dc2626', padding: 12, borderRadius: 8, flexDirection: 'row', alignItems: 'center', zIndex: 2000, width: 320 },
  configCard: { position: 'absolute', bottom: 75, right: 18, width: 300, padding: 16, borderRadius: 12, borderWidth: 1, zIndex: 1100 },
  card: { padding: 20, borderRadius: 14, width: 320, borderWidth: 1 },
  themeModalCard: { padding: 22, borderRadius: 16, width: 360, borderWidth: 1.5 },
  themeModalTitle: { fontWeight: 'bold', fontSize: 17, textAlign: 'center', marginBottom: 16 },
  themeSectionHeader: { color: '#94a3b8', fontSize: 12, fontWeight: 'bold', marginBottom: 8 },
  paletteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b' },
  colorCircle: { width: 18, height: 18, borderRadius: 9 },
  mapLayerRow: { flexDirection: 'row', gap: 8 },
  mapLayerBtn: { flex: 1, backgroundColor: '#020617', padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#1e293b' },
  aiCard: { padding: 22, borderRadius: 16, width: 340, borderWidth: 1.5 },
  aiModalTitle: { fontWeight: 'bold', fontSize: 16, textAlign: 'center', marginBottom: 4 },
  aiModalSub: { color: '#94a3b8', fontSize: 11, textAlign: 'center', marginBottom: 14 },
  aiSubmitBtn: { padding: 12, borderRadius: 8, alignItems: 'center' },
  inp: { backgroundColor: '#020617', color: '#fff', padding: 10, borderRadius: 6, marginBottom: 8, borderWidth: 1, borderColor: '#1e293b', fontSize: 12 },
  btn: { padding: 10, borderRadius: 6, alignItems: 'center' },
  btnTxt: { color: '#020617', fontWeight: 'bold', fontSize: 12 },
  h1: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
  alarmRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#020617', padding: 8, borderRadius: 6, marginTop: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
}); 