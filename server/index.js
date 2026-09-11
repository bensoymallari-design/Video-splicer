import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import express from "express";
import multer from "multer";
import { WebSocketServer } from "ws";
import { createStore } from "./store.js";
import { createShow } from "./show.js";
import { createSimulator } from "./simulator.js";
import { probeTcp, sendCommand } from "./transport.js";
import { eyeSaverBrightness, takeMap } from "./routing.js";
import {
  INPUTS,
  MODELS,
  recallPreset,
  set3D,
  set3DEye,
  setBlackout,
  setBrightness,
  setControllerMode,
  setFreeze,
  setLayerSource,
  setLowLatency,
  setNormalDisplay,
  setSendingCardDisplay,
} from "./protocol.js";

const PORT = Number(process.env.PORT) || 8787;
const MEDIA_DIR = path.join(process.cwd(), "data", "media");
fs.mkdirSync(MEDIA_DIR, { recursive: true });
const store = createStore();
const show = createShow();
const simulators = new Map();
const clients = new Set();

function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload, at: Date.now() });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(message);
  }
}

function projectPayload() {
  return {
    ...store.snapshot(),
    show: show.snapshot(),
    models: MODELS,
    inputs: INPUTS,
    lab: {
      running: simulators.size > 0,
      count: simulators.size,
    },
  };
}

function broadcastClock() {
  broadcast("clock", show.snapshot());
}

async function saveAndBroadcast() {
  await store.persist();
  broadcast("project", projectPayload());
  return projectPayload();
}

function inputTuple(key) {
  return INPUTS[key] || INPUTS.HDMI;
}

async function dispatch(controller, packet) {
  try {
    const result = await sendCommand(
      controller.host,
      controller.port,
      packet,
      controller.transport,
    );
    controller.online = true;
    controller.lastError = null;
    return result;
  } catch (err) {
    controller.online = false;
    controller.lastError = err.message;
    throw err;
  }
}

async function applyControllerCommand(controller, command) {
  switch (command.type) {
    case "brightness": {
      const value = Math.round((Number(command.value) / 100) * 255);
      await dispatch(controller, setBrightness(value));
      controller.brightness = Math.max(0, Math.min(255, value));
      break;
    }
    case "blackout":
      await dispatch(controller, setBlackout(true));
      controller.display = "blackout";
      controller.freeze = false;
      break;
    case "normal":
      await dispatch(controller, setNormalDisplay());
      controller.display = "normal";
      controller.freeze = false;
      break;
    case "freeze":
      await dispatch(controller, setFreeze(true));
      controller.display = "freeze";
      controller.freeze = true;
      break;
    case "unfreeze":
      await dispatch(controller, setFreeze(false));
      controller.freeze = false;
      if (controller.display === "freeze") controller.display = "normal";
      break;
    case "input": {
      const key = command.inputKey in INPUTS ? command.inputKey : "HDMI";
      const src = inputTuple(key);
      await dispatch(controller, setLayerSource(1, src.card, src.iface));
      controller.inputKey = key;
      break;
    }
    case "lowLatency":
      await dispatch(controller, setLowLatency(Boolean(command.on)));
      controller.lowLatency = Boolean(command.on);
      break;
    case "mode3d":
      await dispatch(controller, set3D(Boolean(command.on)));
      controller.mode3d = Boolean(command.on);
      break;
    case "controllerMode":
      await dispatch(controller, setControllerMode(command.mode));
      break;
    case "preset":
    case "hardwarePreset": {
      const index = Number(command.index) || 1;
      await dispatch(controller, recallPreset(index));
      controller.hardwarePreset = index;
      break;
    }
    case "eye3d":
      await dispatch(controller, set3DEye(command.eye === "left" ? "left" : "right"));
      break;
    case "sendingDisplay":
      await dispatch(
        controller,
        setSendingCardDisplay(command.card || "all", command.mode || "normal"),
      );
      if (command.mode === "blackout") {
        controller.display = "blackout";
        controller.freeze = false;
      } else if (command.mode === "freeze") {
        controller.display = "freeze";
        controller.freeze = true;
      } else {
        controller.display = "normal";
        controller.freeze = false;
      }
      break;
    case "testPattern":
      controller.testPattern = Boolean(command.on);
      break;
    default:
      throw new Error(`Unknown command ${command.type}`);
  }
}

