import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_PASSWORD ? {} : undefined,
  keepAlive: 30000, // Sends 30s keep-alive ping to keep connection warm
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null,
});

redis.on('connect', () => {
  console.log('⚡ Redis Cache Connected Successfully!');
});

redis.on('error', (err: any) => {
  // Ignore harmless idle resets from serverless Upstash
  if (err.code === 'ECONNRESET') return;
  console.warn('⚠️ Redis error:', err.message);
});

export default redis;