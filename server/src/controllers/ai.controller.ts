import { Response } from "express";
import groq from "../config/groq";
import prisma from "../config/db";
import { env } from "../config/env";
import { AuthRequest, requireUserId } from "../middleware/auth.middleware";
import { modelDestinationSchema, parseAlarmSchema } from "../schemas/ai.schema";
import { formatIssues, radiusMetersSchema } from "../schemas/common.schema";

/** Coordinates used when the client has not reported a fix yet. */
const FALLBACK_ORIGIN = { lat: 12.9716, lng: 77.5946 } as const;

/** "1.5 km" / "300 m" / "1 km" — longest alternatives first. */
const RADIUS_PATTERN =
  /(\d+(?:\.\d+)?)\s*(kilometers|kilometres|kilometer|kilometre|km|meters|metres|meter|metre|mi|miles|m)\b/i;

const NOISE_PATTERN =
  /\b(wake me|wake|me up|up|before|near|around|at|when i|arriv\w*|alert me|remind me|set an? alarm|set alarm|alarm|please)\b/gi;

/**
 * Forces any radius through {@link radiusMetersSchema}, so a value produced by
 * a language model can never escape the supported 25m–50km range. Values that
 * fail validation (wrong type, out of range, NaN) fall back to the default
 * rather than being passed to the database.
 */
export const clampRadius = (value: number): number =>
  radiusMetersSchema.safeParse(value).success ? value : radiusMetersSchema.parse(500);

const isValidCoordinate = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === "number" &&
  Number.isFinite(lat) &&
  lat >= -90 &&
  lat <= 90 &&
  typeof lng === "number" &&
  Number.isFinite(lng) &&
  lng >= -180 &&
  lng <= 180;

interface GeocodeResult {
  latitude: number;
  longitude: number;
  name: string;
}

/** Photon returns GeoJSON, i.e. `[longitude, latitude]`. */
const readFeature = (payload: unknown): GeocodeResult | null => {
  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features) || features.length === 0) return null;

  const feature = features[0] as {
    geometry?: { coordinates?: unknown };
    properties?: { name?: unknown };
  };
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  if (!isValidCoordinate(latitude, longitude)) return null;

  const name = feature?.properties?.name;
  return {
    latitude,
    longitude,
    name: typeof name === "string" && name.trim().length > 0 ? name.trim() : "",
  };
};

