/**
 * Parses a time string with an optional unit suffix into milliseconds.
 * Supported units: ms, s, m, h. A bare number is treated as milliseconds.
 * Exits the process with an error message if the input is invalid.
 *
 * @param input - The time string to parse (e.g. "500", "2s", "5m", "1.5h").
 *
 * @returns The parsed time in milliseconds.
 */
export const parseMs = (input: string): number => {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(input.trim());
  if (!match) {
    console.error('Invalid time value: "' + input + '". Use a number with optional unit (ms, s, m, h).');
    process.exit(1);
  }
  const val = Number.parseFloat(match[1]);
  switch (match[2]?.toLowerCase()) {
    case "h":  return val * 3_600_000;
    case "m":  return val * 60_000;
    case "s":  return val * 1_000;
    case "ms":
    default:   return val;
  }
};

/**
 * Parses the round-trip time from ping command stdout.
 * Looks for the "time=XX.Y ms" pattern in the output.
 *
 * @param pingStdout - The stdout output from the ping command.
 *
 * @returns The ping time in milliseconds, or null if not found or invalid.
 */
export const parsePingTimeMs = (pingStdout: string): number | null => {
  const m = /time=([\d.]+)\s*ms/.exec(pingStdout);
  if (!m) return null;
  const val = Number(m[1]);
  return Number.isFinite(val) ? val : null;
};
