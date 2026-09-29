import { z } from "zod";

export const MIN_RADIUS_METERS = 25;
export const MAX_RADIUS_METERS = 50_000;
export const DEFAULT_RADIUS_METERS = 500;

/** Geographic bounds shared by alarms, favorites, AI results and GPS pings. */
export const latitudeSchema = z
  .number({ message: "Latitude must be a number." })
  .finite("Latitude must be a finite number.")
  .min(-90, "Latitude must be between -90 and 90.")
  .max(90, "Latitude must be between -90 and 90.");

export const longitudeSchema = z
  .number({ message: "Longitude must be a number." })
  .finite("Longitude must be a finite number.")
  .min(-180, "Longitude must be between -180 and 180.")
  .max(180, "Longitude must be between -180 and 180.");

export const radiusMetersSchema = z
  .number({ message: "Radius must be a number." })
  .finite("Radius must be a finite number.")
  .min(MIN_RADIUS_METERS, `Radius must be at least ${MIN_RADIUS_METERS} meters.`)
  .max(MAX_RADIUS_METERS, `Radius must be at most ${MAX_RADIUS_METERS} meters.`);

export const idSchema = z
  .string({ message: "Id is required." })
  .trim()
  .min(1, "Id is required.")
  .max(128, "Id is too long.");

/**
 * Coerces JSON/HTML-form values to a validated coordinate.
 * Rejects NaN/Infinity, empty strings and out-of-range values, while
 * accepting a legitimate `0` for either latitude or longitude.
 */
export const coordinate = (axis: "latitude" | "longitude") =>
  z
    .union([z.number(), z.string()])
    .transform((value, ctx) => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          ctx.addIssue({ code: "custom", message: `${axis} is required.` });
          return z.NEVER;
        }
        const parsed = Number(trimmed);
        if (Number.isNaN(parsed)) {
          ctx.addIssue({ code: "custom", message: `${axis} must be a number.` });
          return z.NEVER;
        }
        return parsed;
      }
      return value;
    })
    .pipe(axis === "latitude" ? latitudeSchema : longitudeSchema);

export const radiusMetersInput = z
  .union([z.number(), z.string()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === "") {
      return DEFAULT_RADIUS_METERS;
    }
    const parsed = typeof value === "string" ? Number(value.trim()) : value;
    if (typeof parsed !== "number" || Number.isNaN(parsed)) {
      ctx.addIssue({ code: "custom", message: "Radius must be a number." });
      return z.NEVER;
    }
    const result = radiusMetersSchema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message });
      }
      return z.NEVER;
    }
    return result.data;
  });

/** Short, single-line, length-bounded free text (names, titles, labels). */
export const shortText = (field: string, max: number) =>
  z
    .string({ message: `${field} is required.` })
    .trim()
    .min(1, `${field} is required.`)
    .max(max, `${field} must be at most ${max} characters.`);

export const optionalShortText = (field: string, max: number) =>
  shortText(field, max).optional();

export const formatIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => issue.message);
