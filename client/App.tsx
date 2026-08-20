import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
} from "react-native";
import { io } from "socket.io-client";
import LeafletMap from "./components/LeafletMap";

const GOOGLE_CLIENT_ID =
  "352537067303-ac52hmbcmhburhdto99vhkn5tffqunnr.apps.googleusercontent.com";
const IS_LOCAL =
  typeof window !== "undefined" && window.location.hostname === "localhost";
const API = IS_LOCAL
  ? "http://localhost:5000/api"
  : "https://geowake.onrender.com/api";
const SOCKET_URL = IS_LOCAL
  ? "http://localhost:5000"
  : "https://geowake.onrender.com";

let socket: any, audioCtx: any, alarmInterval: any, customAudio: any;

const SOUNDS = [
  { id: "radar", name: "📡 iPhone Radar", desc: "Melodic iOS chime" },
  { id: "metro", name: "🚆 Metro Jingle", desc: "Transit melody" },
  { id: "digital", name: "⏰ Digital Beep", desc: "Classic clock" },
  { id: "fahhh", name: "📢 Fahhh", desc: "Bells" },
  { id: "custom", name: "📁 Custom MP3", desc: "Upload file" },
];

const THEMES = [
  {
    id: "cyan",
    name: "Cyber Cyan",
    primary: "#030712",
    card: "#0f172a",
    border: "rgba(6, 182, 212, 0.3)",
    accent: "#06b6d4",
    text: "#fff",
  },
  {
    id: "emerald",
    name: "Matrix Emerald",
    primary: "#021209",
    card: "#062817",
    border: "rgba(16, 185, 129, 0.3)",
    accent: "#10b981",
    text: "#fff",
  },
  {
    id: "purple",
    name: "Neon Synthwave",
    primary: "#090414",
    card: "#180a30",
    border: "rgba(192, 132, 252, 0.3)",
    accent: "#c084fc",
    text: "#fff",
  },
  {
    id: "amber",
    name: "Amber Sunset",
    primary: "#140c04",
    card: "#291807",
    border: "rgba(245, 158, 11, 0.3)",
    accent: "#f59e0b",
    text: "#fff",
  },
  {
    id: "crimson",
    name: "Crimson Rogue",
    primary: "#140507",
    card: "#2b0a10",
    border: "rgba(244, 63, 94, 0.3)",
    accent: "#f43f5e",
    text: "#fff",
  },
];

function getDistanceFormatted(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const R = 6371000,
    dLat = ((lat2 - lat1) * Math.PI) / 180,
    dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
}

// 📍 GEOWAKE Vector Logo (Blue Pin + Clock Dial at 3:00 + Ground Ripple)
const GeoWakeLogo = ({ s = 90 }: { s?: number }) => (
  <svg width={s} height={s * 1.3} viewBox="0 0 120 155" fill="none">
    <defs>
      <linearGradient id="logoBlueGrad" x1="10%" y1="10%" x2="90%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="60%" stopColor="#2563eb" />
        <stop offset="100%" stopColor="#1d4ed8" />
      </linearGradient>
      <filter id="logoShadow" x="-20%" y="-10%" width="140%" height="130%">
        <feDropShadow
          dx="0"
          dy="4"
          stdDeviation="4"
          floodColor="#000000"
          floodOpacity="0.45"
        />
      </filter>
    </defs>
    <ellipse
      cx="60"
      cy="135"
      rx="42"
      ry="11"
      stroke="#090d16"
      strokeWidth="4.5"
      fill="none"
      opacity="0.95"
    />
    <ellipse
      cx="60"
      cy="135"
      rx="27"
      ry="7"
      stroke="#090d16"
      strokeWidth="3.5"
      fill="none"
      opacity="0.95"
    />
    <ellipse cx="60" cy="135" rx="12" ry="3.5" fill="#090d16" />
    <g filter="url(#logoShadow)">
      <path
        d="M60 128 C60 128 104 84 104 54 C104 26 84 6 60 6 C36 6 16 26 16 54 C16 84 60 128 60 128 Z"
        fill="url(#logoBlueGrad)"
        stroke="#1e3a8a"
        strokeWidth="3.5"
      />
    </g>
    <circle
      cx="60"
      cy="52"
      r="32"
      fill="#ffffff"
      stroke="#1e3a8a"
      strokeWidth="3.5"
    />
    <line
      x1="60"
      y1="24"
      x2="60"
      y2="31"
      stroke="#0f172a"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <line
      x1="60"
      y1="73"
      x2="60"
      y2="80"
      stroke="#0f172a"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <line
      x1="32"
      y1="52"
      x2="39"
      y2="52"
      stroke="#0f172a"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <line
      x1="81"
      y1="52"
      x2="88"
      y2="52"
      stroke="#0f172a"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <line
      x1="60"
      y1="52"
      x2="60"
      y2="33"
      stroke="#0f172a"
      strokeWidth="4.5"
      strokeLinecap="round"
    />
    <line
      x1="60"
      y1="52"
      x2="79"
      y2="52"
      stroke="#0f172a"
      strokeWidth="4.5"
      strokeLinecap="round"
    />
    <circle cx="60" cy="52" r="4" fill="#0f172a" />
    <text
      x="60"
      y="108"
      textAnchor="middle"
      fill="#bfdbfe"
      stroke="#0f172a"
      strokeWidth="1.5"
      fontFamily="system-ui, -apple-system, sans-serif"
      fontWeight="900"
      fontSize="16"
      letterSpacing="1.2"
    >
      GEOWAKE
    </text>
  </svg>
);

