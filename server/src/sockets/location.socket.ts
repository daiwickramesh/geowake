import { Server, Socket } from 'socket.io';
import prisma from '../config/db';
import redis from '../config/redis';
import { calculateDistanceInMeters } from '../utils/distance';

export const setupLocationSocket = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    socket.on('location:update', async (data: { userId: string; latitude: number; longitude: number }) => {
      const { userId, latitude, longitude } = data;

      if (!userId || latitude === undefined || longitude === undefined) return;

      try {
        // Fetch user's active alarms from PostgreSQL
        const activeAlarms = await prisma.alarm.findMany({
          where: { userId, status: 'ACTIVE' },
        });

        for (const alarm of activeAlarms) {
          const distance = calculateDistanceInMeters(
            latitude,
            longitude,
            alarm.latitude,
            alarm.longitude
          );

          // User arrived inside the geofence radius!
          if (distance <= alarm.radiusMeters) {
            // 1. Delete triggered alarm from database
            await prisma.alarm.delete({
              where: { id: alarm.id },
            });

            // 2. Safe non-blocking Redis cache clear (won't crash if idle)
            try {
              await redis.del(`alarms:user:${userId}`);
            } catch (cacheErr) {
              // Ignore cache errors
            }

            // 3. Emit trigger event to client to ring audio siren
            socket.emit('alarm:trigger', {
              alarmId: alarm.id,
              title: alarm.title,
              distance: Math.round(distance),
            });

            console.log(`🚨 ALARM TRIGGERED & DELETED: "${alarm.title}" (${Math.round(distance)}m away)`);
          }
        }
      } catch (error) {
        console.error('WebSocket location error:', error);
      }
    });
  });
};