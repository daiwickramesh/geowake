import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_PASSWORD ? {} : undefined,
  connectTimeout: 5000,
  commandTimeout: 2000, // Force 2-second timeout (NEVER hangs!)
  enableOfflineQueue: false, // NEVER block requests if Redis is busy
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 100, 2000),
});

redis.on('connect', () => {
  console.log('⚡ Redis Cache Connected Successfully!');
});

redis.on('error', (err: any) => {
  if (err.code === 'ECONNRESET') return;
  console.warn('⚠️ Redis notice:', err.message);
});

export default redis; 