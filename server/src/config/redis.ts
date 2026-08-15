import Redis from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: 3,
});

redis.on("connect", () => {
  console.log("⚡ Redis Cache Connected Successfully!");
});

redis.on("error", (err) => {
  console.warn("⚠️ Redis connection error:", err.message);
});

export default redis;
