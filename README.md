# @aleksikallio/pinger

Continuous ping logger with rotating CSV output and a modern terminal UI.

## Quick Start

```bash
npx @aleksikallio/pinger -H 8.8.8.8
```

## Installation

```bash
# Global install with bun
bun install -g @aleksikallio/pinger

# Or with npm
npm install -g @aleksikallio/pinger
```

## Options

| Short | Long                 | Description                   | Default           |
| ----- | -------------------- | ----------------------------- | ----------------- |
| `-H`  | `--host <addr>`      | Ping target                   | `8.8.8.8`         |
| `-i`  | `--interval <time>`  | Ping interval                 | `1s`              |
| `-s`  | `--session <time>`   | CSV file rotation interval    | `10m`             |
| `-d`  | `--duration <time>`  | Total runtime (0 = unlimited) | `0`               |
| `-o`  | `--output <dir>`     | Log output directory          | `/var/log/pinger` |
| `-I`  | `--interface <name>` | Network interface             | _(none)_          |

Time values accept a number with an optional unit: `ms`, `s`, `m`, `h`. A bare number is treated as milliseconds.

## Examples

Ping Google DNS every 2 seconds, stop after 5 minutes:

```bash
pinger -H 8.8.8.8 -i 2s -d 5m
```

Ping a local gateway on a specific interface, log to a custom directory:

```bash
pinger -H 192.168.1.1 -I eth0 -o ./logs
```

Run indefinitely with 30-minute CSV rotation:

```bash
pinger -H 1.1.1.1 -s 30m
```

## CSV Output Format

Files are written to the output directory with names like `pinger-20260219T140000.csv`. A new file is created every session interval.

Format is semicolon-delimited with no header row:

```
date;time;ping;packet_loss
```

- Time includes milliseconds (e.g. `21:58:03.142`)
- Decimal separator is comma (European format, e.g. `12,3`)
- Packet loss is `true` or `false`; ping column is empty on loss

Example rows:

```
2026-02-19;14:00:01.234;12,3;false
2026-02-19;14:00:02.235;;true
```

## Requirements

- Bun >= 1.0
- System `ping` command (`/sbin/ping` on macOS, `/bin/ping` on Linux)

## License

MIT
