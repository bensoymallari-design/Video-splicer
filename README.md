# Lumen Splice

Watchout-inspired **production desk** for a laptop: load media, place cues on a stage, crop them across display windows, and talk to NovaStar LED controllers over **IP control** (TCP **5200** / UDP **5201**).

This is **not** Dataton Watchout, and it is **not** an H9 video splicer.

## What it is

- **Media bin** — load videos and images.
- **Stage** — place cues, drag and resize them.
- **Displays** — each controller (or lab simulator) is a viewport on the stage.
- **Timeline** — shared playhead; Play / Pause / Stop / GO; click the ruler to seek.
- **Display windows** — one popup per display, cropped to that viewport. Drag each window onto the PC screen that is HDMI/DP-cabled into that sender.
- **Controller control** — brightness, freeze, blackout, probe, using NovaStar Central Control Protocol V1.5.0. That protocol is shared across NovaStar senders, not tied to one model.

## What it is not

- Video does **not** go to a controller over Ethernet. The GPU still has to output HDMI/DP into each sender.
- No Watchout clustering, showfile compatibility, or Dataton license.
- No H9 FPGA ingest/mix: this app cannot take HDMI/SDI/NDI in and splice it for the wall.
- Firmware still varies. If a box ignores a command, probe TCP 5200 and use the device web UI at `http://<ip>/`.

## Quick start

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

1. **Lab 4** (or Lab 6) to create local display simulators on `127.0.0.1:15200+`.
2. **Load media…** into the bin, then **+ Stage**.
3. **Open display windows** and Play.

Real controllers: same LAN, **Add** by IP (TCP `5200`). Brightness / freeze / blackout in the display inspector are control-only.

## Many GPU outputs (HDMI / DP / USB-C)

This is the Watchout-style path on **one PC** with capture/output cards:

1. Windows/macOS must see each card as an extended desktop screen.
2. Keep the production desk on the laptop panel.
3. Click **Place on outputs** — one fullscreen window per extra screen, cropped to that display’s viewport.
4. Cable those GPU outputs into the NovaStar senders. Press **F** in a window if it is not already fullscreen.

That does **not** clone Dataton Watchout. No clustering of other PCs, warp, edge blend, audio cues, or `.watch` files. Those are separate products. Video still leaves this GPU over the cable, not over Ethernet to the sender.

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
