#!/usr/bin/env bun
import { mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import { program } from "commander";
import ora, { type Ora } from "ora";
import { crayon } from "crayon.js";
import { parseMs } from "./src/parse.ts";
import { fmtDate, fmtTime, fmtTimestamp, fmtDuration, toDecimalComma } from "./src/format.ts";
import { doPing } from "./src/ping.ts";

// --- CLI setup ---

program
  .name("pinger")
  .description("Continuous ping logger with rotating CSV output")
  .version("1.0.0")
  .option("-H, --host <addr>", "ping target", "8.8.8.8")
  .option("-i, --interval <time>", "ping interval (e.g. 1000, 2s, 500ms)", "1s")
  .option("-s, --session <time>", "CSV rotation interval (e.g. 10m, 1h)", "10m")
  .option("-d, --duration <time>", "total runtime, 0 = unlimited (e.g. 5m, 1h)", "0")
  .option("-o, --output <dir>", "log output directory (logging disabled if not set)")
  .option("-I, --interface <name>", "network interface")
  .parse();

const opts = program.opts();
const HOST: string = opts.host;
const INTERVAL_MS = parseMs(opts.interval);
const SESSION_MS = parseMs(opts.session);
const DURATION_MS = parseMs(opts.duration);
const LOG_DIR: string | undefined = opts.output;
const IFACE: string | undefined = opts.interface;
const LOGGING = LOG_DIR !== undefined;

// --- State ---

let sessionStart = new Date();
let stream: WriteStream | undefined;
let totalPings = 0;
let lossCount = 0;
let tickCount = 0;
let stopping = false;
let timer: ReturnType<typeof setTimeout>;
let spinner: Ora;
const startTime = Date.now();
const pingValues: number[] = [];
const jitterValues: number[] = [];
let lastPingMs: number | null = null;

// --- Statistics ---

/**
 * Computes a percentile value from a pre-sorted array using linear interpolation.
 *
 * @param sorted - A sorted array of numbers.
 * @param p - The desired percentile (0–100).
 *
 * @returns The interpolated value at the given percentile.
 */
const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

/**
 * Computes running statistics from all collected ping and jitter values.
 *
 * @returns An object containing min, max, avg, median, p95, p99, jitter p95, and jitter p99.
 */
const computeStats = () => {
  const sorted = [...pingValues].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const med = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  let jitP95 = 0;
  let jitP99 = 0;
  if (jitterValues.length > 0) {
    const jitSorted = [...jitterValues].sort((a, b) => a - b);
    jitP95 = percentile(jitSorted, 95);
    jitP99 = percentile(jitSorted, 99);
  }

  return { min, max, avg, med, p95, p99, jitP95, jitP99 };
};

// --- Helpers ---

/**
 * Opens a new CSV write stream for the current session.
 * The filename includes a compact timestamp derived from the session start time.
 *
 * @param start - The session start time, used to generate the filename.
 *
 * @returns A writable stream for the new CSV file.
 */
const openNewCsvStream = (start: Date): WriteStream => {
  const stamp = fmtTimestamp(start);
  const file = join(LOG_DIR, "pinger-" + stamp + ".csv");
  return createWriteStream(file, { flags: "a" });
};

/**
 * Prints the startup banner showing the active configuration.
 */
const printBanner = () => {
  console.log(crayon.bold.cyan("\n  pinger v1.0.0\n"));
  console.log("  " + crayon.bold("Host:") + "       " + HOST);
  console.log("  " + crayon.bold("Interval:") + "   " + opts.interval);
  console.log("  " + crayon.bold("Session:") + "    " + opts.session);
  console.log("  " + crayon.bold("Duration:") + "   " + (DURATION_MS === 0 ? "unlimited" : opts.duration));
  console.log("  " + crayon.bold("Output:") + "     " + (LOGGING ? LOG_DIR : "disabled"));
  if (IFACE) console.log("  " + crayon.bold("Interface:") + "  " + IFACE);
  console.log();
};

/**
 * Prints a summary of the session including runtime, total pings, and packet loss.
 */
const printSummary = () => {
  const runtime = Date.now() - startTime;
  const lossPct = totalPings > 0 ? ((lossCount / totalPings) * 100).toFixed(1) : "0.0";

  console.log(crayon.bold.cyan("\n  Summary\n"));
  console.log("  " + crayon.bold("Runtime:") + "      " + fmtDuration(runtime));
  console.log("  " + crayon.bold("Total pings:") + "  " + totalPings);
  console.log("  " + crayon.bold("Packet loss:") + "  " + lossCount + " (" + lossPct + "%)");

  if (pingValues.length > 0) {
    const s = computeStats();
    console.log();
    console.log("  " + crayon.bold("Min:") + "          " + f(s.min) + " ms");
    console.log("  " + crayon.bold("Max:") + "          " + f(s.max) + " ms");
    console.log("  " + crayon.bold("Avg:") + "          " + f(s.avg) + " ms");
    console.log("  " + crayon.bold("Median:") + "       " + f(s.med) + " ms");
    console.log("  " + crayon.bold("p95:") + "          " + f(s.p95) + " ms");
    console.log("  " + crayon.bold("p99:") + "          " + f(s.p99) + " ms");
    console.log("  " + crayon.bold("Jitter p95:") + "   " + f(s.jitP95) + " ms");
    console.log("  " + crayon.bold("Jitter p99:") + "   " + f(s.jitP99) + " ms");
  }
  console.log();
};

/**
 * Formats a number to one decimal place.
 *
 * @param n - The number to format.
 *
 * @returns The number as a string with one decimal place.
 */
const f = (n: number): string => n.toFixed(1);

/**
 * Prints a per-ping output line above the spinner showing timestamp, sequence
 * number, and round-trip time. Color-coded by latency: green (&lt;50 ms),
 * yellow (&lt;100 ms), red (&ge;100 ms), or red "timeout" on packet loss.
 *
 * @param pingTime - The timestamp when the ping was initiated.
 * @param pingMs - The round-trip time in milliseconds, or null on failure/timeout.
 */
const printPingLine = (pingTime: Date, pingMs: number | null) => {
  const time = fmtTime(pingTime);
  const seq = "#" + totalPings;
  if (pingMs === null) {
    spinner.clear();
    console.log(
      crayon.lightBlack("  " + time) + "  " + crayon.lightBlack(seq.padStart(6)) + "  " + crayon.red("timeout")
    );
    spinner.render();
  } else {
    const color = pingMs < 50 ? crayon.green : pingMs < 100 ? crayon.yellow : crayon.red;
    spinner.clear();
    console.log(
      crayon.lightBlack("  " + time) + "  " + crayon.lightBlack(seq.padStart(6)) + "  " + color(f(pingMs) + " ms")
    );
    spinner.render();
  }
};

/**
 * Updates the ora spinner text with the latest ping result and running statistics.
 */
const updateSpinner = (pingMs: number | null, packetLoss: boolean) => {
  const lossPct = f((lossCount / totalPings) * 100);
  const latest = packetLoss || pingMs === null
    ? crayon.red("timeout")
    : crayon.green(f(pingMs) + " ms");

  if (pingValues.length === 0) {
    spinner.text = latest + "  " + crayon.lightBlack("| loss: " + lossCount + "/" + totalPings + " (" + lossPct + "%)");
    return;
  }

  const s = computeStats();
  spinner.text = latest + "  " + crayon.lightBlack(
    "| min: " + f(s.min) +
    " | max: " + f(s.max) +
    " | avg: " + f(s.avg) +
    " | med: " + f(s.med) +
    " | p95: " + f(s.p95) +
    " | p99: " + f(s.p99) +
    " | jit95: " + f(s.jitP95) +
    " | jit99: " + f(s.jitP99) +
    " | loss: " + lossCount + "/" + totalPings + " (" + lossPct + "%)"
  );
};

/**
 * Gracefully shuts down the application. Stops the tick timer and spinner,
 * closes the CSV stream, prints a summary, and exits the process.
 */
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  try {
    clearTimeout(timer);
    spinner.stop();
    stream?.close();
    printSummary();
  } catch {}
  process.exit(0);
};

