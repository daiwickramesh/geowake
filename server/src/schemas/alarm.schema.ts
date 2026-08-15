import { z } from "zod";

export const createAlarmSchema = z.object({
  title: z.string().min(1, "Title is required"),
  destinationName: z.string().min(1, "Destination name is required"),
  latitude: z.number().min(-90).max(90, "Invalid latitude"),
  longitude: z.number().min(-180).max(180, "Invalid longitude"),
  radiusMeters: z.number().positive().default(500),
  vibrateOnly: z.boolean().optional().default(false),
});

export const updateAlarmStatusSchema = z.object({
  status: z.enum(["ACTIVE", "TRIGGERED", "DISMISSED", "INACTIVE"]),
});
