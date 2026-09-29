import { z } from "zod";
import {
  coordinate,
  latitudeSchema,
  longitudeSchema,
  radiusMetersSchema,
} from "./common.schema";

/** Optional origin bias for geocoding, used to rank nearby results first. */
const optionalCoordinate = (axis: "latitude" | "longitude") =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === null || value === "") return null;
      const parsed = typeof value === "string" ? Number(value.trim()) : value;
      if (typeof parsed !== "number" || Number.isNaN(parsed)) {
        ctx.addIssue({ code: "custom", message: `${axis} must be a number.` });
        return z.NEVER;
      }
      const schema = axis === "latitude" ? latitudeSchema : longitudeSchema;
      const result = schema.safeParse(parsed);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({ code: "custom", message: issue.message });
        }
        return z.NEVER;
      }
      return result.data;
    });

export const parseAlarmSchema = z.object({
  prompt: z
    .string({ message: "Prompt is required." })
    .trim()
    .min(3, "Prompt must be at least 3 characters.")
    .max(280, "Prompt must be at most 280 characters."),
  userLat: optionalCoordinate("latitude"),
  userLng: optionalCoordinate("longitude"),
});

/**
 * Model output is untrusted. Only well-formed, in-range values are accepted;
 * anything else is ignored in favour of the defaults and the geocoder.
 */
export const modelDestinationSchema = z.object({
  destination: z.string().trim().min(1).max(200).optional(),
  radiusMeters: radiusMetersSchema.optional(),
  latitude: coordinate("latitude").optional(),
  longitude: coordinate("longitude").optional(),
});

export type ParseAlarmInput = z.infer<typeof parseAlarmSchema>;
