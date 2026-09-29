import Redis from "ioredis";
import { env } from "./env";

/**
 * Redis is a pure cache here: every call site swallows errors, so an
 * unreachable Redis degrades performance rather than correctness.
 */
const redis = new Redis({
  host: env.redis.host,
  port: env.redis.port,
  password: env.redis.password,
  tls: env.redis.password ? {} : undefined,
  connectTimeout: 5000,
  commandTimeout: 2000, // Force a 2-second timeout (NEVER hangs)
  enableOfflineQueue: false, // NEVER block requests if Redis is busy
  maxRetriesPerRequest: 1,
  lazyConnect: false,
  retryStrategy: (times) => Math.min(times * 100, 2000),
});

let hasLoggedReady = false;
let lastWarnedAt = 0;
const WARN_INTERVAL_MS = 60_000;

redis.on("ready", () => {
  if (hasLoggedReady) return;
  hasLoggedReady = true;
  console.log("⚡ Redis cache connected.");
});

redis.on("error", (err: Error) => {
  if ((err as NodeJS.ErrnoException).code === "ECONNRESET") return;
  // Reconnect attempts are frequent; log at most once a minute so a missing
  // cache never floods the logs.
  const now = Date.now();
  if (now - lastWarnedAt < WARN_INTERVAL_MS) return;
  lastWarnedAt = now;
  console.warn("⚠️ Redis unavailable (running without cache):", err.message);
});

export default redis;
