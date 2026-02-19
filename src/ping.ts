import { spawn } from "bun";
import { parsePingTimeMs } from "./parse.ts";

const IS_MACOS = process.platform === "darwin";
const PING_BIN = IS_MACOS ? "/sbin/ping" : "/bin/ping";

/**
 * Executes a single ping to the specified host using the system ping command.
 * Sends one packet with a 2-second timeout.
 *
 * @param host - The target host to ping.
 * @param iface - Optional network interface to bind to.
 *
 * @returns The round-trip time in milliseconds, or null on failure/timeout.
 */
export const doPing = async (host: string, iface?: string): Promise<number | null> => {
  const args = IS_MACOS
    ? ["-c", "1", "-t", "2", host]
    : ["-n", "-c", "1", "-w", "2", host];
  if (iface && iface.trim().length > 0) {
    args.unshift("-I", iface.trim());
  }
  const proc = spawn({
    cmd: [PING_BIN, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });

  const out = await new Response(proc.stdout).text();
  const ok = (await proc.exited) === 0;
  if (!ok) return null;

  return parsePingTimeMs(out);
};
