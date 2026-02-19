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
  .option("-o, --output <dir>", "log output directory", "/var/log/pinger")
  .option("-I, --interface <name>", "network interface")
  .parse();

const opts = program.opts();
const HOST: string = opts.host;
const INTERVAL_MS = parseMs(opts.interval);
const SESSION_MS = parseMs(opts.session);
const DURATION_MS = parseMs(opts.duration);
const LOG_DIR: string = opts.output;
const IFACE: string | undefined = opts.interface;

// --- State ---

let sessionStart = new Date();
let stream: WriteStream;
let totalPings = 0;
let lossCount = 0;
let tickCount = 0;
let stopping = false;
let timer: ReturnType<typeof setTimeout>;
let spinner: Ora;
const startTime = Date.now();

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
  console.log("  " + crayon.bold("Output:") + "     " + LOG_DIR);
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
  console.log("  " + crayon.bold("Runtime:") + "     " + fmtDuration(runtime));
  console.log("  " + crayon.bold("Total pings:") + " " + totalPings);
  console.log("  " + crayon.bold("Packet loss:") + " " + lossCount + " (" + lossPct + "%)");
  console.log();
};

/**
 * Updates the ora spinner text with the latest ping result and running statistics.
 *
 * @param pingMs - The ping round-trip time in milliseconds, or null on failure.
 * @param packetLoss - Whether this ping resulted in packet loss.
 */
const updateSpinner = (pingMs: number | null, packetLoss: boolean) => {
  const lossPct = ((lossCount / totalPings) * 100).toFixed(1);
  const result = packetLoss || pingMs === null
    ? crayon.red("timeout")
    : crayon.green(pingMs.toFixed(1) + " ms");
  const stats = "| pings: " + totalPings + " | loss: " + lossCount + " (" + lossPct + "%)";
  spinner.text = result + "  " + crayon.lightBlack(stats);
};

/**
 * Gracefully shuts down the application. Stops the tick timer and spinner,
 * closes the CSV stream, prints a summary, and exits the process.
 */
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  spinner.stop();
  try { stream.close(); } catch {}
  printSummary();
  process.exit(0);
};

/**
 * Rotates the CSV session file if the current session has exceeded the configured duration.
 * Closes the current stream and opens a new one with an updated timestamp.
 *
 * @param now - The current time to check against the session start.
 */
const rotateSessionIfNeeded = (now: Date) => {
  const elapsed = now.getTime() - sessionStart.getTime();
  if (elapsed >= SESSION_MS) {
    try { stream.close(); } catch {}
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

  const csv = fmtDate(pingTime) + ";" + fmtTime(pingTime) + ";" + toDecimalComma(pingMs) + ";" + (packetLoss ? "true" : "false") + "\n";
  stream.write(csv);

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

mkdirSync(LOG_DIR, { recursive: true });
printBanner();
stream = openNewCsvStream(sessionStart);
spinner = ora({ text: "Pinging " + HOST + "...", spinner: "dots" }).start();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

tick();