async function commandMany(ids, command) {
  const targets = ids?.length
    ? store.project.controllers.filter((c) => ids.includes(c.id))
    : store.project.controllers;
  const results = [];
  for (const controller of targets) {
    try {
      await applyControllerCommand(controller, command);
      results.push({ id: controller.id, ok: true });
    } catch (err) {
      results.push({ id: controller.id, ok: false, error: err.message });
    }
  }
  return results;
}

async function stopLab() {
  const pending = [...simulators.values()].map((sim) => sim.close());
  simulators.clear();
  store.project.controllers = store.project.controllers.filter((c) => !c.simulated);
  await Promise.all(pending);
}

async function startLab(count = 4) {
  await stopLab();
  const n = Math.max(2, Math.min(12, Number(count) || 4));
  store.project.canvas = {
    width: n <= 3 ? n * 3840 : n <= 4 ? 7680 : 11520,
    height: n <= 3 ? 2160 : n <= 6 ? 4320 : 6480,
    background: "#05070b",
  };
  for (let i = 0; i < n; i += 1) {
    const sim = await createSimulator({
      host: "127.0.0.1",
      port: 15200 + i,
      name: `MCTRL4K-${i + 1}`,
      model: "MCTRL4K",
    });
    simulators.set(sim.port, sim);
    const controller = store.addController({
      name: sim.name,
      model: "MCTRL4K",
      host: sim.host,
      port: sim.port,
      simulated: true,
    });
    controller.online = true;
  }
  store.autoLayout(n === 4 ? "2x2" : n === 6 ? "2x3" : "1xN");
  if (!store.project.layers.length) {
    store.addLayer({
      name: "Program",
      x: 0,
      y: 0,
      width: store.project.canvas.width,
      height: store.project.canvas.height,
      source: "HDMI",
    });
  }
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "video-splicer", port: PORT });
});

app.get("/api/project", (_req, res) => {
  res.json(projectPayload());
});

app.use("/media", express.static(MEDIA_DIR, { acceptRanges: true }));

