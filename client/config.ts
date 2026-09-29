import { Platform } from "react-native";

/**
 * Runtime configuration.
 *
 * Everything is overridable with `EXPO_PUBLIC_*` variables (see
 * `client/.env.example`). Note that `EXPO_PUBLIC_*` values are inlined into the
 * public bundle — never put a secret here.
 */

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const isBrowser = Platform.OS === "web" && typeof window !== "undefined";

const isLocalHost =
  isBrowser &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

const DEFAULT_REMOTE_API = "https://geowake-6lwr.onrender.com/api";
const DEFAULT_LOCAL_API = "http://localhost:5000/api";

/** Base URL for REST calls, always without a trailing slash. */
export const API_BASE = stripTrailingSlash(
  process.env.EXPO_PUBLIC_API_URL ??
    (isLocalHost ? DEFAULT_LOCAL_API : DEFAULT_REMOTE_API),
);

/** Socket.IO server root. Defaults to the API host so the two cannot drift. */
export const SOCKET_URL = stripTrailingSlash(
  process.env.EXPO_PUBLIC_SOCKET_URL ?? API_BASE.replace(/\/api$/, ""),
);

/**
 * Google Identity Services web client ID. This is a public identifier (not a
 * secret) and must match `GOOGLE_CLIENT_ID` configured on the server.
 *
 * There is deliberately no hard-coded fallback: a mismatched ID would fail
 * Google's `origin_mismatch` check and break sign-in in a confusing way, so an
 * unset value is surfaced to the user instead.
 */
export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/** Google sign-in is unavailable until a client ID is configured. */
export const IS_GOOGLE_AUTH_CONFIGURED = GOOGLE_CLIENT_ID.length > 0;

/** GeoWake is a browser application: Leaflet, Web Audio, localStorage. */
export const IS_WEB_ONLY_BUILD = Platform.OS === "web";

export const MIN_RADIUS_METERS = 25;
export const MAX_RADIUS_METERS = 50_000;
export const DEFAULT_RADIUS_METERS = 500;

/** Custom ringtones are kept in localStorage, so cap the stored data URL. */
export const MAX_CUSTOM_AUDIO_BYTES = 2_000_000;

export const isValidCoordinate = (
  lat: unknown,
  lng: unknown,
): lat is number =>
  typeof lat === "number" &&
  Number.isFinite(lat) &&
  lat >= -90 &&
  lat <= 90 &&
  typeof lng === "number" &&
  Number.isFinite(lng) &&
  lng >= -180 &&
  lng <= 180;

export const isValidRadius = (radius: unknown): radius is number =>
  typeof radius === "number" &&
  Number.isFinite(radius) &&
  radius >= MIN_RADIUS_METERS &&
  radius <= MAX_RADIUS_METERS;
