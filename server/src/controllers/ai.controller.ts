import { Response } from 'express';
import groq from '../config/groq';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

export const parseSmartAlarm = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized. Please log in.' });

    const { prompt, userLat, userLng } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Please provide a valid prompt.' });
    }

    console.log(`🤖 Processing AI Prompt: "${prompt}"`);

    // 1. Fetch user's favorites safely
    let favoritesContext: any[] = [];
    try {
      const favorites = await prisma.favorite.findMany({ where: { userId } });
      favoritesContext = favorites.map((f) => ({
        label: f.label,
        destination: f.addressName,
        latitude: f.latitude,
        longitude: f.longitude,
        radiusMeters: f.radiusMeters,
      }));
    } catch (e) {}

    let destination = prompt.trim();
    let radiusMeters = 500;
    let latitude: number | null = null;
    let longitude: number | null = null;
    let tokensUsed = 0;

    // 2. Call Groq with a fast 4-second timeout promise
    try {
      const systemPrompt = `
You are a transit assistant. User GPS: [${userLat || 12.9716}, ${userLng || 77.5946}].
FAVORITES: ${JSON.stringify(favoritesContext)}
Extract "destination" and "radiusMeters" (number, default 500).
JSON OUTPUT: {"destination": "string", "radiusMeters": 500, "latitude": null, "longitude": null}
`;

      const aiPromise = groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      });

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Groq timeout')), 4000));
      const completion: any = await Promise.race([aiPromise, timeoutPromise]);

      const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
      if (parsed.destination) destination = parsed.destination;
      if (parsed.radiusMeters) radiusMeters = Number(parsed.radiusMeters) || 500;
      if (parsed.latitude && parsed.longitude) {
        latitude = Number(parsed.latitude);
        longitude = Number(parsed.longitude);
      }
      tokensUsed = completion.usage?.total_tokens || 0;
    } catch (llmErr: any) {
      console.warn('Groq skipped/fallback:', llmErr.message);
      const match = prompt.match(/(\d+(?:\.\d+)?)\s*(km|k|m|meters)/i);
      if (match) {
        const val = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        radiusMeters = unit.startsWith('k') ? val * 1000 : val;
        destination = prompt.replace(match[0], '').replace(/wake me up|before|near|at|set alarm/gi, '').trim();
      }
    }

    // 3. Geocoding
    if (!latitude || !longitude) {
      const geoUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(destination)}&lat=${userLat || 12.9716}&lon=${userLng || 77.5946}&limit=1`;
      const geoRes = await fetch(geoUrl).then((r) => r.json());

      if (!geoRes.features || geoRes.features.length === 0) {
        const fallbackUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(destination)}&limit=1`;
        const fallbackRes = await fetch(fallbackUrl).then((r) => r.json());
        if (!fallbackRes.features || fallbackRes.features.length === 0) {
          return res.status(404).json({ error: `Could not find "${destination}".` });
        }
        const f = fallbackRes.features[0];
        [longitude, latitude] = f.geometry.coordinates;
        destination = f.properties.name || destination;
      } else {
        const f = geoRes.features[0];
        [longitude, latitude] = f.geometry.coordinates;
        destination = f.properties.name || destination;
      }
    }

    // 4. Log to DB
    prisma.aILog.create({
      data: {
        userId,
        prompt,
        model: 'llama-3.3-70b-versatile',
        tokensUsed,
        costEstimate: (tokensUsed / 1000) * 0.0005,
        parsedData: { destination, latitude, longitude, radiusMeters },
      },
    }).catch(() => {});

    console.log(`🎯 AI Resolved: "${destination}" -> [${latitude}, ${longitude}] (${radiusMeters}m)`);

    return res.status(200).json({
      title: destination,
      latitude: parseFloat(Number(latitude).toFixed(4)),
      longitude: parseFloat(Number(longitude).toFixed(4)),
      radiusMeters,
    });
  } catch (error: any) {
    console.error('AI Parse Fatal Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to process AI prompt.' });
  }
};