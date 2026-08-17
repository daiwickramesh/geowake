import { Server, Socket } from "socket.io";
import prisma from "../config/db";
import redis from "../config/redis";
import { calculateDistanceInMeters } from "../utils/distance";

export const setupLocationSocket = (io: Server) => {
  io.on("connection", (socket: Socket) => {
    // Listen for live location updates from client
    socket.on(
      "location:update",
      async (data: { userId: string; latitude: number; longitude: number }) => {
        const { userId, latitude, longitude } = data;

        if (!userId || latitude === undefined || longitude === undefined)
          return;

        try {
          // Fetch all active alarms for this user
          const activeAlarms = await prisma.alarm.findMany({
            where: { userId, status: "ACTIVE" },
          });

          for (const alarm of activeAlarms) {
            const distance = calculateDistanceInMeters(
              latitude,
              longitude,
              alarm.latitude,
              alarm.longitude,
            );

            // User entered the geofence radius
            if (distance <= alarm.radiusMeters) {
              // 1. Automatically delete the alarm from PostgreSQL
              await prisma.alarm.delete({
                where: { id: alarm.id },
              });

              // 2. Clear Redis cache for this user
              await redis.del(`alarms:user:${userId}`);

              // 3. Emit trigger event to phone/browser
              socket.emit("alarm:trigger", {
                alarmId: alarm.id,
                title: alarm.title,
                distance: Math.round(distance),
              });

              console.log(
                `🚨 ALARM TRIGGERED & AUTO-DELETED: ${alarm.title} for user ${userId}`,
              );
            }
          }
        } catch (error) {
          console.error("WebSocket location error:", error);
        }
      },
    );
  });
};