const fetchPhoton = async (
  query: string,
  origin: { lat: number; lng: number } | null,
): Promise<GeocodeResult | null> => {
  const bias = origin
    ? `&lat=${origin.lat}&lon=${origin.lng}`
    : "";
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1${bias}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(env.geocodeTimeoutMs),
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Geocoder responded with ${response.status}`);
  }
  return readFeature(await response.json());
};

const geocode = async (
  query: string,
  origin: { lat: number; lng: number } | null,
): Promise<GeocodeResult | null> => {
  const nearby = await fetchPhoton(query, origin);
  if (nearby) return nearby;
  // Retry without a location bias in case the fix was stale or wrong.
  return fetchPhoton(query, null);
};

/** Last-resort parsing so a Groq outage still produces a usable alarm. */
const parseRadiusFromPrompt = (prompt: string): number | null => {
  const match = prompt.match(RADIUS_PATTERN);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const unit = match[2].toLowerCase();
  const meters = unit.startsWith("k") ? amount * 1000 : unit.startsWith("mi") ? amount * 1609.344 : amount;

  const bounded = radiusMetersSchema.safeParse(Math.round(meters));
  return bounded.success ? bounded.data : null;
};

const requestModel = async (
  systemPrompt: string,
  prompt: string,
): Promise<{ content: string; totalTokens: number }> => {
  const completion = await groq.chat.completions.create(
    {
      model: env.groqModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 200,
    },
    // Bounded so a slow provider can never hold the request open.
    { timeout: env.groqTimeoutMs, maxRetries: 0 },
  );
  return {
    content: completion.choices[0]?.message?.content ?? "",
    totalTokens: completion.usage?.total_tokens ?? 0,
  };
};

export const parseSmartAlarm = async (req: AuthRequest, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const validation = parseAlarmSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(400).json({ errors: formatIssues(validation.error) });
    return;
  }

  const { prompt } = validation.data;
  const origin =
    validation.data.userLat !== null && validation.data.userLng !== null
      ? { lat: validation.data.userLat, lng: validation.data.userLng }
      : null;
  const bias = origin ?? FALLBACK_ORIGIN;

  // Prompt text is user data: log only its length.
  console.log(`🤖 Parsing AI alarm prompt (${prompt.length} chars) for user ${userId}`);

  let favoritesContext: unknown[] = [];
  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId },
      select: { label: true, addressName: true, latitude: true, longitude: true, radiusMeters: true },
    });
    favoritesContext = favorites.map((favorite) => ({
      label: favorite.label,
      destination: favorite.addressName,
      latitude: favorite.latitude,
      longitude: favorite.longitude,
      radiusMeters: favorite.radiusMeters,
    }));
  } catch (error) {
    console.warn("Favorites unavailable for AI context:", error);
  }

  let destination = prompt;
  let radiusMeters = 500;
  let latitude: number | null = null;
  let longitude: number | null = null;
  let tokensUsed = 0;

  if (env.groqApiKey) {
    try {
      const systemPrompt = [
        "You are a transit assistant that turns a request into a geofenced wake-up alarm.",
        `User GPS: [${bias.lat}, ${bias.lng}].`,
        `SAVED PLACES: ${JSON.stringify(favoritesContext)}`,
        `Extract "destination" and "radiusMeters" (number between ${25} and ${50000}, default 500).`,
        "Set latitude/longitude to null unless the place is a specific known coordinate.",
        'Respond with JSON only: {"destination":"string","radiusMeters":500,"latitude":null,"longitude":null}',
      ].join("\n");

      const raw = await requestModel(systemPrompt, prompt);
      tokensUsed = raw.totalTokens;

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw.content);
      } catch {
        throw new Error("Model returned non-JSON output");
      }

      // Model output is untrusted: validate before it can influence anything.
      const parsed = modelDestinationSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new Error("Model output failed validation");
      }

      const data = parsed.data;
      if (data.destination) destination = data.destination;
      if (data.radiusMeters !== undefined) radiusMeters = data.radiusMeters;
      if (data.latitude !== undefined && data.longitude !== undefined) {
        latitude = data.latitude;
        longitude = data.longitude;
      }
    } catch (error) {
      console.warn("AI model unavailable, falling back to regex parsing:", error);
      const regexRadius = parseRadiusFromPrompt(prompt);
      if (regexRadius !== null) radiusMeters = regexRadius;
      const cleaned = prompt.replace(RADIUS_PATTERN, " ").replace(NOISE_PATTERN, " ").trim();
      if (cleaned.length > 0) destination = cleaned;
    }
  } else {
    const regexRadius = parseRadiusFromPrompt(prompt);
    if (regexRadius !== null) radiusMeters = regexRadius;
    const cleaned = prompt.replace(RADIUS_PATTERN, " ").replace(NOISE_PATTERN, " ").trim();
    if (cleaned.length > 0) destination = cleaned;
  }

  if (!isValidCoordinate(latitude, longitude)) {
    try {
      const result = await geocode(destination, origin);
      if (!result) {
        res.status(404).json({ error: `Could not find "${destination}".` });
        return;
      }
      latitude = result.latitude;
      longitude = result.longitude;
      if (result.name) destination = result.name;
    } catch (error) {
      console.error("Geocoding failed:", error);
      res.status(502).json({ error: "Location lookup is unavailable. Please try again." });
      return;
    }
  }

  const safeRadius = clampRadius(radiusMeters);

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !isValidCoordinate(latitude, longitude)
  ) {
    console.warn("AI pipeline produced no usable coordinates for a parsed prompt");
    res.status(404).json({ error: `Could not find "${destination}".` });
    return;
  }

  prisma.aILog
    .create({
      data: {
        userId,
        prompt,
        model: env.groqModel,
        tokensUsed,
        costEstimate: (tokensUsed / 1000) * 0.0005,
        parsedData: { destination, latitude, longitude, radiusMeters: safeRadius },
      },
    })
    .catch((error) => console.warn("AI log write failed:", error));

  // The destination comes from the user's prompt, so it is not logged.
  console.log(`🎯 AI resolved a destination to [${latitude}, ${longitude}] (${safeRadius}m)`);

  res.status(200).json({
    title: destination,
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    radiusMeters: safeRadius,
  });
};
