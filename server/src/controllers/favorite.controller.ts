import { Response } from 'express';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

export const createFavorite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

    const { label, addressName, latitude, longitude, radiusMeters } = req.body;
    if (!label || !latitude || !longitude) {
      return res.status(400).json({ error: 'Label and coordinates are required.' });
    }

    const favorite = await prisma.favorite.create({
      data: {
        userId,
        label,
        addressName: addressName || label,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        radiusMeters: parseFloat(radiusMeters) || 500,
      },
    });

    return res.status(201).json({ message: 'Favorite saved!', favorite });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create favorite.' });
  }
};

export const getFavorites = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized.' });

    const favorites = await prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ favorites });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch favorites.' });
  }
};

export const deleteFavorite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    await prisma.favorite.deleteMany({
      where: { id: String(id), userId: String(userId) },
    });

    return res.status(200).json({ message: 'Favorite deleted.' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete favorite.' });
  }
};