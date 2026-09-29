import { isValidCoordinate } from "../config";

export interface Position {
  lat: number;
  lng: number;
}

interface LocationCallbacks {
  onPosition: (position: Position) => void;
  onError: (message: string) => void;
}

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 3000,
  timeout: 10000,
};

/**
 * Owns a single `navigator.geolocation` watcher.
 *
 * `start()` is idempotent: calling it again (e.g. when the user taps the GPS
 * pill) never creates a second watcher, and `stop()` always clears the current
 * one, so GPS resources cannot leak.
 */
export class LocationTracker {
  private watchId: number | null = null;
  private readonly callbacks: LocationCallbacks;

  constructor(callbacks: LocationCallbacks) {
    this.callbacks = callbacks;
  }

  static get isSupported(): boolean {
    return typeof navigator !== "undefined" && "geolocation" in navigator;
  }

  isWatching(): boolean {
    return this.watchId !== null;
  }

  start(): void {
    if (!LocationTracker.isSupported) {
      this.callbacks.onError("GPS is not available in this browser.");
      return;
    }
    if (this.watchId !== null) {
      // Already tracking: just refresh the fix so the user sees an update.
      navigator.geolocation.getCurrentPosition(
        (position) => this.handle(position),
        () => this.callbacks.onError("GPS permission denied."),
        WATCH_OPTIONS,
      );
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handle(position),
      (error) => {
        // Only surface transient accuracy problems; a permission denial is
        // reported once and the watcher is torn down.
        if (error.code === error.PERMISSION_DENIED) {
          this.stop();
          this.callbacks.onError("GPS permission denied.");
        } else {
          this.callbacks.onError("GPS signal lost.");
        }
      },
      WATCH_OPTIONS,
    );

    navigator.geolocation.getCurrentPosition(
      (position) => this.handle(position),
      () => this.callbacks.onError("Waiting for a GPS fix…"),
      WATCH_OPTIONS,
    );
  }

  stop(): void {
    if (this.watchId === null) return;
    try {
      navigator.geolocation.clearWatch(this.watchId);
    } catch {
      /* ignore */
    }
    this.watchId = null;
  }

  private handle(position: GeolocationPosition): void {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    if (!isValidCoordinate(lat, lng)) {
      this.callbacks.onError("Received an invalid GPS fix.");
      return;
    }
    this.callbacks.onPosition({ lat, lng });
  }
}
