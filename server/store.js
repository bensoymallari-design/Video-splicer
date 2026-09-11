import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MODELS } from "./protocol.js";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "project.json");

function emptyProject() {
  return {
    name: "Main wall",
    canvas: { width: 7680, height: 2160, background: "#05070b" },
    controllers: [],
    layers: [],
    presets: [],
    masterBrightness: 80,
    updatedAt: new Date().toISOString(),
  };
}

export function createStore() {
  let project = emptyProject();

  async function load() {
    try {
      const raw = await fs.readFile(FILE, "utf8");
      project = { ...emptyProject(), ...JSON.parse(raw) };
    } catch {
      project = emptyProject();
    }
    return snapshot();
  }

  async function persist() {
    project.updatedAt = new Date().toISOString();
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(project, null, 2));
    return snapshot();
  }

  function snapshot() {
    return structuredClone(project);
  }

  function addController(input) {
    const model = MODELS[input.model] ? input.model : "MCTRL4K";
    const spec = MODELS[model];
    const count = project.controllers.length;
    const tileW = Math.min(spec.maxWidth, 3840);
    const tileH = Math.min(spec.maxHeight, 2160);
    const controller = {
      id: randomUUID(),
      name: input.name || `${spec.label} ${count + 1}`,
      model,
      host: input.host,
      port: Number(input.port) || 5200,
      transport: input.transport === "udp" ? "udp" : "tcp",
      simulated: Boolean(input.simulated),
      online: false,
      lastError: null,
      brightness: 204,
      display: "normal",
      freeze: false,
      lowLatency: false,
      mode3d: false,
      inputKey: "HDMI",
      viewport: input.viewport || {
        x: (count % 4) * tileW,
        y: Math.floor(count / 4) * tileH,
        width: tileW,
        height: tileH,
      },
    };
    project.controllers.push(controller);
    return controller;
  }

  function getController(id) {
    return project.controllers.find((c) => c.id === id);
  }

  function removeController(id) {
    project.controllers = project.controllers.filter((c) => c.id !== id);
    project.layers = project.layers.map((layer) => ({
      ...layer,
      controllerIds: layer.controllerIds.filter((cid) => cid !== id),
    }));
  }

  function addLayer(input = {}) {
    const layer = {
      id: randomUUID(),
      name: input.name || `Layer ${project.layers.length + 1}`,
      x: input.x ?? 0,
      y: input.y ?? 0,
      width: input.width ?? Math.min(1920, project.canvas.width),
      height: input.height ?? Math.min(1080, project.canvas.height),
      source: input.source || "HDMI",
      visible: input.visible !== false,
      locked: false,
      z: project.layers.length + 1,
      controllerIds: input.controllerIds || project.controllers.map((c) => c.id),
    };
    project.layers.push(layer);
    return layer;
  }

  function addPreset(name) {
    const preset = {
      id: randomUUID(),
      name: name || `Preset ${project.presets.length + 1}`,
      savedAt: new Date().toISOString(),
      snapshot: {
        canvas: structuredClone(project.canvas),
        controllers: project.controllers.map((c) => ({
          id: c.id,
          brightness: c.brightness,
          display: c.display,
          freeze: c.freeze,
          inputKey: c.inputKey,
          viewport: { ...c.viewport },
        })),
        layers: structuredClone(project.layers),
        masterBrightness: project.masterBrightness,
      },
    };
    project.presets.push(preset);
    return preset;
  }

  function applyPreset(id) {
    const preset = project.presets.find((p) => p.id === id);
    if (!preset) return null;
    const snap = preset.snapshot;
    project.canvas = { ...project.canvas, ...snap.canvas };
    project.masterBrightness = snap.masterBrightness;
    project.layers = structuredClone(snap.layers || []);
    for (const saved of snap.controllers || []) {
      const live = project.controllers.find((c) => c.id === saved.id);
      if (!live) continue;
      live.brightness = saved.brightness;
      live.display = saved.display;
      live.freeze = saved.freeze;
      live.inputKey = saved.inputKey;
      live.viewport = { ...saved.viewport };
    }
    return preset;
  }

  function autoLayout(pattern) {
    const list = project.controllers;
    if (!list.length) return;
    const n = list.length;
    let cols = n;
    let rows = 1;
    if (pattern === "2x2") {
      cols = 2;
      rows = 2;
    } else if (pattern === "2x3") {
      cols = 3;
      rows = 2;
    } else if (pattern === "1xN") {
      cols = n;
      rows = 1;
    } else if (pattern === "Nx1") {
      cols = 1;
      rows = n;
    } else {
      cols = Math.ceil(Math.sqrt(n));
      rows = Math.ceil(n / cols);
    }
    const width = Math.round(project.canvas.width / cols);
    const height = Math.round(project.canvas.height / rows);
    list.forEach((controller, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      controller.viewport = {
        x: col * width,
        y: row * height,
        width,
        height,
      };
    });
  }

  function replace(next) {
    project = { ...emptyProject(), ...next };
  }

  return {
    load,
    persist,
    snapshot,
    addController,
    getController,
    removeController,
    addLayer,
    addPreset,
    applyPreset,
    autoLayout,
    replace,
    get project() {
      return project;
    },
  };
}
