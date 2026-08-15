import { Response } from 'express';
import prisma from '../config/db';
import redis from '../config/redis';
import { AuthRequest } from '../middleware/auth.middleware';
import { createAlarmSchema, updateAlarmStatusSchema } from '../schemas/alarm.schema';

const cacheKey = (userId: string) => `alarms:user:${userId}`;

// 1. Create Alarm
export const createAlarm = async (req: AuthRequest, res: Response) => {
  const validation = createAlarmSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error });

  const alarm = await prisma.alarm.create({
    data: { userId: req.user!.id, ...validation.data },
  });

  await redis.del(cacheKey(req.user!.id));
  return res.status(201).json({ alarm });
};

// 2. Get Alarms (with Redis cache)
export const getUserAlarms = async (req: AuthRequest, res: Response) => {
  const cached = await redis.get(cacheKey(req.user!.id));
  if (cached) return res.status(200).json({ source: 'redis', alarms: JSON.parse(cached) });

  const alarms = await prisma.alarm.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
  });

  await redis.setex(cacheKey(req.user!.id), 60, JSON.stringify(alarms));
  return res.status(200).json({ source: 'postgres', alarms });
};

// 3. Update Alarm Status
export const updateAlarmStatus = async (req: AuthRequest, res: Response) => {
  const validation = updateAlarmStatusSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error });

  await prisma.alarm.updateMany({
    where: { id: String(req.params.id), userId: req.user!.id },
    data: { status: validation.data.status },
  });

  await redis.del(cacheKey(req.user!.id));
  return res.status(200).json({ message: 'Alarm updated' });
};

// 4. Delete Alarm
export const deleteAlarm = async (req: AuthRequest, res: Response) => {
  await prisma.alarm.deleteMany({
    where: { id: String(req.params.id), userId: req.user!.id },
  });

  await redis.del(cacheKey(req.user!.id));
  return res.status(200).json({ message: 'Alarm deleted' });
};