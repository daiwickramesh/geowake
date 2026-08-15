/**
 * Calculates the great-circle distance between two GPS coordinates (lat1, lon1) and (lat2, lon2)
 * using the Haversine formula.
 * Returns distance in METERS.
 */
export function calculateDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const EARTH_RADIUS_METERS = 6371000; // Earth's mean radius

  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}