const upload = multer({
  storage: multer.diskStorage({
    destination: MEDIA_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "") || ".bin";
      cb(null, `${Date.now()}-${randomUUID()}${ext.toLowerCase()}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});

app.use((req, res, next) => {
  if (req.method === "GET") return next();
  if (!store.project.locked) return next();
  if (req.path === "/api/settings" && req.body?.locked === false) return next();
  if (req.path.startsWith("/api/lab")) return next();
  if (req.path.startsWith("/api/show")) return next();
  return res.status(423).json({ error: "Screen is locked" });
});

app.post("/api/controllers", async (req, res) => {
  try {
    const { host, port, name, model, transport } = req.body || {};
    if (!host) return res.status(400).json({ error: "host is required" });
    const controller = store.addController({ host, port, name, model, transport });
    controller.online = await probeTcp(controller.host, controller.port, 1200);
    const payload = await saveAndBroadcast();
    res.json({ controller, project: payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/controllers/:id", async (req, res) => {
  store.removeController(req.params.id);
  res.json(await saveAndBroadcast());
});

app.patch("/api/controllers/:id", async (req, res) => {
  const controller = store.getController(req.params.id);
  if (!controller) return res.status(404).json({ error: "not found" });
  const { name, viewport, host, port, model, brightness, backupId, edid } = req.body || {};
  if (name) controller.name = name;
  if (host) controller.host = host;
  if (port) controller.port = Number(port);
  if (model && MODELS[model]) controller.model = model;
  if (viewport) controller.viewport = { ...controller.viewport, ...viewport };
  if (Number.isFinite(brightness)) controller.brightness = brightness;
  if (backupId !== undefined) controller.backupId = backupId || null;
  if (edid) {
    controller.edid = { ...controller.edid, ...edid };
    if (edid.width && edid.height) {
      controller.viewport = {
        ...controller.viewport,
        width: Number(edid.width),
        height: Number(edid.height),
      };
    }
  }
  res.json(await saveAndBroadcast());
});

app.post("/api/controllers/:id/probe", async (req, res) => {
  const controller = store.getController(req.params.id);
  if (!controller) return res.status(404).json({ error: "not found" });
  controller.online = await probeTcp(controller.host, controller.port, 1500);
  res.json(await saveAndBroadcast());
});

app.post("/api/controllers/:id/command", async (req, res) => {
  const controller = store.getController(req.params.id);
  if (!controller) return res.status(404).json({ error: "not found" });
  try {
    await applyControllerCommand(controller, req.body || {});
    res.json(await saveAndBroadcast());
  } catch (err) {
    res.status(502).json({ error: err.message, project: projectPayload() });
  }
});

app.post("/api/group/command", async (req, res) => {
  const { ids, command } = req.body || {};
  const results = await commandMany(ids, command || {});
  res.json({ results, project: await saveAndBroadcast() });
});

app.post("/api/layout", async (req, res) => {
  store.autoLayout(req.body?.pattern || "auto");
  if (req.body?.canvas) {
    store.project.canvas = { ...store.project.canvas, ...req.body.canvas };
  }
  res.json(await saveAndBroadcast());
});

app.post("/api/layers", async (req, res) => {
  const layer = store.addLayer(req.body || {});
  res.json({ layer, project: await saveAndBroadcast() });
});

app.patch("/api/layers/:id", async (req, res) => {
  const layer = store.project.layers.find((item) => item.id === req.params.id);
  if (!layer) return res.status(404).json({ error: "not found" });
  Object.assign(layer, req.body || {});
  res.json(await saveAndBroadcast());
});

app.delete("/api/layers/:id", async (req, res) => {
  store.project.layers = store.project.layers.filter((item) => item.id !== req.params.id);
  res.json(await saveAndBroadcast());
});

app.post("/api/presets", async (req, res) => {
  const preset = store.addPreset(req.body?.name);
  res.json({ preset, project: await saveAndBroadcast() });
});

app.post("/api/presets/:id/apply", async (req, res) => {
  const preset = store.applyPreset(req.params.id);
  if (!preset) return res.status(404).json({ error: "not found" });
  const results = [];
  for (const controller of store.project.controllers) {
    try {
      await applyControllerCommand(controller, {
        type: "brightness",
        value: Math.round((controller.brightness / 255) * 100),
      });
      if (controller.display === "blackout") {
        await applyControllerCommand(controller, { type: "blackout" });
      } else if (controller.freeze) {
        await applyControllerCommand(controller, { type: "freeze" });
      } else {
        await applyControllerCommand(controller, { type: "normal" });
      }
      await applyControllerCommand(controller, {
        type: "input",
        inputKey: controller.inputKey,
      });
      results.push({ id: controller.id, ok: true });
    } catch (err) {
      results.push({ id: controller.id, ok: false, error: err.message });
    }
  }
  res.json({ preset, results, project: await saveAndBroadcast() });
});

app.delete("/api/presets/:id", async (req, res) => {
  store.project.presets = store.project.presets.filter((p) => p.id !== req.params.id);
  res.json(await saveAndBroadcast());
});

app.post("/api/lab/start", async (req, res) => {
  try {
    await startLab(req.body?.count ?? 4);
    res.json(await saveAndBroadcast());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/lab/stop", async (req, res) => {
  await stopLab();
  res.json(await saveAndBroadcast());
});

app.post("/api/master-brightness", async (req, res) => {
  const value = Math.max(0, Math.min(100, Number(req.body?.value) || 0));
  store.project.masterBrightness = value;
  const results = await commandMany(null, { type: "brightness", value });
  res.json({ results, project: await saveAndBroadcast() });
});

app.post("/api/take", async (req, res) => {
  const routes = takeMap(store.project);
  const results = [];
  for (const route of routes) {
    try {
      const controller = store.getController(route.controllerId);
      await applyControllerCommand(controller, { type: "input", inputKey: route.inputKey });
      results.push({ ...route, ok: true });
    } catch (err) {
      results.push({ ...route, ok: false, error: err.message });
    }
  }
  res.json({ results, project: await saveAndBroadcast() });
});

app.post("/api/ftb", async (req, res) => {
  const active = req.body?.active !== false;
  store.project.ftb.active = active;
  store.project.ftb.ms = Math.max(0, Number(req.body?.ms) || store.project.ftb.ms);
  const results = await commandMany(null, { type: active ? "blackout" : "normal" });
  res.json({ results, project: await saveAndBroadcast() });
});

app.post("/api/settings", async (req, res) => {
  const body = req.body || {};
  if (typeof body.locked === "boolean") store.project.locked = body.locked;
  if (typeof body.eyeSaver === "boolean") {
    store.project.eyeSaver = body.eyeSaver;
    const value = body.eyeSaver
      ? eyeSaverBrightness(store.project.masterBrightness)
      : store.project.masterBrightness;
    await commandMany(null, { type: "brightness", value });
  }
  if (body.color) store.project.color = { ...store.project.color, ...body.color };
  if (body.osd) store.project.osd = { ...store.project.osd, ...body.osd };
  if (body.canvas) store.project.canvas = { ...store.project.canvas, ...body.canvas };
  if (Array.isArray(body.sources)) store.project.sources = body.sources;
  if (body.playlist) store.project.playlist = { ...store.project.playlist, ...body.playlist };
  if (body.name) store.project.name = body.name;
  res.json(await saveAndBroadcast());
});

app.post("/api/playlist/add", async (req, res) => {
  const id = req.body?.presetId || store.addPreset(req.body?.name).id;
  if (!store.project.playlist.ids.includes(id)) store.project.playlist.ids.push(id);
  res.json(await saveAndBroadcast());
});

app.post("/api/playlist/next", async (req, res) => {
  const ids = store.project.playlist.ids;
  if (!ids.length) return res.status(400).json({ error: "Playlist is empty" });
  const cursor = (store.project.playlist.cursor + 1) % ids.length;
  store.project.playlist.cursor = cursor;
  const preset = store.applyPreset(ids[cursor]);
  const results = [];
  for (const controller of store.project.controllers) {
    try {
      await applyControllerCommand(controller, {
        type: "input",
        inputKey: controller.inputKey,
      });
      await applyControllerCommand(controller, {
        type: "brightness",
        value: Math.round((controller.brightness / 255) * 100),
      });
      results.push({ id: controller.id, ok: true });
    } catch (err) {
      results.push({ id: controller.id, ok: false, error: err.message });
    }
  }
  res.json({ preset, results, project: await saveAndBroadcast() });
});

app.post("/api/project/import", async (req, res) => {
  store.replace(req.body || {});
  res.json(await saveAndBroadcast());
});

app.get("/api/project/export", (_req, res) => {
  res.setHeader("Content-Disposition", "attachment; filename=lumen-splice-project.json");
  res.json(store.snapshot());
});

app.post("/api/media", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  const mime = req.file.mimetype || "";
  const kind = mime.startsWith("image/") ? "image" : "video";
  const item = store.addMedia({
    name: req.file.originalname || req.file.filename,
    kind,
    filename: req.file.filename,
  });
  store.addClip({ mediaId: item.id });
  res.json({ media: item, project: await saveAndBroadcast() });
});

app.delete("/api/media/:id", async (req, res) => {
  const item = store.removeMedia(req.params.id);
  if (item?.filename) {
    fs.unlink(path.join(MEDIA_DIR, item.filename), () => {});
  }
  res.json(await saveAndBroadcast());
});

app.post("/api/clips", async (req, res) => {
  try {
    const clip = store.addClip(req.body || {});
    res.json({ clip, project: await saveAndBroadcast() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete("/api/clips/:id", async (req, res) => {
  store.removeClip(req.params.id);
  res.json(await saveAndBroadcast());
});

app.post("/api/show/play", async (_req, res) => {
  const clock = show.play();
  broadcastClock();
  res.json({ show: clock, project: projectPayload() });
});

app.post("/api/show/pause", (_req, res) => {
  const clock = show.pause();
  broadcastClock();
  res.json({ show: clock });
});

app.post("/api/show/stop", (_req, res) => {
  const clock = show.stop();
  broadcastClock();
  res.json({ show: clock });
});

const dist = path.join(process.cwd(), "web", "dist");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "project", payload: projectPayload() }));
  ws.send(JSON.stringify({ type: "clock", payload: show.snapshot() }));
  ws.on("close", () => clients.delete(ws));
});

setInterval(() => {
  if (show.snapshot().playing) broadcastClock();
}, 250);

await store.load();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Video splicer listening on http://127.0.0.1:${PORT}`);
});

process.on("SIGINT", async () => {
  await stopLab();
  server.close();
  process.exit(0);
});