/**
 * Rotates the CSV session file if the current session has exceeded the configured duration.
 * Closes the current stream and opens a new one with an updated timestamp.
 *
 * @param now - The current time to check against the session start.
 */
const rotateSessionIfNeeded = (now: Date) => {
  if (!LOGGING) return;
  const elapsed = now.getTime() - sessionStart.getTime();
  if (elapsed >= SESSION_MS) {
    try { stream?.close(); } catch {}
    sessionStart = now;
    stream = openNewCsvStream(sessionStart);
  }
};

/**
 * Handles the result of a completed ping. Updates counters, writes a CSV row,
 * and refreshes the spinner display.
 *
 * @param pingTime - The timestamp when the ping was initiated.
 * @param pingMs - The round-trip time in milliseconds, or null on failure/timeout.
 */
const handlePingResult = (pingTime: Date, pingMs: number | null) => {
  if (stopping) return;

  totalPings++;
  const packetLoss = pingMs === null;
  if (packetLoss) lossCount++;

  if (pingMs !== null) {
    pingValues.push(pingMs);
    if (lastPingMs !== null) {
      jitterValues.push(Math.abs(pingMs - lastPingMs));
    }
    lastPingMs = pingMs;
  }

  if (stream) {
    const csv = fmtDate(pingTime) + ";" + fmtTime(pingTime) + ";" + toDecimalComma(pingMs) + ";" + (packetLoss ? "true" : "false") + "\n";
    stream.write(csv);
  }

  printPingLine(pingTime, pingMs);
  updateSpinner(pingMs, packetLoss);
};

/**
 * Executes one tick of the ping loop. Checks the duration limit, rotates the
 * session file if needed, schedules the next tick on an absolute timeline,
 * and fires a ping concurrently.
 */
const tick = () => {
  if (stopping) return;

  if (DURATION_MS > 0 && Date.now() - startTime >= DURATION_MS) {
    shutdown();
    return;
  }

  rotateSessionIfNeeded(new Date());

  // Schedule next tick on the absolute timeline
  tickCount++;
  const nextTickAt = startTime + tickCount * INTERVAL_MS;
  const delay = Math.max(0, nextTickAt - Date.now());
  timer = setTimeout(tick, delay);

  // Fire ping concurrently — does not block next tick
  const pingTime = new Date();
  doPing(HOST, IFACE)
    .catch(() => null)
    .then((pingMs) => handlePingResult(pingTime, pingMs));
};

// --- Main ---

if (LOGGING) {
  mkdirSync(LOG_DIR!, { recursive: true });
  stream = openNewCsvStream(sessionStart);
}
printBanner();
spinner = ora({ text: "Pinging " + HOST + "...", spinner: "dots" }).start();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);

// Fallback: listen for raw Ctrl+C (0x03) on stdin in case SIGINT delivery fails
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (data: Buffer) => {
    if (data[0] === 0x03) shutdown();
  });
}

tick();
