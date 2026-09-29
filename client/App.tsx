import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import UnsupportedPlatformNotice from "./components/UnsupportedPlatformNotice";
import {
  API_BASE,
  DEFAULT_RADIUS_METERS,
  IS_WEB_ONLY_BUILD,
  MAX_CUSTOM_AUDIO_BYTES,
  MAX_RADIUS_METERS,
  MIN_RADIUS_METERS,
  isValidCoordinate,
  isValidRadius,
} from "./config";
import {
  AlarmEngine,
  resolveSoundId,
  SOUND_PRESETS,
  type SoundGroup,
  type SoundId,
} from "./lib/alarmAudio";
import { ApiError, apiFetch } from "./lib/api";
import { renderGoogleButton } from "./lib/googleAuth";
import {
  STORAGE_KEYS,
  readSetting,
  removeSettings,
  writeSetting,
} from "./lib/storage";
import { useWakeEngine, type TriggeredAlarm } from "./hooks/useWakeEngine";
import {
  GLASS_BORDER,
  GLASS_SURFACE,
  INK,
  INPUT_SURFACE,
  interactive,
  MIN_TAP,
  noFocusRing,
  RADIUS,
  SPACE,
  TYPE,
} from "./theme";

/**
 * Leaflet touches `window` at import time, so it is only required on web.
 * Keeping the require conditional stops a native bundle from crashing on load.
 */
const LeafletMap: any = IS_WEB_ONLY_BUILD
  ? require("./components/LeafletMap").default
  : null;

const PHOTON_SEARCH_URL = "https://photon.komoot.io/api/";
const SUGGESTION_LIMIT = 5;
const SEARCH_DEBOUNCE_MS = 300;
const TOAST_MS = 4000;

/**
 * GPS is sampled at most this often for rendering, and a fix that moves less
 * than a metre is ignored. Together these stop high-accuracy updates from
 * re-rendering the app tens of times per second.
 */
const LOCATION_RENDER_INTERVAL_MS = 1000;
const LOCATION_RENDER_MIN_MOVE_M = 1;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres, used to damp sub-metre GPS jitter. */
const haversineMetres = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
};

const SOUND_GROUP_ORDER: SoundGroup[] = ["iOS style", "Android style", "Gentle"];

const SOUND_GROUP_ICON: Record<SoundGroup, string> = {
  "iOS style": "",
  "Android style": "🤖",
  Gentle: "",
};

const SOUND_GROUP_HINT: Record<SoundGroup, string> = {
  "iOS style": "Melodic chimes, like the iPhone Clock",
  "Android style": "Beeps, rings and sirens, like Android",
  Gentle: "Softer patterns for light sleepers",
};

const THEMES = [
  {
    id: "cyan",
    name: "Cyber Cyan",
    primary: "#030712",
    card: "#0f172a",
    border: "rgba(6, 182, 212, 0.3)",
    accent: "#06b6d4",
  },
  {
    id: "emerald",
    name: "Matrix Emerald",
    primary: "#021209",
    card: "#062817",
    border: "rgba(16, 185, 129, 0.3)",
    accent: "#10b981",
  },
  {
    id: "purple",
    name: "Neon Synthwave",
    primary: "#090414",
    card: "#180a30",
    border: "rgba(192, 132, 252, 0.3)",
    accent: "#c084fc",
  },
  {
    id: "amber",
    name: "Amber Sunset",
    primary: "#140c04",
    card: "#291807",
    border: "rgba(245, 158, 11, 0.3)",
    accent: "#f59e0b",
  },
  {
    id: "crimson",
    name: "Crimson Rogue",
    primary: "#140507",
    card: "#2b0a10",
    border: "rgba(244, 63, 94, 0.3)",
    accent: "#f43f5e",
  },
];

type MapStyle = "dark" | "light" | "satellite";
type ModalName = "alarms" | "favs" | "settings" | "ai" | null;
type FocusLocation = { lat: number; lng: number; key: number } | null;
type LatLng = { lat: number; lng: number };

interface Alarm {
  id: string;
  title: string;
  destinationName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  status: string;
}

interface Favorite {
  id: string;
  label: string;
  addressName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

const getDistanceFormatted = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// 📍 GEOWAKE Vector Logo
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
    <line x1="60" y1="24" x2="60" y2="31" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
    <line x1="60" y1="73" x2="60" y2="80" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
    <line x1="32" y1="52" x2="39" y2="52" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
    <line x1="81" y1="52" x2="88" y2="52" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
    <line x1="60" y1="52" x2="60" y2="33" stroke="#0f172a" strokeWidth="4.5" strokeLinecap="round" />
    <line x1="60" y1="52" x2="79" y2="52" stroke="#0f172a" strokeWidth="4.5" strokeLinecap="round" />
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
  const [token, setToken] = useState<string | null>(() => readSetting(STORAGE_KEYS.token, null));
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [ringingAlarm, setRingingAlarm] = useState<TriggeredAlarm | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Settings
  const [theme, setTheme] = useState(
    () => THEMES.find((t) => t.id === readSetting(STORAGE_KEYS.themeId, null)) ?? THEMES[0],
  );
  const [mapStyle, setMapStyle] = useState<MapStyle>(() => {
    const stored = readSetting(STORAGE_KEYS.mapStyle, "dark");
    return stored === "light" || stored === "satellite" || stored === "dark" ? stored : "dark";
  });
  const [sound, setSound] = useState<SoundId>(() =>
    resolveSoundId(readSetting(STORAGE_KEYS.sound, "radar")),
  );
  const [vibration, setVibration] = useState<boolean>(
    () => readSetting(STORAGE_KEYS.vibration, "on") !== "off",
  );
  const [customAudio, setCustomAudio] = useState<string | null>(() =>
    readSetting(STORAGE_KEYS.customAudio, null),
  );

