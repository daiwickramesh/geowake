import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { io } from 'socket.io-client';
import LeafletMap from './components/LeafletMap';

const GOOGLE_CLIENT_ID = '352537067303-ac52hmbcmhburhdto99vhkn5tffqunnr.apps.googleusercontent.com';

const IS_LOCAL = typeof window !== 'undefined' && window.location.hostname === 'localhost';
const API = IS_LOCAL ? 'http://localhost:5000/api' : 'https://geowake.onrender.com/api';
const SOCKET_URL = IS_LOCAL ? 'http://localhost:5000' : 'https://geowake.onrender.com';

let socket: any;
let audioCtx: AudioContext | null = null;
let alarmInterval: any = null;

const THEMES = [
  { id: 'cyan', name: 'Cyber Cyan', primary: '#030712', card: 'rgba(15, 23, 42, 0.75)', border: 'rgba(6, 182, 212, 0.25)', accent: '#06b6d4', glow: 'rgba(6, 182, 212, 0.4)', text: '#ffffff' },
  { id: 'emerald', name: 'Matrix Emerald', primary: '#021209', card: 'rgba(6, 40, 23, 0.75)', border: 'rgba(16, 185, 129, 0.25)', accent: '#10b981', glow: 'rgba(16, 185, 129, 0.4)', text: '#ffffff' },
  { id: 'purple', name: 'Neon Synthwave', primary: '#090414', card: 'rgba(24, 10, 48, 0.75)', border: 'rgba(192, 132, 252, 0.25)', accent: '#c084fc', glow: 'rgba(192, 132, 252, 0.4)', text: '#ffffff' },
  { id: 'amber', name: 'Amber Sunset', primary: '#140c04', card: '#291807', border: '#4d2d0b', accent: '#f59e0b', text: '#ffffff' },
  { id: 'crimson', name: 'Crimson Rogue', primary: '#140507', card: '#2b0a10', border: '#541420', accent: '#f43f5e', text: '#ffffff' },
];

