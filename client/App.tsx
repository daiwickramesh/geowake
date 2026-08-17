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
let customAudioElement: HTMLAudioElement | null = null;

export interface ThemeType {
  id: string;
  name: string;
  primary: string;
  card: string;
  border: string;
  accent: string;
  text: string;
}

const SOUND_OPTIONS = [
  { id: 'radar', name: '📡 iPhone Radar Chime', desc: 'Melodic two-tone iOS chime' },
  { id: 'metro', name: '🚆 Metro Transit Jingle', desc: 'Japanese train arrival melody' },
  { id: 'digital', name: '⏰ Classic Digital Beep', desc: '4-pulse alarm clock' },
  { id: 'fahhh', name: '📢 "Fahhhhhhh!" Meme', desc: 'Loud comedic horn wake-up' },
  { id: 'custom', name: '📁 Custom Uploaded Audio', desc: 'Your own MP3/WAV file' },
];

const THEMES: ThemeType[] = [
  { id: 'cyan', name: 'Cyber Cyan', primary: '#030712', card: '#0f172a', border: 'rgba(6, 182, 212, 0.3)', accent: '#06b6d4', text: '#ffffff' },
  { id: 'emerald', name: 'Matrix Emerald', primary: '#021209', card: '#062817', border: 'rgba(16, 185, 129, 0.3)', accent: '#10b981', text: '#ffffff' },
  { id: 'purple', name: 'Neon Synthwave', primary: '#090414', card: '#180a30', border: 'rgba(192, 132, 252, 0.3)', accent: '#c084fc', text: '#ffffff' },
  { id: 'amber', name: 'Amber Sunset', primary: '#140c04', card: '#291807', border: 'rgba(245, 158, 11, 0.3)', accent: '#f59e0b', text: '#ffffff' },
  { id: 'crimson', name: 'Crimson Rogue', primary: '#140507', card: '#2b0a10', border: 'rgba(244, 63, 94, 0.3)', accent: '#f43f5e', text: '#ffffff' },
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
  const [token, setToken] = useState<string | null>(() => (typeof window !== 'undefined' ? localStorage.getItem('geowake_token') : null));
  const [userId, setUserId] = useState<string | null>(() => (typeof window !== 'undefined' ? localStorage.getItem('geowake_uid') : null));
  const [alarms, setAlarms] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [ringingAlarm, setRingingAlarm] = useState<any | null>(null);

  // Persistent Settings Memory
  const [selectedTheme, setSelectedTheme] = useState<ThemeType>(() => {
    if (typeof window === 'undefined') return THEMES[0];
    const saved = localStorage.getItem('geowake_theme_id');
    return THEMES.find((t) => t.id === saved) || THEMES[0];
  });

  const [mapTheme, setMapTheme] = useState<'dark' | 'light' | 'satellite'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const savedMap = localStorage.getItem('geowake_map_style');
    return (savedMap === 'light' || savedMap === 'satellite' ? savedMap : 'dark');
  });

  const [selectedSound, setSelectedSound] = useState<string>(() => {
    if (typeof window === 'undefined') return 'radar';
    return localStorage.getItem('geowake_sound') || 'radar';
  });

  const [customAudioBase64, setCustomAudioBase64] = useState<string | null>(() => (typeof window !== 'undefined' ? localStorage.getItem('geowake_custom_audio') : null));
  const [customAudioName, setCustomAudioName] = useState<string>(() => (typeof window !== 'undefined' ? localStorage.getItem('geowake_custom_name') || 'No file uploaded' : 'No file uploaded'));

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isLayersModalOpen, setIsLayersModalOpen] = useState(false);
  const [isFavListOpen, setIsFavListOpen] = useState(false);

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

  const handleUpdateTheme = (theme: ThemeType) => {
    setSelectedTheme(theme);
    localStorage.setItem('geowake_theme_id', theme.id);
  };

  const handleUpdateMapTheme = (style: 'dark' | 'light' | 'satellite') => {
    setMapTheme(style);
    localStorage.setItem('geowake_map_style', style);
  };

  const handleUpdateSound = (soundId: string) => {
    setSelectedSound(soundId);
    localStorage.setItem('geowake_sound', soundId);
  };

  const triggerAudioFileUpload = () => {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const base64Audio = uploadEvent.target?.result as string;
        setCustomAudioBase64(base64Audio);
        setCustomAudioName(file.name);
        handleUpdateSound('custom');
        localStorage.setItem('geowake_custom_audio', base64Audio);
        localStorage.setItem('geowake_custom_name', file.name);
        showNotification(`📁 Saved "${file.name}" as your permanent alarm!`);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const playSoundTone = (type: string) => {
    if (type === 'custom' && customAudioBase64) {
      const audio = new Audio(customAudioBase64);
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }

    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;

      if (type === 'radar') {
        [587.33, 880].forEach((freq, i) => {
          const osc = audioCtx!.createOscillator();
          const gain = audioCtx!.createGain();
          osc.connect(gain);
          gain.connect(audioCtx!.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.15);
          gain.gain.setValueAtTime(0.4, now + i * 0.15);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.35);
          osc.start(now + i * 0.15);
          osc.stop(now + i * 0.15 + 0.4);
        });
      } else if (type === 'metro') {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          const osc = audioCtx!.createOscillator();
          const gain = audioCtx!.createGain();
          osc.connect(gain);
          gain.connect(audioCtx!.destination);
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + i * 0.12);
          gain.gain.setValueAtTime(0.35, now + i * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);
          osc.start(now + i * 0.12);
          osc.stop(now + i * 0.12 + 0.32);
        });
      } else if (type === 'digital') {
        [0, 0.1, 0.2, 0.3].forEach((t) => {
          const osc = audioCtx!.createOscillator();
          const gain = audioCtx!.createGain();
          osc.connect(gain);
          gain.connect(audioCtx!.destination);
          osc.type = 'square';
          osc.frequency.setValueAtTime(1046.5, now + t);
          gain.gain.setValueAtTime(0.2, now + t);
          gain.gain.exponentialRampToValueAtTime(0.01, now + t + 0.06);
          osc.start(now + t);
          osc.stop(now + t + 0.07);
        });
      } else if (type === 'fahhh') {
        const osc1 = audioCtx!.createOscillator();
        const osc2 = audioCtx!.createOscillator();
        const gain = audioCtx!.createGain();
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(audioCtx!.destination);

        osc1.type = 'sawtooth';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(220, now);
        osc1.frequency.exponentialRampToValueAtTime(110, now + 0.6);
        osc2.frequency.setValueAtTime(330, now);
        osc2.frequency.exponentialRampToValueAtTime(165, now + 0.6);

        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.75);
        osc2.stop(now + 0.75);
      }
    } catch (e) {
      console.warn('Audio error:', e);
    }
  };

  const startLoopingAlarm = () => {
    if (selectedSound === 'custom' && customAudioBase64) {
      customAudioElement = new Audio(customAudioBase64);
      customAudioElement.loop = true;
      customAudioElement.play().catch(() => {});
      return;
    }

    playSoundTone(selectedSound);
    const intervalMs = selectedSound === 'metro' ? 900 : selectedSound === 'fahhh' ? 850 : 650;
    alarmInterval = setInterval(() => playSoundTone(selectedSound), intervalMs);
  };

  const stopLoopingAlarm = () => {
    if (alarmInterval) clearInterval(alarmInterval);
    alarmInterval = null;

    if (customAudioElement) {
      customAudioElement.pause();
      customAudioElement.currentTime = 0;
      customAudioElement = null;
    }

    setRingingAlarm(null);
  };

  useEffect(() => {
    const savedToken = localStorage.getItem('geowake_token');
    if (savedToken) {
      fetchAlarms(savedToken);
      fetchFavorites(savedToken);
    }
  }, []);

  const saveSession = (tok: string, uid: string) => {
    setToken(tok);
    setUserId(uid);
    localStorage.setItem('geowake_token', tok);
    localStorage.setItem('geowake_uid', uid);
    fetchAlarms(tok);
    fetchFavorites(tok);
  };

  const handleLogout = () => {
    if (socket) socket.disconnect();
    stopLoopingAlarm();
    setToken(null);
    setUserId(null);
    setAlarms([]);
    setFavorites([]);
    setCustomPin(null);
    setIsPinMode(false);
    localStorage.removeItem('geowake_token');
    localStorage.removeItem('geowake_uid');
  };

  useEffect(() => {
    if (token) return;
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
        const btnSlot = document.getElementById('official-google-btn');
        if (btnSlot) {
          (window as any).google.accounts.id.renderButton(btnSlot, {
            theme: 'filled_black',
            size: 'large',
            shape: 'pill',
            width: 300,
            text: 'continue_with',
          });
        }
      }
    };
    document.body.appendChild(script);
  }, [token]);

  const handleGoogleCredentialResponse = async (response: any) => {
    try {
      const res = await fetch(`${API}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential }),
      }).then((r) => r.json());

      if (res.token) {
        saveSession(res.token, res.user.id);
        showNotification(`👋 Welcome, ${res.user.name}!`);
      } else {
        showNotification(`❌ ${res.error || 'Google login failed'}`);
      }
    } catch (err: any) {
      showNotification(`❌ ${err.message}`);
    }
  };

  useEffect(() => {
    if (!userId || !token) return;
    socket = io(SOCKET_URL);

    socket.on('alarm:trigger', (d: any) => {
      setRingingAlarm(d);
      startLoopingAlarm();
      fetchAlarms(token);
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
      return () => { navigator.geolocation.clearWatch(id); socket.disconnect(); stopLoopingAlarm(); };
    }
  }, [userId, token, selectedSound, customAudioBase64]);

  const handleAiSubmit = async () => {
    if (!aiPrompt.trim()) return;
    const currentToken = token || localStorage.getItem('geowake_token');
    if (!currentToken) return;

    setIsAiLoading(true);
    setAiError(null);

    try {
      const res = await fetch(`${API}/ai/parse-alarm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
        body: JSON.stringify({
          prompt: aiPrompt,
          userLat: userLocation?.lat || 12.9716,
          userLng: userLocation?.lng || 77.5946,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI could not resolve place.');

      const targetLat = Number(data.latitude);
      const targetLng = Number(data.longitude);
      const targetRadius = Number(data.radiusMeters) || 500;
      const targetTitle = data.title || 'Transit Stop';

      const saveRes = await fetch(`${API}/alarms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
        body: JSON.stringify({
          title: targetTitle,
          destinationName: targetTitle,
          latitude: targetLat,
          longitude: targetLng,
          radiusMeters: targetRadius,
        }),
      });

      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || 'Failed to save alarm.');

      fetchAlarms(currentToken);
      setFocusLocation({ lat: targetLat, lng: targetLng, key: Date.now() });
      showNotification(`✅ AI Activated: "${targetTitle}" (${targetRadius}m)`);
      setIsAiModalOpen(false);
      setAiPrompt('');
      setCustomPin(null);
      setIsPinMode(false);
    } catch (err: any) {
      setAiError(err.message || 'Failed to activate alarm.');
      showNotification(`❌ Error: ${err.message}`);
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
    try {
      const res = await fetch(`${API}/alarms`, { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.json());
      setAlarms(res.alarms || []);
    } catch (e) {}
  };

  const fetchFavorites = async (tok: string) => {
    try {
      const res = await fetch(`${API}/favorites`, { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.json());
      setFavorites(res.favorites || []);
    } catch (e) {}
  };

  const handleActivateFavorite = async (fav: any) => {
    const currentToken = token || localStorage.getItem('geowake_token');
    if (!currentToken) return;

    const favLat = Number(fav.latitude);
    const favLng = Number(fav.longitude);
    const favRadius = Number(fav.radiusMeters) || 500;

    const res = await fetch(`${API}/alarms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
      body: JSON.stringify({
        title: fav.label,
        destinationName: fav.addressName || fav.label,
        latitude: favLat,
        longitude: favLng,
        radiusMeters: favRadius,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      showNotification(`⚠️ ${data.error || 'Already active'}`);
      setFocusLocation({ lat: favLat, lng: favLng, key: Date.now() });
      setIsFavListOpen(false);
      return;
    }

    fetchAlarms(currentToken);
    setFocusLocation({ lat: favLat, lng: favLng, key: Date.now() });
    showNotification(`🔔 Activated: "${fav.label}" (${favRadius}m)`);
    setIsFavListOpen(false);
  };

  const handleDeleteFavorite = async (favId: string) => {
    const currentToken = token || localStorage.getItem('geowake_token');
    if (!currentToken) return;

    await fetch(`${API}/favorites/${favId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${currentToken}` } });
    fetchFavorites(currentToken);
  };

  const handleSaveAlarm = async () => {
    const currentToken = token || localStorage.getItem('geowake_token');
    if (!customPin || !currentToken) return;

    const savedLat = Number(customPin.lat);
    const savedLng = Number(customPin.lng);
    const alarmTitle = form.title.trim() || 'Custom Stop';
    const alarmRadius = Number(form.radius) || 500;

    try {
      const res = await fetch(`${API}/alarms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
        body: JSON.stringify({
          title: alarmTitle,
          destinationName: alarmTitle,
          latitude: savedLat,
          longitude: savedLng,
          radiusMeters: alarmRadius,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save alarm.');

      if (saveAsFav) {
        await fetch(`${API}/favorites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
          body: JSON.stringify({
            label: alarmTitle,
            addressName: alarmTitle,
            latitude: savedLat,
            longitude: savedLng,
            radiusMeters: alarmRadius,
          }),
        });
        fetchFavorites(currentToken);
      }

      fetchAlarms(currentToken);
      setFocusLocation({ lat: savedLat, lng: savedLng, key: Date.now() });
      showNotification(`✅ Alarm Activated: "${alarmTitle}" (${alarmRadius}m)`);
      setCustomPin(null);
      setIsPinMode(false);
      setSaveAsFav(false);
    } catch (err: any) {
      showNotification(`⚠️ ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    const currentToken = token || localStorage.getItem('geowake_token');
    if (!currentToken) return;
    await fetch(`${API}/alarms/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${currentToken}` } });
    fetchAlarms(currentToken);
  };

  const handleClearAllAlarms = async () => {
    const currentToken = token || localStorage.getItem('geowake_token');
    if (!currentToken) return;
    await fetch(`${API}/alarms/clear-all`, { method: 'DELETE', headers: { Authorization: `Bearer ${currentToken}` } });
    fetchAlarms(currentToken);
    showNotification('🗑️ All alarms cleared!');
  };

  if (!token) {
    return (
      <View style={s.authBackground}>
        <View style={s.authGlassCard}>
          <View style={s.authIconBadge}>
            <Text style={{ fontSize: 28 }}>📍</Text>
          </View>
          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '900', textAlign: 'center', marginBottom: 4 }}>
            GeoWake
          </Text>
          <Text style={s.authSub}>Smart Transit Geofencing & Wake Alarm</Text>
          <View nativeID="official-google-btn" style={{ minHeight: 44, width: '100%', alignItems: 'center' }} />
        </View>
      </View>
    );
  }

  return (
    <View style={[s.c, { backgroundColor: selectedTheme.primary }]}>
      <LeafletMap
        customPin={customPin}
        radius={Number(form.radius) || 500}
        userLocation={userLocation}
        alarms={alarms}
        mapStyle={mapTheme}
        accentColor={selectedTheme.accent}
        focusLocation={focusLocation}
        isPinMode={isPinMode}
        recenterTrigger={recenterCount}
        onLocationSelect={(lat, lng) => setCustomPin({ lat: parseFloat(lat.toFixed(4)), lng: parseFloat(lng.toFixed(4)) })}
      />

      {/* 🛸 Top Dock */}
      <View style={s.topDockWrapper}>
        <View style={[s.topDock, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}>
          <View style={s.brandSection}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: selectedTheme.accent }} />
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

          <TouchableOpacity style={[s.dockBtn, { backgroundColor: selectedTheme.accent }]} onPress={() => setIsAiModalOpen(true)}>
            <Text style={{ color: '#020617', fontWeight: '900', fontSize: 11 }}>✨ AI</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.dockIconBtn, { borderColor: selectedTheme.border }]} onPress={() => setIsFavListOpen(true)}>
            <Text style={{ fontSize: 14 }}>⭐</Text>
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

      {/* ⭐ Favorites Bar */}
      {favorites.length > 0 && (
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
      )}

      {/* Notification Banner */}
      {successMsg && (
        <View style={[s.successBanner, { borderColor: selectedTheme.accent }]}>
          <Text style={s.successText}>{successMsg}</Text>
        </View>
      )}

      {/* Status Pill */}
      <View style={[s.minimalStatusPill, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.border }]}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10b981' }} />
        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600', marginLeft: 6 }}>
          GPS Live • <Text style={{ color: selectedTheme.accent }}>{alarms.length} Alarms</Text>
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
        style={[s.fab, { backgroundColor: isPinMode ? '#ef4444' : selectedTheme.accent }]}
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
          <TextInput style={s.inp} value={form.radius} onChangeText={(t) => setForm({ ...form, radius: t })} placeholder="Radius (Meters)" placeholderTextColor="#64748b" keyboardType="numeric" />

          <TouchableOpacity style={s.favCheckRow} onPress={() => setSaveAsFav(!saveAsFav)}>
            <Text style={{ color: saveAsFav ? selectedTheme.accent : '#64748b', fontSize: 16 }}>{saveAsFav ? '☑️' : '◻️'}</Text>
            <Text style={{ color: '#94a3b8', fontSize: 12, marginLeft: 6 }}>Save to ⭐ Favorites</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.btn, { backgroundColor: selectedTheme.accent }]} onPress={handleSaveAlarm}>
            <Text style={s.btnTxt}>Activate Alarm Guard 🔔</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ⭐ Favorites Modal */}
      <Modal visible={isFavListOpen} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.card, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.accent }]}>
            <Text style={{ color: selectedTheme.accent, fontWeight: '900', fontSize: 18, marginBottom: 4, textAlign: 'center' }}>
              ⭐ Saved Favorites ({favorites.length})
            </Text>
            <Text style={{ color: '#94a3b8', fontSize: 11, textAlign: 'center', marginBottom: 14 }}>
              1-tap to activate alarm. AI also recognizes these names!
            </Text>

            <ScrollView style={{ maxHeight: 220 }}>
              {favorites.length === 0 ? (
                <Text style={{ color: '#64748b', fontSize: 12, textAlign: 'center', marginVertical: 14 }}>
                  No favorites saved yet. Check "Save to ⭐ Favorites" when dropping a pin!
                </Text>
              ) : (
                favorites.map((fav) => (
                  <View key={fav.id} style={s.alarmRow}>
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => handleActivateFavorite(fav)}>
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>⭐ {fav.label}</Text>
                      <Text style={{ color: selectedTheme.accent, fontSize: 11, marginTop: 2 }}>{fav.addressName} ({fav.radiusMeters}m)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteFavorite(fav.id)}>
                      <Text style={{ color: '#f87171', fontWeight: 'bold' }}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>

            <TouchableOpacity style={[s.btn, { backgroundColor: selectedTheme.accent, marginTop: 12 }]} onPress={() => setIsFavListOpen(false)}>
              <Text style={s.btnTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🚨 Full-Screen Loud Wake-Up Modal */}
      <Modal visible={!!ringingAlarm} transparent animationType="fade">
        <View style={s.alarmTriggerOverlay}>
          <View style={s.alarmTriggerCard}>
            <Text style={s.alarmTriggerEmoji}>🚨</Text>
            <Text style={s.alarmTriggerTitle}>WAKE UP!</Text>
            <Text style={s.alarmTriggerSub}>Arrived at "{ringingAlarm?.title}"</Text>
            <Text style={s.alarmTriggerDist}>Distance: {ringingAlarm?.distance || 0}m away</Text>

            <TouchableOpacity style={s.stopAlarmBtn} onPress={stopLoopingAlarm}>
              <Text style={s.stopAlarmText}>🔕 STOP ALARM</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🥞 THEME & SOUND CUSTOMIZER MODAL */}
      <Modal visible={isLayersModalOpen} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={[s.themeModalCard, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.accent }]}>
            <Text style={[s.themeModalTitle, { color: selectedTheme.accent }]}>⚙️ App Customizer</Text>

            {/* 🔊 ALARM SOUND CHOICES */}
            <Text style={s.themeSectionHeader}>🔊 Alarm Ringtone Sound:</Text>
            <View style={{ gap: 6, marginBottom: 16 }}>
              {SOUND_OPTIONS.map((snd) => (
                <View
                  key={snd.id}
                  style={[s.soundRow, selectedSound === snd.id && { borderColor: selectedTheme.accent, backgroundColor: 'rgba(255,255,255,0.06)' }]}
                >
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    onPress={() => {
                      if (snd.id === 'custom' && !customAudioBase64) {
                        triggerAudioFileUpload();
                      } else {
                        handleUpdateSound(snd.id);
                      }
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: 'bold' }}>
                      {snd.id === 'custom' && customAudioBase64 ? `📁 ${customAudioName}` : snd.name}
                    </Text>
                    <Text style={{ color: '#94a3b8', fontSize: 10 }}>{snd.desc}</Text>
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {snd.id === 'custom' && (
                      <TouchableOpacity style={[s.previewSoundBtn, { borderColor: '#38bdf8' }]} onPress={triggerAudioFileUpload}>
                        <Text style={{ color: '#38bdf8', fontSize: 11, fontWeight: 'bold' }}>📁 Upload</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity style={[s.previewSoundBtn, { borderColor: selectedTheme.accent }]} onPress={() => playSoundTone(snd.id)}>
                      <Text style={{ color: selectedTheme.accent, fontSize: 11, fontWeight: 'bold' }}>▶️ Test</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>

            {/* 🎨 COLOR THEMES */}
            <Text style={s.themeSectionHeader}>🎨 UI Color Theme:</Text>
            <View style={{ gap: 6, marginBottom: 14 }}>
              {THEMES.map((theme) => (
                <TouchableOpacity
                  key={theme.id}
                  style={[s.paletteRow, selectedTheme.id === theme.id && { borderColor: theme.accent, backgroundColor: 'rgba(255,255,255,0.08)' }]}
                  onPress={() => handleUpdateTheme(theme)}
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

            {/* 🗺️ MAP BASE VIEWS */}
            <Text style={s.themeSectionHeader}>🗺️ Map Base View:</Text>
            <View style={s.mapLayerRow}>
              <TouchableOpacity style={[s.mapLayerBtn, mapTheme === 'dark' && { backgroundColor: selectedTheme.accent }]} onPress={() => handleUpdateMapTheme('dark')}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: mapTheme === 'dark' ? '#020617' : '#fff' }}>🌙 Dark</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.mapLayerBtn, mapTheme === 'light' && { backgroundColor: selectedTheme.accent }]} onPress={() => handleUpdateMapTheme('light')}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: mapTheme === 'light' ? '#020617' : '#fff' }}>☀️ Light</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.mapLayerBtn, mapTheme === 'satellite' && { backgroundColor: selectedTheme.accent }]} onPress={() => handleUpdateMapTheme('satellite')}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: mapTheme === 'satellite' ? '#020617' : '#fff' }}>🛰️ Satellite</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[s.btn, { backgroundColor: selectedTheme.accent, marginTop: 16 }]} onPress={() => setIsLayersModalOpen(false)}>
              <Text style={s.btnTxt}>Apply Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* AI Modal */}
      <Modal visible={isAiModalOpen} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.aiCard, { backgroundColor: selectedTheme.card, borderColor: selectedTheme.accent }]}>
            <Text style={[s.aiModalTitle, { color: selectedTheme.accent }]}>✨ AI Assistant</Text>
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
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
                Active Alarms ({alarms.length})
              </Text>
              {alarms.length > 0 && (
                <TouchableOpacity style={s.clearAllBtn} onPress={handleClearAllAlarms}>
                  <Text style={{ color: '#ef4444', fontSize: 11, fontWeight: 'bold' }}>🗑️ Clear All ({alarms.length})</Text>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={{ maxHeight: 240 }}>
              {alarms.length === 0 ? (
                <Text style={{ color: '#64748b', fontSize: 12, textAlign: 'center', marginVertical: 14 }}>
                  No active alarms. Set one using '+ Drop Pin' or '✨ AI'!
                </Text>
              ) : (
                alarms.map((a) => {
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
                })
              )}
            </ScrollView>

            <TouchableOpacity style={[s.btn, { backgroundColor: selectedTheme.accent, marginTop: 12 }]} onPress={() => setIsModalOpen(false)}>
              <Text style={s.btnTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s: any = StyleSheet.create({
  c: { flex: 1 },
  authBackground: { flex: 1, backgroundColor: '#030712', justifyContent: 'center', alignItems: 'center' },
  authGlassCard: { backgroundColor: 'rgba(15, 23, 42, 0.85)', padding: 36, borderRadius: 28, width: 380, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.12)' },
  authIconBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(6, 182, 212, 0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 1.5, borderColor: '#06b6d4' },
  authSub: { color: '#94a3b8', fontSize: 13, textAlign: 'center', marginTop: 6, marginBottom: 26, letterSpacing: 0.2 },

  topDockWrapper: { position: 'absolute', top: 18, left: 18, right: 18, alignItems: 'center', zIndex: 1000 },
  topDock: { flexDirection: 'row', alignItems: 'center', padding: 8, paddingHorizontal: 14, borderRadius: 24, borderWidth: 1, width: '100%', maxWidth: 640, gap: 8 },
  brandSection: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 6 },
  dockBtn: { padding: 8, paddingHorizontal: 14, borderRadius: 16, justifyContent: 'center' },
  dockIconBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', borderWidth: 1, backgroundColor: 'rgba(0,0,0,0.2)' },

  favBar: { position: 'absolute', top: 76, left: 18, flexDirection: 'row', alignItems: 'center', zIndex: 1000, gap: 6 },
  favChip: { padding: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1 },
  drop: { position: 'absolute', top: 44, left: 0, right: 0, borderRadius: 14, borderWidth: 1, zIndex: 2000, overflow: 'hidden' },
  dropItem: { padding: 12, borderBottomWidth: 1 },

  successBanner: { position: 'absolute', top: 110, alignSelf: 'center', backgroundColor: 'rgba(15, 23, 42, 0.95)', padding: 12, paddingHorizontal: 22, borderRadius: 30, borderWidth: 1.5, zIndex: 2500 },
  successText: { color: '#ecfdf5', fontWeight: 'bold', fontSize: 13 },
  minimalStatusPill: { position: 'absolute', bottom: 18, left: 18, flexDirection: 'row', alignItems: 'center', padding: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, zIndex: 1000 },
  recenter: { position: 'absolute', bottom: 70, right: 18, width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', zIndex: 1000, borderWidth: 1 },
  fab: { position: 'absolute', bottom: 18, right: 18, padding: 14, paddingHorizontal: 24, borderRadius: 30, zIndex: 1000 },
  configCard: { position: 'absolute', bottom: 75, right: 18, width: 320, padding: 20, borderRadius: 20, borderWidth: 1, zIndex: 1100 },
  favCheckRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, marginTop: 4 },
  card: { padding: 22, borderRadius: 20, width: 340, borderWidth: 1 },
  clearAllBtn: { padding: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1, borderColor: '#ef4444' },

  themeModalCard: { padding: 24, borderRadius: 24, width: 370, borderWidth: 1.5,  },
  themeModalTitle: { fontWeight: 'bold', fontSize: 17, textAlign: 'center', marginBottom: 16 },
  themeSectionHeader: { color: '#94a3b8', fontSize: 12, fontWeight: 'bold', marginBottom: 8 },
  soundRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  previewSoundBtn: { padding: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, backgroundColor: 'rgba(0,0,0,0.2)' },
  paletteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 8, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  colorCircle: { width: 16, height: 16, borderRadius: 8 },
  mapLayerRow: { flexDirection: 'row', gap: 8 },
  mapLayerBtn: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },

  aiCard: { padding: 24, borderRadius: 24, width: 350, borderWidth: 1.5 },
  aiModalTitle: { fontWeight: 'bold', fontSize: 16, textAlign: 'center', marginBottom: 4 },
  aiModalSub: { color: '#94a3b8', fontSize: 11, textAlign: 'center', marginBottom: 14 },
  aiSubmitBtn: { padding: 12, borderRadius: 14, alignItems: 'center' },
  inp: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', fontSize: 13 },
  btn: { padding: 13, borderRadius: 14, alignItems: 'center' },
  btnTxt: { color: '#020617', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
  alarmRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 12, marginTop: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },

  alarmTriggerOverlay: { flex: 1, backgroundColor: 'rgba(239, 68, 68, 0.25)', justifyContent: 'center', alignItems: 'center' },
  alarmTriggerCard: { backgroundColor: 'rgba(15, 23, 42, 0.95)', padding: 32, borderRadius: 28, width: 350, alignItems: 'center', borderWidth: 2, borderColor: '#ef4444' },
  alarmTriggerEmoji: { fontSize: 48, marginBottom: 8 },
  alarmTriggerTitle: { color: '#ef4444', fontWeight: '900', fontSize: 28, letterSpacing: 2 },
  alarmTriggerSub: { color: '#fff', fontWeight: 'bold', fontSize: 16, textAlign: 'center', marginTop: 8 },
  alarmTriggerDist: { color: '#94a3b8', fontSize: 13, marginTop: 4, marginBottom: 22 },
  stopAlarmBtn: { backgroundColor: '#ef4444', padding: 16, paddingHorizontal: 30, borderRadius: 30, width: '100%', alignItems: 'center' },
  stopAlarmText: { color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 1 },
});