  // Modals & map state
  const [modal, setModal] = useState<ModalName>(null);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [focusLocation, setFocusLocation] = useState<FocusLocation>(null);
  const [customPin, setCustomPin] = useState<LatLng | null>(null);
  const [isPinMode, setIsPinMode] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [form, setForm] = useState({ title: "", radius: String(DEFAULT_RADIUS_METERS), isFav: false });

  const googleButtonRef = useRef<any>(null);
  const engineRef = useRef<AlarmEngine | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const tokenRef = useRef<string | null>(token);

  /**
   * GPS fixes arrive several times a second, and `enableHighAccuracy` can push
   * that to 10/s. Committing every one to React re-renders the whole app and
   * makes Leaflet redraw, which is what makes the map feel laggy.
   *
   * `pendingLocationRef` always holds the newest fix; it is flushed to state on
   * a timer, so the marker still tracks the user smoothly at a bounded rate
   * instead of as fast as the radio can report.
   */
  const pendingLocationRef = useRef<LatLng | null>(null);
  const locationFlushRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRenderedLocationRef = useRef<LatLng | null>(null);

  const commitLocation = useCallback((next: LatLng) => {
    // Skip sub-metre jitter: it costs a render but changes nothing on screen.
    const previous = lastRenderedLocationRef.current;
    if (previous) {
      const metres = haversineMetres(previous.lat, previous.lng, next.lat, next.lng);
      if (metres < LOCATION_RENDER_MIN_MOVE_M) return;
    }
    lastRenderedLocationRef.current = next;
    setUserLocation(next);
  }, []);

  const handleLocation = useCallback(
    (position: LatLng) => {
      pendingLocationRef.current = position;
    },
    [],
  );

