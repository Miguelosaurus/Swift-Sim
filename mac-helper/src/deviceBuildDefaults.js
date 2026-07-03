export const DEFAULT_DEVICE_BUILD_TTL_MINUTES = 120;
export const MIN_DEVICE_BUILD_TTL_MINUTES = 5;
export const MAX_DEVICE_BUILD_TTL_MINUTES = 120;

export function normalizeDeviceBuildTTLMinutes(value) {
  const parsed = Number(value);
  const minutes = Number.isFinite(parsed) ? parsed : DEFAULT_DEVICE_BUILD_TTL_MINUTES;
  return Math.max(
    MIN_DEVICE_BUILD_TTL_MINUTES,
    Math.min(MAX_DEVICE_BUILD_TTL_MINUTES, minutes)
  );
}
