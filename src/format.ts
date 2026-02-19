/**
 * Pads a number with leading zeros to ensure it has at least the specified length.
 *
 * @param n - The number to pad.
 * @param len - The desired length of the resulting string (default is 2).
 *
 * @returns The padded number as a string.
 */
const pad = (n: number, len = 2): string => {
  return n.toString().padStart(len, "0");
};

/**
 * Formats a date as an ISO date string (YYYY-MM-DD).
 *
 * @param d - The date to format.
 *
 * @returns The formatted date string.
 */
export const fmtDate = (d: Date): string => {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
};

/**
 * Formats a date as a time string with millisecond precision (HH:MM:SS.mmm).
 *
 * @param d - The date to extract time from.
 *
 * @returns The formatted time string.
 */
export const fmtTime = (d: Date): string => {
  return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + "." + pad(d.getMilliseconds(), 3);
};

/**
 * Formats a date as a compact timestamp suitable for filenames (YYYYMMDDTHHmmss).
 *
 * @param d - The date to format.
 *
 * @returns The compact timestamp string.
 */
export const fmtTimestamp = (d: Date): string => {
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "T" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
};

/**
 * Formats a duration in milliseconds as a human-readable string (e.g. "1h 2m 3s").
 *
 * @param ms - The duration in milliseconds.
 *
 * @returns The formatted duration string.
 */
export const fmtDuration = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return h + "h " + m + "m " + s + "s";
  if (m > 0) return m + "m " + s + "s";
  return s + "s";
};

/**
 * Converts a number to a string using a comma as the decimal separator (European format).
 * Returns an empty string if the value is null or NaN.
 *
 * @param numMs - The number to convert, or null.
 *
 * @returns The number as a string with comma decimal separator, or empty string.
 */
export const toDecimalComma = (numMs: number | null): string => {
  if (numMs === null || Number.isNaN(numMs)) return "";
  return numMs.toString().replace(".", ",");
};
