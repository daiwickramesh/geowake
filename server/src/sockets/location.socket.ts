import { Server, Socket } from "socket.io";
import prisma from "../config/db";
import { calculateDistanceInMeters } from "../utils/distance";

export const setupLocationSocket = (io: Server) => {
  io.on("connection", (socket: Socket) => {
    console.log(`🔌 Client connected to WebSocket: ${socket.id}`);

    // Listen for real-time location updates from the client
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

          // Check distance to each active alarm
          for (const alarm of activeAlarms) {
            const distance = calculateDistanceInMeters(
              latitude,
              longitude,
              alarm.latitude,
              alarm.longitude,
            );

            // If user has entered the alarm radius -> TRIGGER ALARM!
            if (distance <= alarm.radiusMeters) {
              // Update alarm status to TRIGGERED in database
              await prisma.alarm.update({
                where: { id: alarm.id },
                data: { status: "TRIGGERED" },
              });

              // Emit instant trigger alert to the client
              socket.emit("alarm:trigger", {
                alarmId: alarm.id,
                title: alarm.title,
                destinationName: alarm.destinationName,
                distance: Math.round(distance),
                radius: alarm.radiusMeters,
              });

              console.log(
                `🚨 ALARM TRIGGERED for User ${userId}: ${alarm.title} (${Math.round(distance)}m away)`,
              );
            }
          }
        } catch (error) {
          console.error("WebSocket location error:", error);
        }
      },
    );

    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });
};
