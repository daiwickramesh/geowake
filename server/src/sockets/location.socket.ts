import { Server, type Socket } from "socket.io";
import prisma from "../config/db";
import redis from "../config/redis";
import {
  extractBearerToken,
  verifyAuthToken,
  type AuthTokenClaims,
} from "../config/jwt";
import { calculateDistanceInMeters } from "../utils/distance";
import { latitudeSchema, longitudeSchema } from "../schemas/common.schema";
import { z } from "zod";

/**
 * Client payload for a GPS fix. `userId` is deliberately absent: identity is
 * taken from the verified handshake token, never from client input.
 */
const locationUpdateSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracy: z
    .number()
    .finite()
    .min(0)
    .max(10_000)
    .optional(),
});

const userRoom = (userId: string) => `user:${userId}`;

type AuthedSocket = Socket & { data: { user: AuthTokenClaims } };

const extractHandshakeToken = (socket: Socket): string | null =>
  extractBearerToken(socket.handshake.auth?.token) ??
  extractBearerToken(socket.handshake.headers?.authorization);

/**
 * Rejects any socket that cannot present a valid GeoWake JWT, then derives
 * the user from the verified claims. A client can neither observe nor update
 * another user's location or alarms.
 */
export const setupLocationSocket = (io: Server) => {
  io.use((socket, next) => {
    const token = extractHandshakeToken(socket);
    if (!token) {
      next(new Error("Unauthorized: missing token"));
      return;
    }
    try {
      (socket.data as { user: AuthTokenClaims }).user = verifyAuthToken(token);
      next();
    } catch {
      next(new Error("Unauthorized: invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const typed = socket as AuthedSocket;
    const { id: userId } = typed.data.user;

    // Room lets every session of this user receive its own trigger events.
    typed.join(userRoom(userId));

    typed.on("location:update", async (raw: unknown) => {
      const parsed = locationUpdateSchema.safeParse(raw);
      if (!parsed.success) {
        typed.emit("location:error", { error: "Invalid coordinates." });
        return;
      }
      const { latitude, longitude } = parsed.data;

      try {
        const activeAlarms = await prisma.alarm.findMany({
          where: { userId, status: "ACTIVE" },
          select: { id: true, title: true, latitude: true, longitude: true, radiusMeters: true },
        });

        for (const alarm of activeAlarms) {
          const distance = calculateDistanceInMeters(
            latitude,
            longitude,
            alarm.latitude,
            alarm.longitude,
          );

          if (distance > alarm.radiusMeters) continue;

          // Conditional update: whichever concurrent update flips ACTIVE ->
          // TRIGGERED wins, so the alarm can only ever fire once.
          const claimed = await prisma.alarm.updateMany({
            where: { id: alarm.id, userId, status: "ACTIVE" },
            data: { status: "TRIGGERED" },
          });
          if (claimed.count === 0) continue;

          redis.del(`alarms:user:${userId}`).catch(() => {});

          // Emitted through the namespace (`io.to`) rather than
          // `socket.to`: the latter excludes the sender, so the tab that
          // reported the location — the one that must play the siren — would
          // never receive its own trigger event.
          io.to(userRoom(userId)).emit("alarm:trigger", {
            alarmId: alarm.id,
            title: alarm.title,
            distance: Math.round(distance),
            status: "TRIGGERED",
          });

          // The alarm title is user-supplied, so only the id is logged.
          console.log(
            `🚨 Alarm ${alarm.id} triggered for user ${userId} (${Math.round(distance)}m away)`,
          );
        }
      } catch (error) {
        console.error("WebSocket location processing failed:", error);
        typed.emit("location:error", { error: "Could not process location update." });
      }
    });
  });
};
