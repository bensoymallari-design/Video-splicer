# Lumen Splice

Laptop control desk for NovaStar LED senders (MCTRL4K and compatible). It speaks **IP only** — TCP port **5200** or UDP port **5201** — using NovaStar’s published [Central Control Protocol](https://www.novastar.tech) so you can run **2–6 or more** controllers from a browser instead of sitting at an H9 splicer.

## What this replaces — and what it does not

The H9 is two machines in one: an FPGA **video splicer** and a **sending-card** system. A laptop can take over the second job (unified control of several MCTRL4K units). It cannot take over the first job unless the laptop GPU (or another matrix) is already feeding HDMI/DP/DVI into those senders.

Use this app when:

- Each MCTRL4K already has a video input (GPU outputs, a small matrix, or playback machines).
- You want one H9-style canvas: tile senders, group brightness, freeze/blackout, input routing, and presets.
- You would rather not roll the H9 rack just to change looks.

Some of it **can** be added. The H9 FPGA video engine **cannot**.

This desk now includes the control-side H9 features that fit on a laptop: Take (layer-to-sender routing), FTB, lock, eye saver, OSD preview, color preview, input matrix, hardware presets P1–P8, EDID/viewport size, backup pairing, Ethernet port map, look playlist, and project import/export.

It still does **not** ingest HDMI/SDI, mix real layers on the LED, or emit cabinet Ethernet. Those need hardware. Color/OSD are previewed on the desk; senders only receive the published IP commands (brightness, freeze, blackout, input, presets).

### Watchout-style playback on this PC

Dataton Watchout is a media server: it **plays files** and **splits them across displays**. This app now has a smaller version of that:

1. **Load media** (mp4 / webm / image) onto the stage.
2. **Open displays** — one window per MCTRL4K, cropped to that sender’s viewport.
3. Drag each window onto the PC screen that is HDMI/DP-cabled into that controller.
4. **Play** — both windows share one clock so they run together.

That is still **not** Watchout, and video still does **not** go to the MCTRL4K over IP. The PC GPU outputs the picture; this app syncs the crops and still controls the senders on the LAN.

## Quick start

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

### Try it without hardware

1. Click **Lab 4× MCTRL4K** (or **Lab 6**).
2. Four (or six) local simulators bind on `127.0.0.1:15200+`.
3. Drag tiles on the canvas, change brightness, freeze, blackout, and save a look.

### Talk to real senders

1. Put the laptop on the same LAN as the controllers.
2. **Add by IP** — default TCP `5200` (UDP `5201` is also available).
3. Tile the wall with **1×N / 2×2 / 2×3**, then use master brightness / Live / Freeze / Blackout.

MCTRL4K loading is treated as **4096×2160@60** (max width or height 7680). The inspector warns if a viewport is oversized.

## Protocol

Packets follow NovaStar Central Control Protocol V1.5.0:

`[0x55 0xAA][content][checksum]` with `checksum = sum(content) + 0x5555` (little-endian).

Implemented writes:

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

Firmware differences exist between MCTRL-generation senders and newer COEX boxes. If a box ignores a command, use **Probe IP** and confirm TCP 5200 is open; the device web UI is still available at `http://<ip>/`.

## Production build

```bash
npm test
npm run build
npm start
```

Serves the UI and API together on port **8787**.

Project state is stored in `data/project.json`.
