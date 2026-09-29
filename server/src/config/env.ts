import dotenv from "dotenv";

dotenv.config();

/**
 * Central, fail-fast configuration module.
 *
 * Every runtime secret is read exactly once, validated here, and exported
 * through this module. Application code must never read `process.env`
 * directly, which guarantees that a missing value fails loudly at startup
 * instead of silently falling back to an insecure default at request time.
 */

const REQUIRED_VARS = [
  "DATABASE_URL",
  "JWT_SECRET",
  "GOOGLE_CLIENT_ID",
] as const;

const MIN_JWT_SECRET_LENGTH = 32;

function readString(key: string): string | undefined {
  const raw = process.env[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRequired(key: (typeof REQUIRED_VARS)[number]): string {
  const value = readString(key);
  if (!value) {
    throw new MissingEnvError([key]);
  }
  return value;
}

export class MissingEnvError extends Error {
  readonly keys: string[];

  constructor(keys: string[]) {
    super(
      `Missing or empty required environment variable(s): ${keys.join(", ")}. ` +
        "Copy server/.env.example to server/.env (or set them in your host's " +
        "secret store) and start the server again.",
    );
    this.name = "MissingEnvError";
    this.keys = keys;
  }
}

const missingKeys = REQUIRED_VARS.filter((key) => !readString(key));
if (missingKeys.length > 0) {
  throw new MissingEnvError(missingKeys);
}

const jwtSecret = readRequired("JWT_SECRET");
if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
  throw new Error(
    `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long ` +
      `(got ${jwtSecret.length}). Generate one with: openssl rand -base64 48`,
  );
}

function readPort(key: string, fallback: number): number {
  const value = readString(key);
  if (!value) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${key} must be an integer between 1 and 65535 (got "${value}").`);
  }
  return port;
}

function readOrigins(): string[] | "*" {
  const value = readString("CORS_ORIGIN");
  if (!value || value === "*") return "*";
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : "*";
}

function readPositiveInt(key: string, fallback: number): number {
  const value = readString(key);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer (got "${value}").`);
  }
  return parsed;
}

export const env = Object.freeze({
  nodeEnv: readString("NODE_ENV") ?? "development",
  port: readPort("PORT", 5000),

  databaseUrl: readRequired("DATABASE_URL"),
  jwtSecret,
  googleClientId: readRequired("GOOGLE_CLIENT_ID"),

  /** Shared by every issuer (Google sign-in, password login, registration). */
  jwtExpiresIn: readString("JWT_EXPIRES_IN") ?? "7d",
  /** Google sign-in sessions are longer lived than password sessions. */
  googleJwtExpiresIn: readString("GOOGLE_JWT_EXPIRES_IN") ?? "30d",

  /** Optional: when absent the AI parser falls back to geocoding only. */
  groqApiKey: readString("GROQ_API_KEY"),
  groqModel: readString("GROQ_MODEL") ?? "llama-3.3-70b-versatile",
  groqTimeoutMs: readPositiveInt("GROQ_TIMEOUT_MS", 4000),
  geocodeTimeoutMs: readPositiveInt("GEOCODE_TIMEOUT_MS", 5000),

  redis: Object.freeze({
    host: readString("REDIS_HOST") ?? "127.0.0.1",
    port: readPort("REDIS_PORT", 6379),
    password: readString("REDIS_PASSWORD"),
  }),

  corsOrigins: readOrigins(),
});

export type Env = typeof env;
