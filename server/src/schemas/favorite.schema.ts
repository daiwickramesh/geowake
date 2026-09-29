import { z } from "zod";
import { coordinate, formatIssues, optionalShortText, radiusMetersInput, shortText } from "./common.schema";

export const createFavoriteSchema = z.object({
  label: shortText("Label", 80),
  addressName: optionalShortText("Address", 200),
  latitude: coordinate("latitude"),
  longitude: coordinate("longitude"),
  radiusMeters: radiusMetersInput,
});

export const favoriteIdParamSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "Favorite id is required.")
    .max(128, "Favorite id is too long."),
});

export const validateFavoriteId = (id: unknown): string | string[] => {
  const result = favoriteIdParamSchema.safeParse({ id });
  return result.success ? result.data.id : formatIssues(result.error);
};