function getDistanceFormatted(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [alarms, setAlarms] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [ringingAlarm, setRingingAlarm] = useState<any | null>(null);

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isLayersModalOpen, setIsLayersModalOpen] = useState(false);

  const [selectedTheme, setSelectedTheme] = useState(THEMES[0]);
  const [mapTheme, setMapTheme] = useState<'dark' | 'light' | 'satellite'>('dark');

  // AI & Form
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [saveAsFav, setSaveAsFav] = useState(false);

  // GPS & Map States
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [recenterCount, setRecenterCount] = useState(0);
  const [focusLocation, setFocusLocation] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const [isPinMode, setIsPinMode] = useState(false);
  const [customPin, setCustomPin] = useState<{ lat: number; lng: number } | null>(null);

  // Search
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [form, setForm] = useState({ title: '', radius: '500' });
  const debounceTimer = useRef<any>(null);

  const showNotification = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const startAlarmSound = () => {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const playTone = () => {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      };

      playTone();
      alarmInterval = setInterval(playTone, 500);
    } catch (e) {
      console.warn('Audio error:', e);
    }
  };

  const stopAlarmSound = () => {
    if (alarmInterval) clearInterval(alarmInterval);
    alarmInterval = null;
    setRingingAlarm(null);
  };

  // Mount Official Google Button cleanly
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if ((window as any).google) {
        (window as any).google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredentialResponse,
        });

        // Render official button into container
        const btnContainer = document.getElementById('google-btn-slot');
        if (btnContainer) {
          (window as any).google.accounts.id.renderButton(btnContainer, {
            theme: 'filled_black',
            size: 'large',
            shape: 'pill',
            width: 280,
          });
        }
      }
    };
    document.body.appendChild(script);
  }, []);

  const handleGoogleCredentialResponse = async (response: any) => {
    try {
      const res = await fetch(`${API}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential }),
      }).then((r) => r.json());

      if (res.token) {
        setToken(res.token);
        setUserId(res.user.id);
        fetchAlarms(res.token);
        fetchFavorites(res.token);
        showNotification(`👋 Welcome, ${res.user.name}!`);
      }
    } catch (err) {
      console.error('Google Auth Failed:', err);
    }
  };

  useEffect(() => {
    if (!userId) return;
    socket = io(SOCKET_URL);

    socket.on('alarm:trigger', (d: any) => {
      setRingingAlarm(d);
      startAlarmSound();
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
      return () => { navigator.geolocation.clearWatch(id); socket.disconnect(); stopAlarmSound(); };
    }
  }, [userId]);

  const handleLogout = () => {
    if (socket) socket.disconnect();
    stopAlarmSound();
    setToken(null);
    setUserId(null);
    setAlarms([]);
    setFavorites([]);
    setCustomPin(null);
    setIsPinMode(false);
  };

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

      const alreadyActive = alarms.some(
        (a) => a.status === 'ACTIVE' && (a.title.toLowerCase() === data.title.toLowerCase() || (Math.abs(a.latitude - data.latitude) < 0.001 && Math.abs(a.longitude - data.longitude) < 0.001))
      );

      if (alreadyActive) {
        setFocusLocation({ lat: data.latitude, lng: data.longitude, key: Date.now() });
        showNotification(`⚠️ Alarm for "${data.title}" is already active!`);
        setIsAiModalOpen(false);
        setAiPrompt('');
        return;
      }

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
      showNotification(`✅ AI Activated: "${data.title}" (${data.radiusMeters}m)`);
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

  const fetchAlarms = async (tok: string) => {
    const res = await fetch(`${API}/alarms`, { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.json());
    setAlarms(res.alarms || []);
  };

  const fetchFavorites = async (tok: string) => {
    const res = await fetch(`${API}/favorites`, { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.json());
    setFavorites(res.favorites || []);
  };

  const handleActivateFavorite = async (fav: any) => {
    const isAlreadyActive = alarms.some(
      (a) => a.status === 'ACTIVE' && (a.title === fav.label || (Math.abs(a.latitude - fav.latitude) < 0.001 && Math.abs(a.longitude - fav.longitude) < 0.001))
    );

    if (isAlreadyActive) {
      setFocusLocation({ lat: fav.latitude, lng: fav.longitude, key: Date.now() });
      showNotification(`⚠️ Alarm for "${fav.label}" is already active!`);
      return;
    }

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
    showNotification(`🔔 Activated: "${fav.label}" (${fav.radiusMeters}m)`);
  };

  const handleSaveAlarm = async () => {
    if (!customPin) return;

    const savedLat = customPin.lat;
    const savedLng = customPin.lng;
    const alarmTitle = form.title || 'Transit Stop';
    const alarmRadius = parseFloat(form.radius) || 500;

    const isAlreadyActive = alarms.some(
      (a) => a.status === 'ACTIVE' && (Math.abs(a.latitude - savedLat) < 0.001 && Math.abs(a.longitude - savedLng) < 0.001)
    );

    if (isAlreadyActive) {
      setFocusLocation({ lat: savedLat, lng: savedLng, key: Date.now() });
      showNotification(`⚠️ An active alarm already exists at this spot!`);
      setCustomPin(null);
      setIsPinMode(false);
      return;
    }

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

    if (saveAsFav) {
      await fetch(`${API}/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          label: alarmTitle,
          addressName: alarmTitle,
          latitude: savedLat,
          longitude: savedLng,
          radiusMeters: alarmRadius,
        }),
      });
      fetchFavorites(token!);
    }

    fetchAlarms(token!);
    setFocusLocation({ lat: savedLat, lng: savedLng, key: Date.now() });
    showNotification(`✅ Alarm Activated: "${alarmTitle}" (${alarmRadius}m)`);
    setCustomPin(null);
    setIsPinMode(false);
    setSaveAsFav(false);
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API}/alarms/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    fetchAlarms(token!);
  };

  if (!token) {
    return (
      <View style={s.authBackground}>
        <div style={{ position: 'absolute', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(6,182,212,0.25) 0%, rgba(59,130,246,0.1) 50%, transparent 70%)', top: '-100px', left: '-100px', filter: 'blur(60px)', pointerEvents: 'none', animation: 'pulseGlow 6s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(168,85,247,0.2) 0%, rgba(236,72,153,0.1) 50%, transparent 70%)', bottom: '-100px', right: '-100px', filter: 'blur(60px)', pointerEvents: 'none', animation: 'pulseGlow 8s ease-in-out infinite' }} />

        <View style={s.authGlassCard}>
          <View style={s.authIconBadge}>
            <Text style={{ fontSize: 28 }}>📍</Text>
          </View>

          <h1 className="shiny-text" style={{ fontSize: '32px', fontWeight: 900, margin: '0 0 6px 0', letterSpacing: '-0.5px', textAlign: 'center' }}>
            GeoWake
          </h1>
          <Text style={s.authSub}>Smart Transit Geofencing & Wake Alarm</Text>

          {/* Official Google Button Slot */}
          <div id="google-btn-slot" style={{ minHeight: '44px', display: 'flex', justifyContent: 'center', width: '100%' }} />

          <View style={s.authDividerRow}>
            <View style={s.authDividerLine} />
            <Text style={s.authDividerText}>Instant Google OAuth 2.0</Text>
            <View style={s.authDividerLine} />
          </View>
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
        focusLocation={focusLocation}
        isPinMode={isPinMode}
        recenterTrigger={recenterCount}
        onLocationSelect={(lat, lng) => setCustomPin({ lat: parseFloat(lat.toFixed(4)), lng: parseFloat(lng.toFixed(4)) })}
      />

      {/* 🛸 FLOATING DYNAMIC ISLAND TOP DOCK */}
      <View style={s.topDockWrapper}>
        <View style={[s.topDock, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}>
          <View style={s.brandSection}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: selectedTheme.accent, boxShadow: `0 0 12px ${selectedTheme.accent}` }} />
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 }}>GEOWAKE</Text>
          </View>

          <View style={{ flex: 1, position: 'relative' }}>
            <TextInput
              style={{
                backgroundColor: 'rgba(0,0,0,0.3)',
                borderColor: selectedTheme.border,
                borderWidth: 1,
                color: '#fff',
                padding: 8,
                paddingHorizontal: 14,
                borderRadius: 16,
                fontSize: 12,
                
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

          <TouchableOpacity
            style={[s.dockBtn, { backgroundColor: selectedTheme.accent, shadowColor: selectedTheme.accent, shadowOpacity: 0.6, shadowRadius: 10 }]}
            onPress={() => setIsAiModalOpen(true)}
          >
            <Text style={{ color: '#020617', fontWeight: '900', fontSize: 11 }}>✨ AI</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.dockIconBtn, { borderColor: selectedTheme.border }]} onPress={() => setIsLayersModalOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={selectedTheme.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </TouchableOpacity>

          <TouchableOpacity style={[s.dockIconBtn, { borderColor: selectedTheme.border }]} onPress={() => setIsModalOpen(true)}>
            <Text style={{ color: selectedTheme.accent, fontWeight: 'bold', fontSize: 12 }}>🔔 {alarms.length}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.dockIconBtn, { borderColor: selectedTheme.border }]} onPress={handleLogout}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </TouchableOpacity>
        </View>
      </View>

      {/* ⭐ Favorites Live Chips Bar */}
      <View style={s.favBar}>
        {favorites.map((fav) => {
          const distanceStr = userLocation ? getDistanceFormatted(userLocation.lat, userLocation.lng, fav.latitude, fav.longitude) : '';
          return (
            <TouchableOpacity
              key={fav.id}
              style={[s.favChip, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}
              onPress={() => handleActivateFavorite(fav)}
            >
              <Text style={{ color: selectedTheme.accent, fontSize: 11, fontWeight: 'bold' }}>
                ⭐ {fav.label} {distanceStr ? `• ${distanceStr}` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Success Notification */}
      {successMsg && (
        <View style={[s.successBanner, { borderColor: selectedTheme.accent, shadowColor: selectedTheme.accent }]}>
          <Text style={s.successText}>{successMsg}</Text>
        </View>
      )}

      {/* Minimal Status Pill */}
      <View style={[s.minimalStatusPill, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}>
        <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', boxShadow: '0 0 8px #10b981' }} />
        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600', marginLeft: 6 }}>
          GPS Live • <span style={{ color: selectedTheme.accent }}>{alarms.length} Alarms</span>
        </Text>
      </View>

      {/* Recenter Button */}
      {userLocation && (
        <TouchableOpacity style={[s.recenter, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]} onPress={() => setRecenterCount((c) => c + 1)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={selectedTheme.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="22" y1="12" x2="18" y2="12" /><line x1="6" y1="12" x2="2" y2="12" /><line x1="12" y1="6" x2="12" y2="2" /><line x1="12" y1="22" x2="12" y2="18" />
          </svg>
        </TouchableOpacity>
      )}

      {/* Drop Pin Button */}
      <TouchableOpacity
        style={[s.fab, { backgroundColor: isPinMode ? '#ef4444' : selectedTheme.accent, shadowColor: selectedTheme.accent, shadowOpacity: 0.6, shadowRadius: 15 }]}
        onPress={() => { setIsPinMode(!isPinMode); if (isPinMode) setCustomPin(null); }}
      >
        <Text style={{ color: '#020617', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 }}>
          {isPinMode ? '✕ Cancel Pin' : '+ Drop Pin'}
        </Text>
      </TouchableOpacity>

      {/* Slide-Up Pin Config Card */}
      {customPin && (
        <View style={[s.configCard, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}>
          <Text style={{ color: '#fff', fontWeight: '900', marginBottom: 10, fontSize: 16, letterSpacing: 0.5 }}>📍 Setup Geofence Guard</Text>
          <TextInput style={s.inp} value={form.title} onChangeText={(t) => setForm({ ...form, title: t })} placeholder="Alarm Name" placeholderTextColor="#64748b" />
          <TextInput style={s.inp} value={form.radius} onChangeText={(t) => setForm({ ...form, radius: t })} placeholder="Radius (Meters)" placeholderTextColor="#64748b" />

          <TouchableOpacity style={s.favCheckRow} onPress={() => setSaveAsFav(!saveAsFav)}>
            <Text style={{ color: saveAsFav ? selectedTheme.accent : '#64748b', fontSize: 16 }}>{saveAsFav ? '☑️' : '◻️'}</Text>
            <Text style={{ color: '#94a3b8', fontSize: 12, marginLeft: 6 }}>Save to ⭐ Favorites</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.btn, { backgroundColor: selectedTheme.accent }]} onPress={handleSaveAlarm}>
            <Text style={s.btnTxt}>Activate Alarm Guard 🔔</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 🚨 Wake-Up Modal */}
      <Modal visible={!!ringingAlarm} transparent animationType="fade">
        <View style={s.alarmTriggerOverlay}>
          <div style={{ position: 'absolute', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(239,68,68,0.4) 0%, transparent 70%)', filter: 'blur(50px)', animation: 'pulseGlow 2s ease-in-out infinite' }} />
          <View style={s.alarmTriggerCard}>
            <Text style={s.alarmTriggerEmoji}>🚨</Text>
            <Text style={s.alarmTriggerTitle}>WAKE UP!</Text>
            <Text style={s.alarmTriggerSub}>Arrived at "{ringingAlarm?.title}"</Text>
            <Text style={s.alarmTriggerDist}>Distance: {ringingAlarm?.distance || 0}m away</Text>

            <TouchableOpacity style={s.stopAlarmBtn} onPress={stopAlarmSound}>
              <Text style={s.stopAlarmText}>🔕 STOP ALARM</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Theme Customizer Modal */}
      <Modal visible={isLayersModalOpen} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={[s.themeModalCard, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.accent }]}>
            <Text style={[s.themeModalTitle, { color: selectedTheme.accent }]}>🥞 Theme & Layers Customizer</Text>
            <Text style={s.themeSectionHeader}>🎨 UI Color Palettes (Primary & Secondary):</Text>
            <View style={{ gap: 8, marginBottom: 16 }}>
              {THEMES.map((theme) => (
                <TouchableOpacity
                  key={theme.id}
                  style={[s.paletteRow, selectedTheme.id === theme.id && { borderColor: theme.accent, backgroundColor: 'rgba(255,255,255,0.08)' }]}
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
            <ScrollView style={{ maxHeight: 240 }}>
              {alarms.map((a) => {
                const liveDistance = userLocation ? getDistanceFormatted(userLocation.lat, userLocation.lng, a.latitude, a.longitude) : 'Calculating...';
                return (
                  <View key={a.id} style={s.alarmRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>{a.title}</Text>
                      <Text style={{ color: selectedTheme.accent, fontSize: 11, marginTop: 2 }}>
                        📍 {liveDistance} away • Radius: {a.radiusMeters}m
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => handleDelete(a.id)}><Text style={{ color: '#f87171', fontWeight: 'bold' }}>🗑️</Text></TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setIsModalOpen(false)}><Text style={{ color: '#64748b', textAlign: 'center', marginTop: 10 }}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s: any = StyleSheet.create({
  c: { flex: 1 },
  authBackground: { flex: 1, backgroundColor: '#030712', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  authGlassCard: { backgroundColor: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(30px)', padding: 36, borderRadius: 28, width: 380, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.12)', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 40 },
  authIconBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(6, 182, 212, 0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 1.5, borderColor: '#06b6d4' },
  authSub: { color: '#94a3b8', fontSize: 13, textAlign: 'center', marginTop: 6, marginBottom: 26, letterSpacing: 0.2 },
  authDividerRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: 24, gap: 8 },
  authDividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)' },
  authDividerText: { color: '#64748b', fontSize: 11, letterSpacing: 0.5 },

  topDockWrapper: { position: 'absolute', top: 18, left: 18, right: 18, alignItems: 'center', zIndex: 1000 },
  topDock: { flexDirection: 'row', alignItems: 'center', padding: 8, paddingHorizontal: 14, borderRadius: 24, borderWidth: 1, backdropFilter: 'blur(24px)', width: '100%', maxWidth: 640, gap: 8, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20 },
  brandSection: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 6 },
  dockBtn: { padding: 8, paddingHorizontal: 14, borderRadius: 16, justifyContent: 'center' },
  dockIconBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', borderWidth: 1, backgroundColor: 'rgba(0,0,0,0.2)' },

  favBar: { position: 'absolute', top: 76, left: 18, flexDirection: 'row', alignItems: 'center', zIndex: 1000, gap: 6 },
  favChip: { padding: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, backdropFilter: 'blur(16px)' },
  drop: { position: 'absolute', top: 44, left: 0, right: 0, borderRadius: 14, borderWidth: 1, zIndex: 2000, overflow: 'hidden', backdropFilter: 'blur(20px)' },
  dropItem: { padding: 12, borderBottomWidth: 1 },

  successBanner: { position: 'absolute', top: 110, alignSelf: 'center', backgroundColor: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(20px)', padding: 12, paddingHorizontal: 22, borderRadius: 30, borderWidth: 1.5, zIndex: 2500, shadowOpacity: 0.6, shadowRadius: 15 },
  successText: { color: '#ecfdf5', fontWeight: 'bold', fontSize: 13 },
  minimalStatusPill: { position: 'absolute', bottom: 18, left: 18, flexDirection: 'row', alignItems: 'center', padding: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, backdropFilter: 'blur(20px)', zIndex: 1000 },
  recenter: { position: 'absolute', bottom: 70, right: 18, width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', zIndex: 1000, borderWidth: 1, backdropFilter: 'blur(20px)' },
  fab: { position: 'absolute', bottom: 18, right: 18, padding: 14, paddingHorizontal: 24, borderRadius: 30, zIndex: 1000 },
  configCard: { position: 'absolute', bottom: 75, right: 18, width: 320, padding: 20, borderRadius: 20, borderWidth: 1, backdropFilter: 'blur(24px)', zIndex: 1100, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 25 },
  favCheckRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, marginTop: 4 },
  card: { padding: 22, borderRadius: 20, width: 340, borderWidth: 1, backdropFilter: 'blur(24px)' },
  themeModalCard: { padding: 24, borderRadius: 24, width: 360, borderWidth: 1.5, backdropFilter: 'blur(30px)' },
  themeModalTitle: { fontWeight: 'bold', fontSize: 17, textAlign: 'center', marginBottom: 16 },
  themeSectionHeader: { color: '#94a3b8', fontSize: 12, fontWeight: 'bold', marginBottom: 8 },
  paletteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  colorCircle: { width: 18, height: 18, borderRadius: 9 },
  mapLayerRow: { flexDirection: 'row', gap: 8 },
  mapLayerBtn: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  aiCard: { padding: 24, borderRadius: 24, width: 350, borderWidth: 1.5, backdropFilter: 'blur(30px)' },
  aiModalTitle: { fontWeight: 'bold', fontSize: 16, textAlign: 'center', marginBottom: 4 },
  aiModalSub: { color: '#94a3b8', fontSize: 11, textAlign: 'center', marginBottom: 14 },
  aiSubmitBtn: { padding: 12, borderRadius: 14, alignItems: 'center' },
  inp: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', fontSize: 13, outline: 'none' },
  btn: { padding: 13, borderRadius: 14, alignItems: 'center' },
  btnTxt: { color: '#020617', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
  alarmRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 12, marginTop: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', justifyContent: 'center', alignItems: 'center' },

  alarmTriggerOverlay: { flex: 1, backgroundColor: 'rgba(239, 68, 68, 0.25)', backdropFilter: 'blur(15px)', justifyContent: 'center', alignItems: 'center' },
  alarmTriggerCard: { backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(30px)', padding: 32, borderRadius: 28, width: 350, alignItems: 'center', borderWidth: 2, borderColor: '#ef4444', shadowColor: '#ef4444', shadowOpacity: 0.8, shadowRadius: 35 },
  alarmTriggerEmoji: { fontSize: 48, marginBottom: 8 },
  alarmTriggerTitle: { color: '#ef4444', fontWeight: '900', fontSize: 28, letterSpacing: 2 },
  alarmTriggerSub: { color: '#fff', fontWeight: 'bold', fontSize: 16, textAlign: 'center', marginTop: 8 },
  alarmTriggerDist: { color: '#94a3b8', fontSize: 13, marginTop: 4, marginBottom: 22 },
  stopAlarmBtn: { backgroundColor: '#ef4444', padding: 16, paddingHorizontal: 30, borderRadius: 30, width: '100%', alignItems: 'center', shadowColor: '#ef4444', shadowOpacity: 0.6, shadowRadius: 20 },
  stopAlarmText: { color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 1 },
} as any);