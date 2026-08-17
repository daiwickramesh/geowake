import { Response } from 'express';
import prisma from '../config/db';
import redis from '../config/redis';
import { AuthRequest } from '../middleware/auth.middleware';
import { createAlarmSchema, updateAlarmStatusSchema } from '../schemas/alarm.schema';

const cacheKey = (userId: string) => `alarms:user:${userId}`;

export const createAlarm = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

    const validation = createAlarmSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues.map((e) => e.message).join(', ') });
    }

    const { title, destinationName, latitude, longitude, radiusMeters, vibrateOnly } = validation.data;

    // 1. Create in PostgreSQL
    const alarm = await prisma.alarm.create({
      data: {
        userId,
        title,
        destinationName: destinationName || title,
        latitude,
        longitude,
        radiusMeters,
        vibrateOnly: vibrateOnly || false,
      },
    });

    // 2. Non-blocking cache clear (won't wait or hang)
    redis.del(cacheKey(userId)).catch(() => {});

    console.log(`✅ Alarm Created: "${title}" for User: ${userId}`);
    return res.status(201).json({ message: 'Alarm created successfully!', alarm });
  } catch (error: any) {
    console.error('Create Alarm Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to save alarm.' });
  }
};

export const getUserAlarms = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

    // Try Redis safely without blocking
    try {
      const cached = await redis.get(cacheKey(userId));
      if (cached) return res.status(200).json({ source: 'redis', alarms: JSON.parse(cached) });
    } catch (e) {}

    // Query PostgreSQL
    const alarms = await prisma.alarm.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    redis.setex(cacheKey(userId), 60, JSON.stringify(alarms)).catch(() => {});
    return res.status(200).json({ source: 'postgres', alarms });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch alarms.' });
  }
};

export const updateAlarmStatus = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

    const validation = updateAlarmStatusSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: 'Invalid status' });

    await prisma.alarm.updateMany({
      where: { id: String(req.params.id), userId: String(userId) },
      data: { status: validation.data.status },
    });

    redis.del(cacheKey(userId)).catch(() => {});
    return res.status(200).json({ message: 'Alarm updated' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update alarm.' });
  }
};

export const deleteAlarm = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

    await prisma.alarm.deleteMany({
      where: { id: String(req.params.id), userId: String(userId) },
    });

    redis.del(cacheKey(userId)).catch(() => {});
    return res.status(200).json({ message: 'Alarm deleted' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete alarm.' });
  }
};