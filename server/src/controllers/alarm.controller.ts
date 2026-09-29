import { Response } from "express";
import prisma from "../config/db";
import redis from "../config/redis";
import { AuthRequest, requireUserId } from "../middleware/auth.middleware";
import {
  alarmIdParamSchema,
  createAlarmSchema,
  updateAlarmStatusSchema,
} from "../schemas/alarm.schema";
import { formatIssues } from "../schemas/common.schema";

const cacheKey = (userId: string) => `alarms:user:${userId}`;

/** Cache is best-effort: a cold Redis must never fail a request. */
const invalidate = (userId: string) => {
  redis.del(cacheKey(userId)).catch(() => {});
};

export const createAlarm = async (req: AuthRequest, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const validation = createAlarmSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(400).json({ errors: formatIssues(validation.error) });
    return;
  }

  const { title, destinationName, latitude, longitude, radiusMeters, vibrateOnly } = validation.data;

  try {
    // Duplicate blocker: an ACTIVE alarm within ~150m of the same spot.
    const existing = await prisma.alarm.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        latitude: { gte: latitude - 0.0015, lte: latitude + 0.0015 },
        longitude: { gte: longitude - 0.0015, lte: longitude + 0.0015 },
      },
      select: { id: true, title: true },
    });

    if (existing) {
      res
        .status(409)
        .json({ error: `An alarm for "${existing.title}" is already active near this spot.` });
      return;
    }

    const alarm = await prisma.alarm.create({
      data: {
        userId,
        title,
        destinationName: destinationName ?? title,
        latitude,
        longitude,
        radiusMeters,
        vibrateOnly,
      },
    });

    invalidate(userId);
    res.status(201).json({ message: "Alarm created successfully!", alarm });
  } catch (error) {
    console.error("Failed to create alarm:", error);
    res.status(500).json({ error: "Failed to save alarm." });
  }
};

export const getUserAlarms = async (req: AuthRequest, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    try {
      const cached = await redis.get(cacheKey(userId));
      if (cached) {
        res.status(200).json({ source: "cache", alarms: JSON.parse(cached) });
        return;
      }
    } catch {
      // Unreachable Redis simply means we read from PostgreSQL.
    }

    const alarms = await prisma.alarm.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    redis.setex(cacheKey(userId), 60, JSON.stringify(alarms)).catch(() => {});
    res.status(200).json({ source: "postgres", alarms });
  } catch (error) {
    console.error("Failed to fetch alarms:", error);
    res.status(500).json({ error: "Failed to fetch alarms." });
  }
};

export const updateAlarmStatus = async (req: AuthRequest, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const paramCheck = alarmIdParamSchema.safeParse(req.params);
  const bodyCheck = updateAlarmStatusSchema.safeParse(req.body);
  if (!paramCheck.success) {
    res.status(400).json({ errors: formatIssues(paramCheck.error) });
    return;
  }
  if (!bodyCheck.success) {
    res.status(400).json({ errors: formatIssues(bodyCheck.error) });
    return;
  }

  const alarmId = paramCheck.data.id;

  try {
    // Ownership is part of the lookup, so another user's alarm is simply not
    // found and cannot be mutated.
    const owned = await prisma.alarm.findFirst({
      where: { id: alarmId, userId },
      select: { id: true, status: true },
    });

    if (!owned) {
      res.status(404).json({ error: "Alarm not found." });
      return;
    }

    const alarm = await prisma.alarm.update({
      where: { id: alarmId },
      data: { status: bodyCheck.data.status },
    });

    invalidate(userId);
    res.status(200).json({ message: "Alarm updated", alarm });
  } catch (error) {
    console.error("Failed to update alarm:", error);
    res.status(500).json({ error: "Failed to update alarm." });
  }
};

export const deleteAlarm = async (req: AuthRequest, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const paramCheck = alarmIdParamSchema.safeParse(req.params);
  if (!paramCheck.success) {
    res.status(400).json({ errors: formatIssues(paramCheck.error) });
    return;
  }

  const alarmId = paramCheck.data.id;

  try {
    const result = await prisma.alarm.deleteMany({ where: { id: alarmId, userId } });
    if (result.count === 0) {
      res.status(404).json({ error: "Alarm not found." });
      return;
    }

    invalidate(userId);
    res.status(200).json({ message: "Alarm deleted" });
  } catch (error) {
    console.error("Failed to delete alarm:", error);
    res.status(500).json({ error: "Failed to delete alarm." });
  }
};

/** 🗑️ Wipe all of the current user's alarms in one click. */
export const deleteAllAlarms = async (req: AuthRequest, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const result = await prisma.alarm.deleteMany({ where: { userId } });

    invalidate(userId);
    res.status(200).json({ message: "All alarms cleared.", deleted: result.count });
  } catch (error) {
    console.error("Failed to clear all alarms:", error);
    res.status(500).json({ error: "Failed to clear all alarms." });
  }
};
