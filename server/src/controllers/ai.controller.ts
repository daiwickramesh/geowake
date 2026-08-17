import { Response } from 'express';
import groq from '../config/groq';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

export const parseSmartAlarm = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

    const { prompt, userLat, userLng } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Please provide a valid prompt.' });
    }

    // 1. Fetch user's saved favorites from PostgreSQL
    const favorites = await prisma.favorite.findMany({
      where: { userId },
    });

    const favoritesContext = favorites.map((f) => ({
      label: f.label,
      destination: f.addressName,
      latitude: f.latitude,
      longitude: f.longitude,
      radiusMeters: f.radiusMeters,
    }));

    // 2. Context-Aware Prompt with Favorites & Local Proximity
    const systemPrompt = `
You are a smart transit assistant for GeoWake.
The user's current GPS location is: [${userLat || 12.9716}, ${userLng || 77.5946}].

USER'S SAVED FAVORITE PLACES:
${JSON.stringify(favoritesContext, null, 2)}

TASK:
1. If the user mentions one of their saved favorite places (e.g. "Home", "College", "Work"), extract the exact latitude, longitude, and radiusMeters directly from their saved favorites!
2. If it is NOT a saved favorite, extract the destination query and radius in meters (default to 500m).

OUTPUT FORMAT:
Return strictly valid JSON with this schema:
{
  "isFavorite": true/false,
  "destination": "Place name",
  "latitude": 12.9716 (optional if not favorite),
  "longitude": 77.5946 (optional if not favorite),
  "radiusMeters": 500
}
`;

    // 3. Call Groq Llama 3
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    });

    const aiContent = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(aiContent);

    let latitude = parsed.latitude;
    let longitude = parsed.longitude;
    let resolvedTitle = parsed.destination || 'Target';
    const radiusMeters = Number(parsed.radiusMeters) || 500;

    // 4. If not a pre-saved favorite, resolve coordinates via Geocoder
    if (!latitude || !longitude) {
      const geoUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(resolvedTitle)}&lat=${userLat || 12.9716}&lon=${userLng || 77.5946}&limit=1`;
      const geoRes = await fetch(geoUrl).then((r) => r.json());

      if (!geoRes.features || geoRes.features.length === 0) {
        return res.status(404).json({ error: `Could not find coordinates for "${resolvedTitle}".` });
      }

      const feature = geoRes.features[0];
      [longitude, latitude] = feature.geometry.coordinates;
      resolvedTitle = feature.properties.name || resolvedTitle;
    }

    // 5. Token & Cost Logging
    const tokensUsed = completion.usage?.total_tokens || 0;
    await prisma.aILog.create({
      data: {
        userId,
        prompt,
        model: 'llama-3.3-70b-versatile',
        tokensUsed,
        costEstimate: (tokensUsed / 1000) * 0.0005,
        parsedData: { destination: resolvedTitle, latitude, longitude, radiusMeters },
      },
    });

    return res.status(200).json({
      title: resolvedTitle,
      latitude: parseFloat(latitude.toFixed(4)),
      longitude: parseFloat(longitude.toFixed(4)),
      radiusMeters,
      tokensUsed,
    });
  } catch (error) {
    console.error('AI error:', error);
    return res.status(500).json({ error: 'Failed to process AI prompt.' });
  }
};