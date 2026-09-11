# Lumen Splice

Watchout-inspired **production desk** for a laptop: load media, place cues on a stage, crop them across display windows, and still talk to NovaStar LED senders (MCTRL4K and compatible) over **IP control** (TCP **5200** / UDP **5201**).

This is **not** Dataton Watchout, and it is **not** an H9 video splicer.

## What it is

- **Media bin** — load videos and images.
- **Stage** — place cues, drag and resize them.
- **Displays** — each MCTRL (or lab simulator) is a viewport on the stage.
- **Timeline** — shared playhead; Play / Pause / Stop / GO; click the ruler to seek.
- **Display windows** — one popup per display, cropped to that viewport. Drag each window onto the PC screen that is HDMI/DP-cabled into that sender.
- **Sender control** — brightness, freeze, blackout, probe, still using NovaStar Central Control Protocol V1.5.0.

## What it is not

- Video does **not** go to an MCTRL over Ethernet. The GPU still has to output HDMI/DP into each sender.
- No Watchout clustering, showfile compatibility, or Dataton license.
- No H9 FPGA ingest/mix: this app cannot take HDMI/SDI/NDI in and splice it for the wall.

## Quick start

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

1. **Lab 4** (or Lab 6) to create local display simulators on `127.0.0.1:15200+`.
2. **Load media…** into the bin, then **+ Stage**.
3. **Open display windows** and Play.

Real senders: same LAN, **Add** by IP (TCP `5200`). Brightness / freeze / blackout in the display inspector are control-only.

## Protocol

Packets follow NovaStar Central Control Protocol V1.5.0:

`[0x55 0xAA][content][checksum]` with `checksum = sum(content) + 0x5555` (little-endian).

| Function | Register (wire) |
| --- | --- |
| Brightness | `0x02000001` |
| Blackout / normal | `0x02000100` |
| Freeze | `0x02000102` |
| Preset recall | `0x0a000002` |
| Low latency | `0x10000111` |
| 3D | `0x10000116` |
| Controller mode | `0x0008fff2` |
| Layer source | `0x0a000003` |

## Production build

```bash
npm test
npm run build
npm start
```

Serves the UI and API together on port **8787**. Project state is in `data/project.json`; uploaded files live in `data/media/`.