export default function App() {
  const [token, setToken] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("geowake_token")
      : null,
  );
  const [userId, setUserId] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem("geowake_uid") : null,
  );
  const [alarms, setAlarms] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [ringingAlarm, setRingingAlarm] = useState<any | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Settings
  const [theme, setTheme] = useState(
    () =>
      THEMES.find(
        (t) =>
          t.id ===
          (typeof window !== "undefined" &&
            localStorage.getItem("geowake_theme_id")),
      ) || THEMES[0],
  );
  const [mapStyle, setMapStyle] = useState<"dark" | "light" | "satellite">(
    () =>
      (typeof window !== "undefined" &&
        (localStorage.getItem("geowake_map_style") as any)) ||
      "dark",
  );
  const [sound, setSound] = useState(
    () =>
      (typeof window !== "undefined" &&
        localStorage.getItem("geowake_sound")) ||
      "radar",
  );
  const [customAudio, setCustomAudio] = useState<string | null>(
    () =>
      (typeof window !== "undefined" &&
        localStorage.getItem("geowake_custom_audio")) ||
      null,
  );

  // Modals & States
  const [modal, setModal] = useState<
    "alarms" | "favs" | "settings" | "ai" | null
  >(null);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [focusLocation, setFocusLocation] = useState<{
    lat: number;
    lng: number;
    key: number;
  } | null>(null);
  const [customPin, setCustomPin] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [isPinMode, setIsPinMode] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [form, setForm] = useState({ title: "", radius: "500", isFav: false });
  const debounceTimer = useRef<any>(null);

  const toast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Audio Engine
  const playTone = (type: string) => {
    if (type === "custom" && customAudio) {
      new Audio(customAudio).play().catch(() => {});
      return;
    }
    try {
      if (!audioCtx)
        audioCtx = new (
          window.AudioContext || (window as any).webkitAudioContext
        )();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator(),
        gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      if (type === "radar") {
        osc.frequency.setValueAtTime(587, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
      } else if (type === "metro") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(523, now);
        osc.frequency.exponentialRampToValueAtTime(1046, now + 0.3);
      } else if (type === "fahhh") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.6);
      } else {
        osc.type = "square";
        osc.frequency.setValueAtTime(1046, now);
      }
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.38);
    } catch (e) {}
  };

  const startAlarm = (d: any) => {
    setRingingAlarm(d);
    playTone(sound);
    alarmInterval = setInterval(
      () => playTone(sound),
      sound === "fahhh" ? 850 : 650,
    );
  };
  const stopAlarm = () => {
    if (alarmInterval) clearInterval(alarmInterval);
    alarmInterval = null;
    setRingingAlarm(null);
  };

  const api = async (path: string, method = "GET", body?: any) => {
    const tok = token || localStorage.getItem("geowake_token");
    return fetch(`${API}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());
  };

  const loadData = (tok: string) => {
    api("/alarms", "GET").then((d) => setAlarms(d.alarms || []));
    api("/favorites", "GET").then((d) => setFavorites(d.favorites || []));
  };

  useEffect(() => {
    if (token) loadData(token);
  }, [token]);

  // Google OAuth Initialization
  useEffect(() => {
    if (token) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      if ((window as any).google) {
        (window as any).google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (res: any) => {
            const data = await api("/auth/google", "POST", {
              credential: res.credential,
            });
            if (data.token) {
              setToken(data.token);
              setUserId(data.user.id);
              localStorage.setItem("geowake_token", data.token);
              localStorage.setItem("geowake_uid", data.user.id);
              loadData(data.token);
              toast(`👋 Welcome, ${data.user.name}!`);
            }
          },
        });
        (window as any).google.accounts.id.renderButton(
          document.getElementById("google-btn"),
          { theme: "filled_black", size: "large", shape: "pill", width: 280 },
        );
      }
    };
    document.body.appendChild(script);
  }, [token]);

  // 📱 Explicit Mobile GPS Permission & Real-Time Tracking Engine
  const startMobileGPS = () => {
    if (!("geolocation" in navigator)) {
      setGpsError("GPS not supported by device");
      return;
    }

    setGpsError(null);

    // 1. Trigger native mobile permission prompt immediately
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setUserLocation({ lat, lng });
        if (socket && userId)
          socket.emit("location:update", {
            userId,
            latitude: lat,
            longitude: lng,
          });
      },
      (err) => {
        console.warn("GPS prompt error:", err);
        setGpsError("Tap to enable GPS permission");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );

    // 2. Start continuous streaming
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude: lat, longitude: lng } = p.coords;
        setUserLocation({ lat, lng });
        setGpsError(null);
        if (socket && userId)
          socket.emit("location:update", {
            userId,
            latitude: lat,
            longitude: lng,
          });
      },
      () => setGpsError("GPS offline"),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );

    return id;
  };

  useEffect(() => {
    if (!userId || !token) return;
    socket = io(SOCKET_URL);
    socket.on("alarm:trigger", (d: any) => {
      startAlarm(d);
      api("/alarms").then((r) => setAlarms(r.alarms || []));
    });

    const watchId = startMobileGPS();

    return () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
      socket.disconnect();
      stopAlarm();
    };
  }, [userId, token, sound]);

  // Handlers
  const handleSaveAlarm = async () => {
    if (!customPin) return;
    const lat = Number(customPin.lat),
      lng = Number(customPin.lng),
      radius = Number(form.radius) || 500,
      title = form.title.trim() || "Transit Stop";
    const res = await api("/alarms", "POST", {
      title,
      destinationName: title,
      latitude: lat,
      longitude: lng,
      radiusMeters: radius,
    });
    if (res.alarm) {
      if (form.isFav) {
        await api("/favorites", "POST", {
          label: title,
          addressName: title,
          latitude: lat,
          longitude: lng,
          radiusMeters: radius,
        });
        api("/favorites").then((r) => setFavorites(r.favorites || []));
      }
      api("/alarms").then((r) => setAlarms(r.alarms || []));
      setFocusLocation({ lat, lng, key: Date.now() });
      toast(`✅ Activated: "${title}" (${radius}m)`);
      setCustomPin(null);
      setIsPinMode(false);
    } else toast(`⚠️ ${res.error || "Failed"}`);
  };

  const handleAi = async () => {
    if (!aiPrompt.trim()) return;
    const res = await api("/ai/parse-alarm", "POST", {
      prompt: aiPrompt,
      userLat: userLocation?.lat,
      userLng: userLocation?.lng,
    });
    if (res.latitude) {
      await api("/alarms", "POST", {
        title: res.title,
        destinationName: res.title,
        latitude: res.latitude,
        longitude: res.longitude,
        radiusMeters: res.radiusMeters,
      });
      api("/alarms").then((r) => setAlarms(r.alarms || []));
      setFocusLocation({
        lat: res.latitude,
        lng: res.longitude,
        key: Date.now(),
      });
      toast(`✅ AI Activated: "${res.title}" (${res.radiusMeters}m)`);
      setModal(null);
      setAiPrompt("");
    } else toast(`❌ ${res.error || "Failed"}`);
  };

  const activateFav = async (f: any) => {
    const res = await api("/alarms", "POST", {
      title: f.label,
      destinationName: f.addressName,
      latitude: f.latitude,
      longitude: f.longitude,
      radiusMeters: f.radiusMeters,
    });
    if (res.alarm) {
      api("/alarms").then((r) => setAlarms(r.alarms || []));
      setFocusLocation({ lat: f.latitude, lng: f.longitude, key: Date.now() });
      toast(`🔔 Activated: "${f.label}"`);
      setModal(null);
    } else toast(`⚠️ ${res.error || "Already active"}`);
  };

  if (!token) {
    return (
      <View style={s.authBg}>
        <View style={s.authCard}>
          <GeoWakeLogo s={90} />
          <Text style={s.authSub}>Smart Transit Geofencing & Wake Alarm</Text>
          <View
            nativeID="google-btn"
            style={{
              minHeight: 44,
              width: "100%",
              alignItems: "center",
              marginTop: 10,
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[s.c, { backgroundColor: theme.primary }]}>
      <LeafletMap
        customPin={customPin}
        radius={Number(form.radius) || 500}
        userLocation={userLocation}
        alarms={alarms}
        mapStyle={mapStyle}
        accentColor={theme.accent}
        focusLocation={focusLocation}
        isPinMode={isPinMode}
        recenterTrigger={0}
        onLocationSelect={(lat, lng) =>
          setCustomPin({
            lat: parseFloat(lat.toFixed(4)),
            lng: parseFloat(lng.toFixed(4)),
          })
        }
      />

      {/* 🛸 Top Dock with Red Vector Exit Icon */}
      <View style={s.topDockWrapper}>
        <View
          style={[
            s.dock,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <GeoWakeLogo s={24} />
          </View>

          <View style={{ flex: 1 }}>
            <TextInput
              style={s.searchInp}
              value={search}
              onChangeText={(t) => {
                setSearch(t);
                if (t.length > 1) {
                  clearTimeout(debounceTimer.current);
                  debounceTimer.current = setTimeout(
                    async () =>
                      setSuggestions(
                        (
                          await fetch(
                            `https://photon.komoot.io/api/?q=${encodeURIComponent(t)}&limit=5`,
                          ).then((r) => r.json())
                        ).features || [],
                      ),
                    300,
                  );
                } else setSuggestions([]);
              }}
              placeholder="🔍 Search..."
              placeholderTextColor="#94a3b8"
            />
            {suggestions.length > 0 && (
              <View style={[s.drop, { backgroundColor: theme.card }]}>
                {suggestions.map((item, i) => (
                  <TouchableOpacity
                    key={i}
                    style={s.dropItem}
                    onPress={() => {
                      const [lng, lat] = item.geometry.coordinates;
                      setCustomPin({ lat, lng });
                      setForm({
                        ...form,
                        title: item.properties.name || "Target",
                      });
                      setSearch("");
                      setSuggestions([]);
                      setFocusLocation({ lat, lng, key: Date.now() });
                      setIsPinMode(true);
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 12 }}>
                      {item.properties.name || "Location"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[s.btnPill, { backgroundColor: theme.accent }]}
            onPress={() => setModal("ai")}
          >
            <Text style={s.btnPillTxt}>✨ AI</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.iconBtn, { borderColor: theme.border }]}
            onPress={() => setModal("favs")}
          >
            <Text style={{ fontSize: 13 }}>⭐</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.iconBtn, { borderColor: theme.border }]}
            onPress={() => setModal("settings")}
          >
            <Text style={{ fontSize: 13 }}>⚙️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.iconBtn, { borderColor: theme.border }]}
            onPress={() => setModal("alarms")}
          >
            <Text
              style={{ color: theme.accent, fontWeight: "bold", fontSize: 11 }}
            >
              🔔 {alarms.length}
            </Text>
          </TouchableOpacity>

          {/* 🚪 Original Red Vector Logout Icon */}
          <TouchableOpacity
            style={[s.iconBtn, { borderColor: theme.border }]}
            onPress={() => {
              localStorage.clear();
              setToken(null);
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </TouchableOpacity>
        </View>
      </View>

      {/* Favorites Bar */}
      {favorites.length > 0 && (
        <View style={s.favBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6 }}
          >
            {favorites.map((f) => (
              <TouchableOpacity
                key={f.id}
                style={[
                  s.chip,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
                onPress={() => activateFav(f)}
              >
                <Text
                  style={{
                    color: theme.accent,
                    fontSize: 11,
                    fontWeight: "bold",
                  }}
                >
                  ⭐ {f.label}{" "}
                  {userLocation
                    ? `• ${getDistanceFormatted(userLocation.lat, userLocation.lng, f.latitude, f.longitude)}`
                    : ""}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      {successMsg && (
        <View style={[s.toast, { borderColor: theme.accent }]}>
          <Text style={{ color: "#ecfdf5", fontWeight: "bold", fontSize: 12 }}>
            {successMsg}
          </Text>
        </View>
      )}

      {/* Mobile GPS Status Pill (Tap to prompt permission if disabled) */}
      <TouchableOpacity
        style={[
          s.statusPill,
          {
            backgroundColor: theme.card,
            borderColor: gpsError ? "#ef4444" : theme.border,
          },
        ]}
        onPress={startMobileGPS}
      >
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: gpsError ? "#ef4444" : "#10b981",
          }}
        />
        <Text
          style={{
            color: "#fff",
            fontSize: 10,
            fontWeight: "bold",
            marginLeft: 6,
          }}
        >
          {gpsError ? gpsError : `GPS Live • `}
          <Text style={{ color: theme.accent }}>{alarms.length} Alarms</Text>
        </Text>
      </TouchableOpacity>

      {userLocation && (
        <TouchableOpacity
          style={[
            s.recenter,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
          onPress={() =>
            setFocusLocation({
              lat: userLocation.lat,
              lng: userLocation.lng,
              key: Date.now(),
            })
          }
        >
          <Text style={{ color: theme.accent, fontSize: 18 }}>⌖</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[
          s.fab,
          { backgroundColor: isPinMode ? "#ef4444" : theme.accent },
        ]}
        onPress={() => {
          setIsPinMode(!isPinMode);
          if (isPinMode) setCustomPin(null);
        }}
      >
        <Text style={{ color: "#020617", fontWeight: "900", fontSize: 12 }}>
          {isPinMode ? "✕ Cancel" : "+ Drop Pin"}
        </Text>
      </TouchableOpacity>

      {/* Pin Card */}
      {customPin && (
        <View
          style={[
            s.cardPin,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <Text style={s.modalH1}>📍 Set Alarm Guard</Text>
          <TextInput
            style={s.inp}
            value={form.title}
            onChangeText={(t) => setForm({ ...form, title: t })}
            placeholder="Alarm Name"
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={s.inp}
            value={form.radius}
            onChangeText={(t) => setForm({ ...form, radius: t })}
            placeholder="Radius (Meters)"
            placeholderTextColor="#64748b"
            keyboardType="numeric"
          />
          <TouchableOpacity
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 10,
            }}
            onPress={() => setForm({ ...form, isFav: !form.isFav })}
          >
            <Text>{form.isFav ? "☑️" : "◻️"}</Text>
            <Text style={{ color: "#94a3b8", fontSize: 12, marginLeft: 6 }}>
              Save to ⭐ Favorites
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.btnAction, { backgroundColor: theme.accent }]}
            onPress={handleSaveAlarm}
          >
            <Text style={s.btnActionTxt}>Activate Alarm Guard 🔔</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 🚨 Fullscreen Wake Up Modal */}
      <Modal visible={!!ringingAlarm} transparent animationType="fade">
        <View style={s.overlayAlert}>
          <View style={s.cardAlert}>
            <Text style={{ fontSize: 44 }}>🚨</Text>
            <Text style={{ color: "#ef4444", fontWeight: "900", fontSize: 26 }}>
              WAKE UP!
            </Text>
            <Text
              style={{
                color: "#fff",
                fontWeight: "bold",
                fontSize: 15,
                marginVertical: 6,
              }}
            >
              Arrived at "{ringingAlarm?.title}"
            </Text>
            <TouchableOpacity style={s.btnStop} onPress={stopAlarm}>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 15 }}>
                🔕 STOP ALARM
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modals Container */}
      <Modal visible={!!modal} transparent animationType="fade">
        <View style={s.modalBg}>
          <View
            style={[
              s.modalCard,
              { backgroundColor: theme.card, borderColor: theme.accent },
            ]}
          >
            {modal === "ai" && (
              <>
                <Text style={[s.modalH1, { color: theme.accent }]}>
                  ✨ AI Assistant
                </Text>
                <TextInput
                  style={[s.inp, { minHeight: 60 }]}
                  value={aiPrompt}
                  onChangeText={setAiPrompt}
                  placeholder="e.g. Wake me up 1km before Airport"
                  placeholderTextColor="#64748b"
                  multiline
                />
                <TouchableOpacity
                  style={[s.btnAction, { backgroundColor: theme.accent }]}
                  onPress={handleAi}
                >
                  <Text style={s.btnActionTxt}>⚡ Activate with AI</Text>
                </TouchableOpacity>
              </>
            )}

            {modal === "favs" && (
              <>
                <Text style={[s.modalH1, { color: theme.accent }]}>
                  ⭐ Favorites ({favorites.length})
                </Text>
                <ScrollView style={{ maxHeight: 200 }}>
                  {favorites.map((f) => (
                    <View key={f.id} style={s.row}>
                      <TouchableOpacity
                        style={{ flex: 1 }}
                        onPress={() => activateFav(f)}
                      >
                        <Text style={{ color: "#fff", fontWeight: "bold" }}>
                          ⭐ {f.label}
                        </Text>
                        <Text style={{ color: theme.accent, fontSize: 10 }}>
                          {f.addressName} ({f.radiusMeters}m)
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() =>
                          api(`/favorites/${f.id}`, "DELETE").then(() =>
                            api("/favorites").then((r) =>
                              setFavorites(r.favorites || []),
                            ),
                          )
                        }
                      >
                        <Text style={{ color: "#ef4444" }}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              </>
            )}

            {modal === "alarms" && (
              <>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <Text style={[s.modalH1, { color: "#fff" }]}>
                    Active Alarms ({alarms.length})
                  </Text>
                  {alarms.length > 0 && (
                    <TouchableOpacity
                      onPress={() =>
                        api("/alarms/clear-all", "DELETE").then(() => {
                          api("/alarms").then((r) => setAlarms(r.alarms || []));
                          toast("🗑️ Cleared!");
                        })
                      }
                    >
                      <Text
                        style={{
                          color: "#ef4444",
                          fontSize: 11,
                          fontWeight: "bold",
                        }}
                      >
                        🗑️ Clear All
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                <ScrollView style={{ maxHeight: 200 }}>
                  {alarms.map((a) => (
                    <View key={a.id} style={s.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: "#fff", fontWeight: "bold" }}>
                          {a.title}
                        </Text>
                        <Text style={{ color: theme.accent, fontSize: 10 }}>
                          📍{" "}
                          {userLocation
                            ? getDistanceFormatted(
                                userLocation.lat,
                                userLocation.lng,
                                a.latitude,
                                a.longitude,
                              )
                            : ""}{" "}
                          • Radius: {a.radiusMeters}m
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() =>
                          api(`/alarms/${a.id}`, "DELETE").then(() =>
                            api("/alarms").then((r) =>
                              setAlarms(r.alarms || []),
                            ),
                          )
                        }
                      >
                        <Text style={{ color: "#ef4444" }}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              </>
            )}

            {modal === "settings" && (
              <>
                <Text style={[s.modalH1, { color: theme.accent }]}>
                  ⚙️ App Settings
                </Text>
                <Text style={s.subH}>🔊 Ringtones:</Text>
                {SOUNDS.map((snd) => (
                  <View
                    key={snd.id}
                    style={[
                      s.row,
                      sound === snd.id && { borderColor: theme.accent },
                    ]}
                  >
                    <TouchableOpacity
                      style={{ flex: 1 }}
                      onPress={() => {
                        if (snd.id === "custom") {
                          const inp = document.createElement("input");
                          inp.type = "file";
                          inp.accept = "audio/*";
                          inp.onchange = (e: any) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const r = new FileReader();
                            r.onload = (ev) => {
                              const b = ev.target?.result as string;
                              setCustomAudio(b);
                              localStorage.setItem("geowake_custom_audio", b);
                              setSound("custom");
                              localStorage.setItem("geowake_sound", "custom");
                              toast(`📁 Saved "${f.name}"!`);
                            };
                            r.readAsDataURL(f);
                          };
                          inp.click();
                        } else {
                          setSound(snd.id);
                          localStorage.setItem("geowake_sound", snd.id);
                        }
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontWeight: "bold",
                          fontSize: 12,
                        }}
                      >
                        {snd.name}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => playTone(snd.id)}>
                      <Text
                        style={{
                          color: theme.accent,
                          fontSize: 11,
                          fontWeight: "bold",
                        }}
                      >
                        ▶️ Test
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <Text style={s.subH}>🎨 Themes:</Text>
                <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
                  {THEMES.map((t) => (
                    <TouchableOpacity
                      key={t.id}
                      style={[
                        s.themeChip,
                        theme.id === t.id && { borderColor: t.accent },
                      ]}
                      onPress={() => {
                        setTheme(t);
                        localStorage.setItem("geowake_theme_id", t.id);
                      }}
                    >
                      <View
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 7,
                          backgroundColor: t.accent,
                        }}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.subH}>🗺️ Map Tiles:</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {["dark", "light", "satellite"].map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[
                        s.mapBtn,
                        mapStyle === m && { backgroundColor: theme.accent },
                      ]}
                      onPress={() => {
                        setMapStyle(m as any);
                        localStorage.setItem("geowake_map_style", m);
                      }}
                    >
                      <Text
                        style={{
                          color: mapStyle === m ? "#020617" : "#fff",
                          fontSize: 11,
                          fontWeight: "bold",
                        }}
                      >
                        {m.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <TouchableOpacity
              style={[
                s.btnAction,
                { backgroundColor: theme.accent, marginTop: 12 },
              ]}
              onPress={() => setModal(null)}
            >
              <Text style={s.btnActionTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s: any = StyleSheet.create({
  c: { flex: 1 },
  authBg: {
    flex: 1,
    backgroundColor: "#030712",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  authCard: {
    backgroundColor: "rgba(15, 23, 42, 0.9)",
    padding: 28,
    borderRadius: 24,
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  authSub: {
    color: "#94a3b8",
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
    marginBottom: 20,
  },
  topDockWrapper: {
    position: "absolute",
    top: 12,
    left: 10,
    right: 10,
    alignItems: "center",
    zIndex: 1000,
  },
  dock: {
    flexDirection: "row",
    alignItems: "center",
    padding: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    width: "100%",
    maxWidth: 600,
    gap: 6,
  },
  searchInp: {
    backgroundColor: "rgba(0,0,0,0.3)",
    color: "#fff",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    fontSize: 12,
  },
  drop: {
    position: "absolute",
    top: 40,
    left: 0,
    right: 0,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 2000,
  },
  dropItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  btnPill: { padding: 6, paddingHorizontal: 10, borderRadius: 12 },
  btnPillTxt: { color: "#020617", fontWeight: "900", fontSize: 11 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  favBar: { position: "absolute", top: 62, left: 10, right: 10, zIndex: 1000 },
  chip: { padding: 5, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1 },
  toast: {
    position: "absolute",
    top: 96,
    alignSelf: "center",
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    padding: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    zIndex: 2500,
  },
  statusPill: {
    position: "absolute",
    bottom: 16,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    padding: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    zIndex: 1000,
  },
  recenter: {
    position: "absolute",
    bottom: 62,
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
    borderWidth: 1,
  },
  fab: {
    position: "absolute",
    bottom: 16,
    right: 14,
    padding: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    zIndex: 1000,
  },
  cardPin: {
    position: "absolute",
    bottom: 68,
    right: 12,
    width: "92%",
    maxWidth: 320,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    zIndex: 1100,
  },
  inp: {
    backgroundColor: "rgba(0,0,0,0.3)",
    color: "#fff",
    padding: 10,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    fontSize: 12,
  },
  btnAction: { padding: 11, borderRadius: 12, alignItems: "center" },
  btnActionTxt: { color: "#020617", fontWeight: "900", fontSize: 12 },
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    padding: 20,
    borderRadius: 22,
    width: "90%",
    maxWidth: 350,
    borderWidth: 1.5,
    maxHeight: "85%",
  },
  modalH1: {
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 10,
  },
  subH: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "bold",
    marginVertical: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    padding: 8,
    borderRadius: 8,
    marginTop: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  themeChip: {
    padding: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.1)",
  },
  mapBtn: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    padding: 8,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  overlayAlert: {
    flex: 1,
    backgroundColor: "rgba(239, 68, 68, 0.25)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  cardAlert: {
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    padding: 28,
    borderRadius: 24,
    width: "90%",
    maxWidth: 340,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#ef4444",
  },
  btnStop: {
    backgroundColor: "#ef4444",
    padding: 14,
    paddingHorizontal: 26,
    borderRadius: 25,
    width: "100%",
    alignItems: "center",
  },
});
