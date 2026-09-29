import { Response } from "express";
import prisma from "../config/db";
import { AuthRequest, requireUserId } from "../middleware/auth.middleware";
import { createFavoriteSchema, validateFavoriteId } from "../schemas/favorite.schema";
import { formatIssues } from "../schemas/common.schema";

export const createFavorite = async (req: AuthRequest, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const validation = createFavoriteSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(400).json({ errors: formatIssues(validation.error) });
    return;
  }

  const { label, addressName, latitude, longitude, radiusMeters } = validation.data;

  try {
    const favorite = await prisma.favorite.create({
      data: {
        userId,
        label,
        addressName: addressName ?? label,
        latitude,
        longitude,
        radiusMeters,
      },
    });

    res.status(201).json({ message: "Favorite saved!", favorite });
  } catch (error) {
    console.error("Failed to create favorite:", error);
    res.status(500).json({ error: "Failed to create favorite." });
  }
};

export const getFavorites = async (req: AuthRequest, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ favorites });
  } catch (error) {
    console.error("Failed to fetch favorites:", error);
    res.status(500).json({ error: "Failed to fetch favorites." });
  }
};

export const deleteFavorite = async (req: AuthRequest, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const id = validateFavoriteId(req.params.id);
  if (typeof id !== "string") {
    res.status(400).json({ errors: id });
    return;
  }

  try {
    const result = await prisma.favorite.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      res.status(404).json({ error: "Favorite not found." });
      return;
    }

    res.status(200).json({ message: "Favorite deleted." });
  } catch (error) {
    console.error("Failed to delete favorite:", error);
    res.status(500).json({ error: "Failed to delete favorite." });
  }
};