  useEffect(() => {
    locationFlushRef.current = setInterval(() => {
      const pending = pendingLocationRef.current;
      if (!pending) return;
      pendingLocationRef.current = null;
      commitLocation(pending);
    }, LOCATION_RENDER_INTERVAL_MS);

    return () => {
      if (locationFlushRef.current) clearInterval(locationFlushRef.current);
      locationFlushRef.current = null;
    };
  }, [commitLocation]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    const engine = new AlarmEngine();
    engine.setCustomSource(customAudio);
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // The engine is intentionally created once; its custom source is synced
    // separately so uploading a ringtone does not rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setCustomSource(customAudio);
  }, [customAudio]);

  useEffect(() => {
    engineRef.current?.setVibrationEnabled(vibration);
  }, [vibration]);

  const toast = useCallback((message: string) => {
    setSuccessMsg(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setSuccessMsg(null), TOAST_MS);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      searchAbortRef.current?.abort();
    },
    [],
  );

  const activeAlarms = useMemo(
    () => alarms.filter((alarm) => alarm.status === "ACTIVE"),
    [alarms],
  );

  /**
   * Leaflet is imperative and expensive to re-render, so its props are kept
   * referentially stable. Without this, every unrelated state change (typing in
   * the search box, opening a modal) rebuilt the props object and made the map
   * component re-run its effects.
   */
  const mapRadius = useMemo(
    () => Number(form.radius) || DEFAULT_RADIUS_METERS,
    [form.radius],
  );
  const handleMapLocationSelect = useCallback((lat: number, lng: number) => {
    setCustomPin({ lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) });
  }, []);

  // 🚀 Warm up the (possibly sleeping) cloud server on first paint.
  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then(() => undefined)
      .catch(() => undefined);
  }, []);

  // 🔓 Browsers only allow audio after a user gesture.
  useEffect(() => {
    if (!IS_WEB_ONLY_BUILD) return;
    const unlock = () => engineRef.current?.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const handleSignOut = useCallback(() => {
    engineRef.current?.stop();
    setRingingAlarm(null);
    setAlarms([]);
    setFavorites([]);
    setUserLocation(null);
    setGpsError(null);
    setModal(null);
    removeSettings([STORAGE_KEYS.token, STORAGE_KEYS.userId, STORAGE_KEYS.customAudio]);
    tokenRef.current = null;
    setToken(null);
  }, []);

  const refreshAlarms = useCallback(async () => {
    try {
      const data = await apiFetch<{ alarms?: Alarm[] }>("/alarms", {
        token: tokenRef.current,
      });
      setAlarms(data.alarms ?? []);
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        handleSignOut();
        return;
      }
      toast("⚠️ Could not refresh alarms.");
    }
  }, [handleSignOut, toast]);

  const refreshFavorites = useCallback(async () => {
    try {
      const data = await apiFetch<{ favorites?: Favorite[] }>("/favorites", {
        token: tokenRef.current,
      });
      setFavorites(data.favorites ?? []);
    } catch {
      toast("⚠️ Could not refresh favorites.");
    }
  }, [toast]);

  useEffect(() => {
    if (!token) return;
    void refreshAlarms();
    void refreshFavorites();
  }, [token, refreshAlarms, refreshFavorites]);

  // 🧭 Google sign-in
  useEffect(() => {
    if (token || !IS_WEB_ONLY_BUILD) return;
    let cancelled = false;

    const mount = () => {
      if (cancelled) return;
      void renderGoogleButton(
        googleButtonRef.current,
        (credential) => void handleGoogleCredential(credential),
        (message) => setLoginError(message),
      );
    };

    // The host view may not be committed on the very first effect pass.
    if (googleButtonRef.current) mount();
    else requestAnimationFrame(mount);

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleGoogleCredential = async (credential: string) => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const data = await apiFetch<{
        token: string;
        user: { id: string; name: string; email: string };
      }>("/auth/google", { method: "POST", body: { credential } });

      if (!data?.token) {
        setLoginError("Sign-in did not return a session token.");
        return;
      }
      writeSetting(STORAGE_KEYS.token, data.token);
      writeSetting(STORAGE_KEYS.userId, data.user.id);
      tokenRef.current = data.token;
      setToken(data.token);
      toast(`👋 Welcome, ${data.user.name}!`);
    } catch (error) {
      setLoginError(
        error instanceof ApiError ? error.message : "Sign-in failed. Please try again.",
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleTrigger = useCallback((alarm: TriggeredAlarm) => {
    setRingingAlarm(alarm);
    // Re-read the state so the ringtone is always the current selection.
    void refreshAlarms();
  }, [refreshAlarms]);

  const { refreshLocation } = useWakeEngine({
    token,
    onTrigger: handleTrigger,
    onLocation: handleLocation,
    onGpsError: (message) => setGpsError(message || null),
    onLocationError: (message) => setGpsError(message || null),
  });

  // 🔔 Drive the siren: exactly one interval, restarted only when the ringtone
  // changes or a new alarm fires.
  useEffect(() => {
    if (!ringingAlarm) {
      engineRef.current?.stop();
      return;
    }
    engineRef.current?.start(sound);
  }, [ringingAlarm, sound]);

  const stopAlarm = useCallback(() => {
    const active = ringingAlarm;
    engineRef.current?.stop();
    setRingingAlarm(null);
    if (!active) return;

    // Mark the terminal state server-side; the alarm is already TRIGGERED.
    void apiFetch(`/alarms/${active.alarmId}/status`, {
      method: "PATCH",
      body: { status: "DISMISSED" },
      token: tokenRef.current,
    })
      .then(() => refreshAlarms())
      .catch(() => undefined);
  }, [ringingAlarm, refreshAlarms]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSaveAlarm = async () => {
    if (!customPin) return;

    const lat = customPin.lat;
    const lng = customPin.lng;
    if (!isValidCoordinate(lat, lng)) {
      toast("⚠️ That is not a valid location.");
      return;
    }

    const radius = Number(form.radius);
    if (!isValidRadius(radius)) {
      toast(`⚠️ Radius must be ${MIN_RADIUS_METERS}–${MAX_RADIUS_METERS} m.`);
      return;
    }

    const title = form.title.trim() || "Transit Stop";

    try {
      const res = await apiFetch<{ alarm?: Alarm; error?: string }>("/alarms", {
        method: "POST",
        token: tokenRef.current,
        body: {
          title,
          destinationName: title,
          latitude: lat,
          longitude: lng,
          radiusMeters: radius,
        },
      });

      if (!res.alarm) {
        toast(`⚠️ ${res.error ?? "Failed to save alarm."}`);
        return;
      }

      if (form.isFav) {
        try {
          await apiFetch("/favorites", {
            method: "POST",
            token: tokenRef.current,
            body: {
              label: title,
              addressName: title,
              latitude: lat,
              longitude: lng,
              radiusMeters: radius,
            },
          });
          void refreshFavorites();
        } catch (error) {
          toast(
            `⚠️ Alarm set, but favorite failed: ${
              error instanceof ApiError ? error.message : "unknown error"
            }`,
          );
        }
      }

      void refreshAlarms();
      setFocusLocation({ lat, lng, key: Date.now() });
      toast(`✅ Activated: "${title}" (${radius}m)`);
      setCustomPin(null);
      setIsPinMode(false);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Could not reach the server.";
      toast(`⚠️ ${message}`);
    }
  };

  const handleAi = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return;

    try {
      const res = await apiFetch<{
        title: string;
        latitude: number;
        longitude: number;
        radiusMeters: number;
      }>("/ai/parse-alarm", {
        method: "POST",
        token: tokenRef.current,
        body: {
          prompt,
          ...(userLocation
            ? { userLat: userLocation.lat, userLng: userLocation.lng }
            : {}),
        },
      });

      // Guard against falsy-zero: 0° latitude/longitude are valid coordinates.
      if (!isValidCoordinate(res.latitude, res.longitude)) {
        toast("❌ The AI could not resolve that destination.");
        return;
      }
      if (!isValidRadius(res.radiusMeters)) {
        toast("❌ The AI returned an unusable radius.");
        return;
      }

      await apiFetch("/alarms", {
        method: "POST",
        token: tokenRef.current,
        body: {
          title: res.title,
          destinationName: res.title,
          latitude: res.latitude,
          longitude: res.longitude,
          radiusMeters: res.radiusMeters,
        },
      });

      void refreshAlarms();
      setFocusLocation({ lat: res.latitude, lng: res.longitude, key: Date.now() });
      toast(`✅ AI Activated: "${res.title}" (${res.radiusMeters}m)`);
      setModal(null);
      setAiPrompt("");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "AI request failed.";
      toast(`❌ ${message}`);
    }
  };

  const activateFavorite = async (favorite: Favorite) => {
    try {
      const res = await apiFetch<{ alarm?: Alarm; error?: string }>("/alarms", {
        method: "POST",
        token: tokenRef.current,
        body: {
          title: favorite.label,
          destinationName: favorite.addressName,
          latitude: favorite.latitude,
          longitude: favorite.longitude,
          radiusMeters: favorite.radiusMeters,
        },
      });
      if (!res.alarm) {
        toast(`⚠️ ${res.error ?? "Could not activate this favorite."}`);
        return;
      }
      void refreshAlarms();
      setFocusLocation({
        lat: favorite.latitude,
        lng: favorite.longitude,
        key: Date.now(),
      });
      toast(`🔔 Activated: "${favorite.label}"`);
      setModal(null);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Request failed.";
      toast(`⚠️ ${message}`);
    }
  };

  const deleteAlarmById = async (id: string) => {
    try {
      await apiFetch(`/alarms/${id}`, { method: "DELETE", token: tokenRef.current });
      void refreshAlarms();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Could not delete alarm.";
      toast(`⚠️ ${message}`);
    }
  };

  const clearAllAlarms = async () => {
    try {
      await apiFetch("/alarms/clear-all", { method: "DELETE", token: tokenRef.current });
      void refreshAlarms();
      toast("🗑️ Cleared!");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Could not clear alarms.";
      toast(`⚠️ ${message}`);
    }
  };

  const deleteFavoriteById = async (id: string) => {
    try {
      await apiFetch(`/favorites/${id}`, { method: "DELETE", token: tokenRef.current });
      void refreshFavorites();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Could not delete favorite.";
      toast(`⚠️ ${message}`);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    searchAbortRef.current?.abort();

    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      fetch(`${PHOTON_SEARCH_URL}?q=${encodeURIComponent(value.trim())}&limit=${SUGGESTION_LIMIT}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : { features: [] }))
        .then((payload: any) => setSuggestions(payload?.features ?? []))
        .catch(() => {
          /* aborted or offline: keep the previous list */
        });
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleCustomAudioUpload = (file: File) => {
    if (file.size > MAX_CUSTOM_AUDIO_BYTES) {
      toast(
        `⚠️ Ringtone too large (max ${Math.round(MAX_CUSTOM_AUDIO_BYTES / 1024 / 1024)} MB).`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (!writeSetting(STORAGE_KEYS.customAudio, dataUrl)) {
        toast("⚠️ Could not store that ringtone (browser storage is full).");
        return;
      }
      setCustomAudio(dataUrl);
      setSound("custom");
      writeSetting(STORAGE_KEYS.sound, "custom");
      toast(`📁 Saved "${file.name}"!`);
    };
    reader.onerror = () => toast("⚠️ Could not read that file.");
    reader.readAsDataURL(file);
  };

  const pickCustomAudio = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) handleCustomAudioUpload(file);
    };
    input.click();
  };

  // ── Render ──────────────────────────────────────────────────────────────
  if (!IS_WEB_ONLY_BUILD) {
    return <UnsupportedPlatformNotice />;
  }

  if (!token) {
    return (
      <View style={s.authBg}>
        <View style={s.authCard}>
          <GeoWakeLogo s={90} />
          <Text style={s.authSub}>Smart Transit Geofencing & Wake Alarm</Text>

          {isLoggingIn ? (
            <View style={{ marginVertical: SPACE.lg, alignItems: "center" }}>
              <ActivityIndicator size="large" color={theme.accent} />
              <Text style={s.authNote}>Authenticating with cloud server…</Text>
            </View>
          ) : (
            <>
              <View
                ref={googleButtonRef}
                nativeID="google-btn"
                style={{ minHeight: 44, width: "100%", alignItems: "center", marginTop: 10 }}
              />
              {loginError ? <Text style={s.errorNote}>{loginError}</Text> : null}
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[s.c, { backgroundColor: theme.primary }]}>
      {LeafletMap ? (
        <LeafletMap
          customPin={customPin}
          radius={mapRadius}
          userLocation={userLocation}
          alarms={activeAlarms}
          mapStyle={mapStyle}
          accentColor={theme.accent}
          focusLocation={focusLocation}
          isPinMode={isPinMode}
          onLocationSelect={handleMapLocationSelect}
        />
      ) : null}

      {/* Top Dock */}
      <View style={s.topDockWrapper}>
        <View style={[s.dock, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <GeoWakeLogo s={24} />
          </View>

          <View style={{ flex: 1 }}>
            <TextInput
              style={s.searchInp}
              value={search}
              onChangeText={handleSearchChange}
              placeholder="🔍 Search for a place…"
              placeholderTextColor={INK.muted}
              accessibilityLabel="Search for a place"
            />
            {suggestions.length > 0 && (
              <View style={[s.drop, { backgroundColor: theme.card }]}>
                {suggestions.map((item, index) => {
                  const [lng, lat] = item?.geometry?.coordinates ?? [];
                  if (!isValidCoordinate(lat, lng)) return null;
                  return (
                    <TouchableOpacity
                      key={`${lat},${lng},${index}`}
                      style={s.dropItem}
                      onPress={() => {
                        setCustomPin({ lat, lng });
                        setForm({
                          ...form,
                          title: item?.properties?.name || "Target",
                        });
                        setSearch("");
                        setSuggestions([]);
                        setFocusLocation({ lat, lng, key: Date.now() });
                        setIsPinMode(true);
                      }}
                    >
                      <Text style={s.dropItemText}>
                        {item?.properties?.name || "Location"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
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
            <Text style={{ color: theme.accent, fontWeight: "bold", fontSize: 11 }}>
              🔔 {activeAlarms.length}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.iconBtn, { borderColor: theme.border }]}
            onPress={handleSignOut}
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
            {favorites.map((favorite) => (
              <TouchableOpacity
                key={favorite.id}
                style={[s.chip, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => void activateFavorite(favorite)}
                accessibilityRole="button"
                accessibilityLabel={`Set alarm at ${favorite.label}`}
              >
                <Text style={[s.chipText, { color: theme.accent }]}>
                  ⭐ {favorite.label}
                  {userLocation
                    ? ` • ${getDistanceFormatted(
                        userLocation.lat,
                        userLocation.lng,
                        favorite.latitude,
                        favorite.longitude,
                      )}`
                    : ""}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {successMsg && (
        <View style={[s.toast, { borderColor: theme.accent }]}>
          <Text style={s.toastText}>{successMsg}</Text>
        </View>
      )}

      {/* Status Pill */}
      <TouchableOpacity
        style={[
          s.statusPill,
          { backgroundColor: theme.card, borderColor: gpsError ? INK.danger : theme.border },
        ]}
        onPress={refreshLocation}
        accessibilityRole="button"
        accessibilityLabel="GPS status. Tap to refresh your location."
      >
        <View
          style={[
            s.statusDot,
            { backgroundColor: gpsError ? INK.danger : INK.success },
          ]}
        />
        <Text style={s.statusText}>
          {gpsError ? `${gpsError} ` : "GPS Live • "}
          <Text style={{ color: theme.accent }}>{activeAlarms.length} Alarms</Text>
        </Text>
      </TouchableOpacity>

      {userLocation && (
        <TouchableOpacity
          style={[s.recenter, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() =>
            setFocusLocation({ lat: userLocation.lat, lng: userLocation.lng, key: Date.now() })
          }
          accessibilityRole="button"
          accessibilityLabel="Recentre map on your location"
        >
          <Text style={[s.recenterText, { color: theme.accent }]}>⌖</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[s.fab, { backgroundColor: isPinMode ? INK.danger : theme.accent }]}
        onPress={() => {
          setIsPinMode(!isPinMode);
          if (isPinMode) setCustomPin(null);
        }}
        accessibilityRole="button"
        accessibilityLabel={isPinMode ? "Cancel pin placement" : "Drop a pin to set an alarm"}
      >
        <Text style={s.fabText}>{isPinMode ? "✕ Cancel" : "+ Drop Pin"}</Text>
      </TouchableOpacity>

      {/* Pin Card */}
      {customPin && (
        <View style={[s.cardPin, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={s.modalH1}>📍 Set Alarm Guard</Text>

          <Text style={s.fieldLabel}>Alarm name</Text>
          <TextInput
            style={s.inp}
            value={form.title}
            onChangeText={(value) => setForm({ ...form, title: value })}
            placeholder="Where are you heading?"
            placeholderTextColor={INK.muted}
            accessibilityLabel="Alarm name"
          />

          <View style={s.fieldRow}>
            <Text style={s.fieldLabel}>Radius · {form.radius} m</Text>
          </View>
          <TextInput
            style={s.inp}
            value={form.radius}
            onChangeText={(value) => setForm({ ...form, radius: value.replace(/[^0-9]/g, "") })}
            placeholder={`${MIN_RADIUS_METERS}–${MAX_RADIUS_METERS} meters`}
            placeholderTextColor={INK.muted}
            keyboardType="numeric"
            accessibilityLabel="Alarm radius in meters"
          />

          <View style={s.quickRadii}>
            {[100, 250, 500, 1000].map((preset) => {
              const active = Number(form.radius) === preset;
              return (
                <TouchableOpacity
                  key={preset}
                  style={[
                    s.quickRadius,
                    active && { backgroundColor: theme.accent, borderColor: theme.accent },
                  ]}
                  onPress={() => setForm({ ...form, radius: String(preset) })}
                  accessibilityRole="button"
                  accessibilityLabel={`Set radius to ${preset} meters`}
                >
                  <Text
                    style={[
                      s.quickRadiusText,
                      active && { color: INK.onAccent },
                    ]}
                  >
                    {preset >= 1000 ? `${preset / 1000} km` : `${preset} m`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={s.checkRow}
            onPress={() => setForm({ ...form, isFav: !form.isFav })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: form.isFav }}
            accessibilityLabel="Save to favorites"
          >
            <Text>{form.isFav ? "☑️" : "◻️"}</Text>
            <Text style={s.checkLabel}>Save to ⭐ Favorites</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.btnAction, { backgroundColor: theme.accent }]}
            onPress={() => void handleSaveAlarm()}
            accessibilityRole="button"
            accessibilityLabel="Activate alarm guard"
          >
            <Text style={s.btnActionTxt}>Activate Alarm Guard 🔔</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 🚨 Wake Up Alert */}
      <Modal visible={!!ringingAlarm} transparent animationType="fade">
        <View style={s.overlayAlert}>
          <View style={s.cardAlert}>
            <Text style={s.alertEmoji}>🚨</Text>
            <Text style={s.alertTitle}>WAKE UP!</Text>
            <Text style={s.alertBody}>Arrived at "{ringingAlarm?.title}"</Text>
            {typeof ringingAlarm?.distance === "number" && ringingAlarm.distance > 0 ? (
              <Text style={s.alertMeta}>{ringingAlarm.distance} m from the pin</Text>
            ) : null}
            <TouchableOpacity
              style={s.btnStop}
              onPress={stopAlarm}
              accessibilityRole="button"
              accessibilityLabel="Stop the alarm"
            >
              <Text style={s.btnStopTxt}>🔕 STOP ALARM</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modals Container */}
      <Modal visible={!!modal} transparent animationType="fade">
        <View style={s.modalBg}>
          <View
            style={[s.modalCard, { backgroundColor: theme.card, borderColor: theme.accent }]}
          >
            {modal === "ai" && (
              <>
                <Text style={[s.modalH1, { color: theme.accent }]}>✨ AI Assistant</Text>
                <Text style={s.fieldLabel}>Describe where you're heading</Text>
                <TextInput
                  style={[s.inp, { minHeight: 84 }]}
                  value={aiPrompt}
                  onChangeText={setAiPrompt}
                  placeholder="e.g. Wake me up 1km before the airport"
                  placeholderTextColor={INK.muted}
                  multiline
                  accessibilityLabel="Describe your destination"
                />
                <TouchableOpacity
                  style={[s.btnAction, { backgroundColor: theme.accent }]}
                  onPress={() => void handleAi()}
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
                <ScrollView style={{ maxHeight: 260 }}>
                  {favorites.length === 0 ? (
                    <View style={s.emptyState}>
                      <Text style={s.emptyEmoji}>⭐</Text>
                      <Text style={s.emptyTitle}>No favorites yet</Text>
                      <Text style={s.emptyHint}>
                        Drop a pin and tick "Save to Favorites" to add one.
                      </Text>
                    </View>
                  ) : (
                    favorites.map((favorite) => (
                      <View key={favorite.id} style={s.row}>
                        <TouchableOpacity
                          style={{ flex: 1 }}
                          onPress={() => void activateFavorite(favorite)}
                          accessibilityRole="button"
                          accessibilityLabel={`Set alarm at ${favorite.label}`}
                        >
                          <Text style={s.listTitle}>⭐ {favorite.label}</Text>
                          <Text style={[s.listMeta, { color: theme.accent }]}>
                            {favorite.addressName} · {favorite.radiusMeters}m
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => void deleteFavoriteById(favorite.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${favorite.label}`}
                        >
                          <Text style={{ fontSize: 16 }}>🗑️</Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </ScrollView>
              </>
            )}

            {modal === "alarms" && (
              <>
                <View style={s.modalHeader}>
                  <Text style={s.modalH1}>
                    Alarms ({activeAlarms.length} active)
                  </Text>
                  {alarms.length > 0 && (
                    <TouchableOpacity onPress={() => void clearAllAlarms()}>
                      <Text style={s.dangerLink}>🗑️ Clear All</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <ScrollView style={{ maxHeight: 260 }}>
                  {alarms.length === 0 ? (
                    <View style={s.emptyState}>
                      <Text style={s.emptyEmoji}>🔔</Text>
                      <Text style={s.emptyTitle}>No alarms yet</Text>
                      <Text style={s.emptyHint}>
                        Drop a pin on the map to create your first alarm.
                      </Text>
                    </View>
                  ) : (
                    alarms.map((alarm) => {
                      const isActive = alarm.status === "ACTIVE";
                      return (
                        <View key={alarm.id} style={s.row}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.listTitle}>{alarm.title}</Text>
                            <Text style={s.listMeta}>
                              📍{" "}
                              {userLocation
                                ? getDistanceFormatted(
                                    userLocation.lat,
                                    userLocation.lng,
                                    alarm.latitude,
                                    alarm.longitude,
                                  )
                                : "—"}{" "}
                              · {alarm.radiusMeters}m
                            </Text>
                          </View>
                          <View
                            style={[
                              s.statusTag,
                              {
                                backgroundColor: isActive
                                  ? "rgba(34,197,94,0.15)"
                                  : "rgba(148,163,184,0.15)",
                                borderColor: isActive ? INK.success : INK.muted,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                s.statusTagText,
                                { color: isActive ? INK.success : INK.muted },
                              ]}
                            >
                              {isActive ? "Active" : alarm.status}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => void deleteAlarmById(alarm.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete alarm ${alarm.title}`}
                            style={s.listAction}
                          >
                            <Text style={{ fontSize: 16 }}>🗑️</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              </>
            )}

            {modal === "settings" && (
              <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                <Text style={[s.modalH1, { color: theme.accent }]}>⚙️ App Settings</Text>
                <Text style={s.subH}>🔊 Alarm Sound</Text>
                {SOUND_GROUP_ORDER.map((group) => (
                  <View key={group} style={s.soundGroup}>
                    <Text style={s.groupLabel}>
                      {SOUND_GROUP_ICON[group]} {group}
                    </Text>
                    <Text style={s.groupHint}>{SOUND_GROUP_HINT[group]}</Text>
                    {SOUND_PRESETS.filter((entry) => entry.group === group).map((entry) => {
                      const active = sound === entry.id;
                      return (
                        <TouchableOpacity
                          key={entry.id}
                          style={[
                            s.soundRow,
                            active && {
                              borderColor: theme.accent,
                              backgroundColor: theme.card,
                            },
                          ]}
                          // Selecting and previewing in one tap is what people
                          // expect from a ringtone list: you hear the option as
                          // you choose it.
                          onPress={() => {
                            setSound(entry.id);
                            writeSetting(STORAGE_KEYS.sound, entry.id);
                            engineRef.current?.preview(entry.id);
                          }}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`${entry.name}, ${entry.desc}`}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={s.listTitle}>{entry.name}</Text>
                            <Text style={s.listMeta}>{entry.desc}</Text>
                          </View>
                          {active ? (
                            <Text style={[s.soundCheck, { color: theme.accent }]}>✓</Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}

                <View style={s.soundGroup}>
                  <Text style={s.groupLabel}>📁 Your own</Text>
                  <Text style={s.groupHint}>Use any ringtone file from your device</Text>
                  <View
                    style={[
                      s.soundRow,
                      sound === "custom" && {
                        borderColor: theme.accent,
                        backgroundColor: theme.card,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={s.soundRowBody}
                      onPress={() => {
                        // Always offer the picker, otherwise a first-time
                        // selection could never reach the upload flow.
                        if (!customAudio) {
                          toast("📁 Choose an MP3 file for your custom alarm.");
                        }
                        pickCustomAudio();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Choose a custom ringtone file"
                    >
                      <Text style={s.listTitle}>Custom MP3</Text>
                      <Text style={s.listMeta}>
                        {customAudio ? "Loaded — tap to replace" : "Tap to upload a file"}
                      </Text>
                    </TouchableOpacity>
                    {sound === "custom" ? (
                      <Text style={[s.soundCheck, { color: theme.accent }]}>✓</Text>
                    ) : null}
                    <TouchableOpacity
                      onPress={() => {
                        if (!customAudio) {
                          toast("📁 Upload a ringtone file first.");
                          pickCustomAudio();
                          return;
                        }
                        engineRef.current?.preview("custom");
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Preview your custom ringtone"
                      style={s.testButton}
                    >
                      <Text style={[s.testLink, { color: theme.accent }]}>▶️</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={s.checkRow}
                  onPress={() => {
                    const next = !vibration;
                    setVibration(next);
                    writeSetting(STORAGE_KEYS.vibration, next ? "on" : "off");
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: vibration }}
                  accessibilityLabel="Vibrate with the alarm"
                >
                  <Text>{vibration ? "☑️" : "◻️"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.checkLabel}>📳 Vibrate with the alarm</Text>
                    <Text style={s.groupHint}>Phones buzz as well as ring</Text>
                  </View>
                </TouchableOpacity>

                <Text style={s.subH}>🎨 Themes</Text>
                <View style={s.swatches}>
                  {THEMES.map((entry) => {
                    const active = theme.id === entry.id;
                    return (
                      <TouchableOpacity
                        key={entry.id}
                        style={[
                          s.themeChip,
                          active && { borderColor: entry.accent, borderWidth: 2 },
                        ]}
                        onPress={() => {
                          setTheme(entry);
                          writeSetting(STORAGE_KEYS.themeId, entry.id);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Theme ${entry.name}`}
                        accessibilityState={{ selected: active }}
                      >
                        <View
                          style={[
                            s.swatchDot,
                            { backgroundColor: entry.accent },
                            active && s.swatchDotActive,
                          ]}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={s.subH}>🗺️ Map Tiles:</Text>
                <View style={{ flexDirection: "row", gap: SPACE.sm }}>
                  {(["dark", "light", "satellite"] as MapStyle[]).map((entry) => {
                    const active = mapStyle === entry;
                    return (
                      <TouchableOpacity
                        key={entry}
                        style={[
                          s.mapBtn,
                          active && { backgroundColor: theme.accent, borderColor: theme.accent },
                        ]}
                        onPress={() => {
                          setMapStyle(entry);
                          writeSetting(STORAGE_KEYS.mapStyle, entry);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${entry} map style`}
                      >
                        <Text
                          style={[
                            s.mapBtnText,
                            active && { color: INK.onAccent },
                          ]}
                        >
                          {entry.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            <TouchableOpacity
              style={[s.btnAction, { backgroundColor: theme.accent, marginTop: SPACE.lg }]}
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

/**
 * `StyleSheet.create` is typed for React Native, which rejects the web-only
 * properties used here (`cursor`, `userSelect`, `transition`, `boxShadow` and
 * the long-form `outline*` properties). GeoWake is a web-only app, so the sheet
 * is created through a loosely typed alias.
 *
 * This cast only relaxes *TypeScript* checking. React Native Web still
 * validates at runtime, so every property written here must be one its style
 * validator accepts: no CSS shorthands (`background`, `outline`, `font`, ...),
 * and no multi-value shorthands given as strings.
 */
const createSheet = StyleSheet.create as (styles: Record<string, any>) => Record<string, any>;

const s: any = createSheet({
  c: { flex: 1 },
  authBg: {
    flex: 1,
    backgroundColor: "#030712",
    justifyContent: "center",
    alignItems: "center",
    padding: SPACE.lg,
  },
  authCard: {
    backgroundColor: GLASS_SURFACE,
    padding: SPACE.xl,
    borderRadius: RADIUS.xl,
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
  },
  authSub: {
    color: INK.secondary,
    ...TYPE.body,
    textAlign: "center",
    marginTop: SPACE.sm,
    marginBottom: SPACE.lg,
  },
  topDockWrapper: {
    position: "absolute",
    top: SPACE.md,
    left: SPACE.md,
    right: SPACE.md,
    alignItems: "center",
    zIndex: 1000,
  },
  dock: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    width: "100%",
    maxWidth: 680,
    gap: SPACE.sm,
    boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
  },
  searchInp: {
    backgroundColor: INPUT_SURFACE,
    color: INK.primary,
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    ...TYPE.body,
    ...interactive,
    ...noFocusRing,
  },
  drop: {
    position: "absolute",
    top: 48,
    left: 0,
    right: 0,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    overflow: "hidden",
    boxShadow: "0 18px 40px rgba(0,0,0,0.5)",
    zIndex: 2000,
  },
  dropItem: {
    padding: SPACE.md,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
    ...interactive,
  },
  dropItemText: { color: INK.primary, ...TYPE.body },
  btnPill: {
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    ...interactive,
  },
  btnPillTxt: { color: INK.onAccent, ...TYPE.label, fontWeight: "800" },
  iconBtn: {
    width: MIN_TAP,
    height: MIN_TAP,
    borderRadius: RADIUS.pill,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    ...interactive,
  },
  favBar: { position: "absolute", top: 80, left: SPACE.md, right: SPACE.md, zIndex: 1000 },
  chip: {
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    ...interactive,
  },
  chipText: { ...TYPE.caption, fontWeight: "700" },
  toast: {
    position: "absolute",
    top: 120,
    alignSelf: "center",
    backgroundColor: GLASS_SURFACE,
    padding: SPACE.md,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    zIndex: 2500,
    maxWidth: "90%",
    boxShadow: "0 14px 34px rgba(0,0,0,0.5)",
  },
  toastText: { color: INK.primary, ...TYPE.body, fontWeight: "700", textAlign: "center" },
  statusPill: {
    position: "absolute",
    bottom: SPACE.lg,
    left: SPACE.lg,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    zIndex: 1000,
    ...interactive,
  },
  statusText: { color: INK.primary, ...TYPE.caption, fontWeight: "700", marginLeft: SPACE.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  recenter: {
    position: "absolute",
    bottom: 76,
    right: SPACE.lg,
    width: MIN_TAP,
    height: MIN_TAP,
    borderRadius: RADIUS.pill,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
    borderWidth: 1,
    ...interactive,
  },
  recenterText: { fontSize: 20 },
  fab: {
    position: "absolute",
    bottom: SPACE.lg,
    right: SPACE.lg,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.xl,
    borderRadius: RADIUS.pill,
    zIndex: 1000,
    boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
    ...interactive,
  },
  fabText: { color: INK.onAccent, ...TYPE.body, fontWeight: "800" },
  cardPin: {
    position: "absolute",
    bottom: 88,
    right: SPACE.lg,
    width: "92%",
    maxWidth: 380,
    padding: SPACE.lg,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    zIndex: 1100,
    boxShadow: "0 20px 50px rgba(0,0,0,0.55)",
  },
  inp: {
    backgroundColor: INPUT_SURFACE,
    color: INK.primary,
    padding: SPACE.md,
    borderRadius: RADIUS.md,
    marginBottom: SPACE.sm,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    ...TYPE.body,
    ...noFocusRing,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: SPACE.md,
    ...interactive,
  },
  checkLabel: { color: INK.secondary, ...TYPE.label, marginLeft: SPACE.sm },
  fieldLabel: { color: INK.muted, ...TYPE.caption, marginBottom: SPACE.xs },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  quickRadii: { flexDirection: "row", gap: SPACE.sm, marginBottom: SPACE.md },
  quickRadius: {
    flex: 1,
    alignItems: "center",
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: INPUT_SURFACE,
    ...interactive,
  },
  quickRadiusText: { color: INK.secondary, ...TYPE.caption, fontWeight: "700" },
  btnAction: {
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.md,
    alignItems: "center",
    ...interactive,
  },
  btnActionTxt: { color: INK.onAccent, ...TYPE.body, fontWeight: "800" },
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 16, 0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: SPACE.lg,
  },
  modalCard: {
    padding: SPACE.xl,
    borderRadius: RADIUS.xl,
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    maxHeight: "85%",
    boxShadow: "0 28px 70px rgba(0,0,0,0.6)",
  },
  modalH1: {
    ...TYPE.title,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: SPACE.md,
    color: INK.primary,
  },
  subH: {
    color: INK.muted,
    ...TYPE.label,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: SPACE.md,
    marginBottom: SPACE.sm,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: INPUT_SURFACE,
    padding: SPACE.md,
    borderRadius: RADIUS.md,
    marginTop: SPACE.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    ...interactive,
  },
  themeChip: {
    padding: SPACE.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: GLASS_BORDER,
    ...interactive,
  },
  swatches: { flexDirection: "row", gap: SPACE.sm, marginBottom: SPACE.sm },
  swatchDot: { width: 22, height: 22, borderRadius: 11 },
  swatchDotActive: {
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
  },
  mapBtnText: { color: INK.primary, ...TYPE.caption, fontWeight: "800" },
  testLink: { ...TYPE.caption, fontWeight: "800" },
  dangerLink: { color: INK.danger, ...TYPE.caption, fontWeight: "800" },
  listTitle: { color: INK.primary, ...TYPE.body, fontWeight: "700" },
  listMeta: { color: INK.muted, ...TYPE.caption, marginTop: 2 },
  listAction: { paddingLeft: SPACE.md, ...interactive },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACE.sm,
  },
  statusTag: {
    paddingVertical: SPACE.xxs,
    paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    marginRight: SPACE.sm,
  },
  statusTagText: { ...TYPE.caption, fontWeight: "800", fontSize: 11 },
  soundGroup: { marginBottom: SPACE.md },
  groupLabel: { color: INK.primary, ...TYPE.label, marginBottom: SPACE.xxs },
  groupHint: { color: INK.muted, ...TYPE.caption, marginBottom: SPACE.sm },
  soundRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    marginBottom: SPACE.sm,
    minHeight: MIN_TAP,
    ...interactive,
  },
  soundCheck: { ...TYPE.heading, fontWeight: "800", paddingLeft: SPACE.md },
  soundRowBody: { flex: 1, ...interactive },
  testButton: {
    paddingLeft: SPACE.md,
    paddingVertical: SPACE.xs,
    minHeight: MIN_TAP,
    justifyContent: "center",
    ...interactive,
  },
  mapBtn: {
    flex: 1,
    backgroundColor: INPUT_SURFACE,
    padding: SPACE.md,
    borderRadius: RADIUS.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    ...interactive,
  },
  overlayAlert: {
    flex: 1,
    backgroundColor: "rgba(127, 29, 29, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: SPACE.lg,
  },
  cardAlert: {
    backgroundColor: "rgba(15, 23, 42, 0.97)",
    padding: SPACE.xl,
    borderRadius: RADIUS.xl,
    width: "92%",
    maxWidth: 380,
    alignItems: "center",
    borderWidth: 2,
    borderColor: INK.danger,
    boxShadow: "0 30px 80px rgba(0,0,0,0.7)",
  },
  btnStop: {
    backgroundColor: INK.danger,
    paddingVertical: SPACE.lg,
    paddingHorizontal: SPACE.xl,
    borderRadius: RADIUS.pill,
    width: "100%",
    alignItems: "center",
    ...interactive,
  },
  btnStopTxt: { color: "#fff", ...TYPE.title, fontWeight: "800" },
  authNote: { color: INK.secondary, ...TYPE.caption, marginTop: SPACE.md },
  errorNote: {
    color: INK.danger,
    ...TYPE.caption,
    marginTop: SPACE.md,
    textAlign: "center",
  },
  alertEmoji: { fontSize: 56, marginBottom: SPACE.xs },
  alertTitle: {
    color: INK.danger,
    ...TYPE.display,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: SPACE.sm,
  },
  alertBody: {
    color: INK.primary,
    ...TYPE.heading,
    textAlign: "center",
    marginBottom: SPACE.xs,
  },
  alertMeta: { color: INK.secondary, ...TYPE.caption, marginBottom: SPACE.lg },
  emptyState: {
    alignItems: "center",
    paddingVertical: SPACE.xl,
    paddingHorizontal: SPACE.lg,
  },
  emptyEmoji: { fontSize: 40, marginBottom: SPACE.sm },
  emptyTitle: { color: INK.secondary, ...TYPE.body, textAlign: "center" },
  emptyHint: {
    color: INK.muted,
    ...TYPE.caption,
    textAlign: "center",
    marginTop: SPACE.xs,
  },
});
