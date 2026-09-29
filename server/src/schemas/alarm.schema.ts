import { z } from "zod";
import { coordinate, optionalShortText, radiusMetersInput, shortText } from "./common.schema";

export const createAlarmSchema = z.object({
  title: shortText("Title", 120),
  destinationName: optionalShortText("Destination name", 200),
  latitude: coordinate("latitude"),
  longitude: coordinate("longitude"),
  radiusMeters: radiusMetersInput,
  vibrateOnly: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === "true"),
});

export const updateAlarmStatusSchema = z.object({
  status: z.enum(["ACTIVE", "TRIGGERED", "DISMISSED", "INACTIVE"], {
    message: "Status must be one of ACTIVE, TRIGGERED, DISMISSED, INACTIVE.",
  }),
});

export const alarmIdParamSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "Alarm id is required.")
    .max(128, "Alarm id is too long."),
});

export type CreateAlarmInput = z.infer<typeof createAlarmSchema>;
export type UpdateAlarmStatusInput = z.infer<typeof updateAlarmStatusSchema>;
