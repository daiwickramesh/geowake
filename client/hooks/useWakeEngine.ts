import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { SOCKET_URL } from "../config";
import { LocationTracker, type Position } from "../lib/location";

export interface TriggeredAlarm {
  alarmId: string;
  title: string;
  distance: number;
}

/**
 * Upper bound on how often a fix is streamed to the server. The geofence test
 * runs server-side, so sending every sub-second fix only adds latency and
 * bandwidth; `enableHighAccuracy` can otherwise emit 10+ updates a second.
 */
const SERVER_UPLOAD_INTERVAL_MS = 2000;

interface UseWakeEngineOptions {
  token: string | null;
  onTrigger: (alarm: TriggeredAlarm) => void;
  onLocation: (position: Position) => void;
  onGpsError: (message: string) => void;
  onLocationError: (message: string) => void;
}

/**
 * Owns the live geofence loop: an authenticated Socket.IO connection plus a
 * single GPS watcher.
 *
 * The JWT is passed in the Socket.IO handshake, so the server derives the user
 * from verified claims — the client never sends a `userId`. Both resources are
 * torn down when the token changes or the component unmounts, and neither
 * effect depends on frequently-changing state, so re-renders can never
 * duplicate a socket or a GPS watcher.
 */
export const useWakeEngine = ({
  token,
  onTrigger,
  onLocation,
  onGpsError,
  onLocationError,
}: UseWakeEngineOptions) => {
  const socketRef = useRef<Socket | null>(null);
  const trackerRef = useRef<LocationTracker | null>(null);

  // Latest callbacks without re-creating the socket/GPS on every render.
  const triggerRef = useRef(onTrigger);
  const locationRef = useRef(onLocation);
  const gpsErrorRef = useRef(onGpsError);
  const locationErrorRef = useRef(onLocationError);

  useEffect(() => {
    triggerRef.current = onTrigger;
    locationRef.current = onLocation;
    gpsErrorRef.current = onGpsError;
    locationErrorRef.current = onLocationError;
  });

  useEffect(() => {
    if (!token) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    socketRef.current = socket;

    const handleTrigger = (payload: unknown) => {
      const data = payload as Partial<TriggeredAlarm> | null;
      if (!data || typeof data.alarmId !== "string") return;
      triggerRef.current({
        alarmId: data.alarmId,
        title: typeof data.title === "string" ? data.title : "Destination",
        distance: typeof data.distance === "number" ? data.distance : 0,
      });
    };

    socket.on("alarm:trigger", handleTrigger);
    socket.on("location:error", (payload: unknown) => {
      const message = (payload as { error?: unknown } | null)?.error;
      locationErrorRef.current(
        typeof message === "string" ? message : "Could not process location update.",
      );
    });
    socket.on("connect_error", (error: Error) => {
      locationErrorRef.current(error.message || "Live connection failed.");
    });

    return () => {
      socket.off("alarm:trigger", handleTrigger);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;

    let lastUploadAt = 0;
    let uploadTimer: ReturnType<typeof setTimeout> | null = null;
    // Holds the newest fix seen since the last upload. The pending timer reads
    // this instead of a captured `position`, otherwise fixes that arrive while
    // the timer is waiting would be dropped and the server would end up on a
    // stale coordinate.
    let pendingPosition: { lat: number; lng: number } | null = null;

    const sendPosition = (lat: number, lng: number) => {
      lastUploadAt = Date.now();
      pendingPosition = null;
      socketRef.current?.emit("location:update", { latitude: lat, longitude: lng });
    };

    const tracker = new LocationTracker({
      onPosition: (position) => {
        // The UI gets every fix (it throttles its own rendering), but the
        // network only sees them at a bounded rate.
        locationRef.current(position);
        gpsErrorRef.current("");

        const now = Date.now();
        const elapsed = now - lastUploadAt;

        if (elapsed >= SERVER_UPLOAD_INTERVAL_MS) {
          sendPosition(position.lat, position.lng);
          return;
        }

        // Coalesce the fixes in between into one trailing send so the server
        // still converges on the final position rather than a stale one.
        pendingPosition = { lat: position.lat, lng: position.lng };
        if (uploadTimer === null) {
          uploadTimer = setTimeout(() => {
            uploadTimer = null;
            if (pendingPosition) {
              sendPosition(pendingPosition.lat, pendingPosition.lng);
            }
          }, SERVER_UPLOAD_INTERVAL_MS - elapsed);
        }
      },
      onError: (message) => gpsErrorRef.current(message),
    });
    trackerRef.current = tracker;
    tracker.start();

    return () => {
      if (uploadTimer) clearTimeout(uploadTimer);
      uploadTimer = null;
      pendingPosition = null;
      tracker.stop();
      trackerRef.current = null;
    };
  }, [token]);

  const refreshLocation = useCallback(() => {
    trackerRef.current?.start();
  }, []);

  return { refreshLocation };
};
