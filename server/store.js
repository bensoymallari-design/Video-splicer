import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MODELS, INPUTS } from "./protocol.js";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "project.json");

export function defaultSources() {
  return Object.entries(INPUTS).map(([key, value]) => ({
    key,
    label: value.label,
  }));
}

export function emptyProject() {
  return {
    name: "Main wall",
    canvas: { width: 7680, height: 2160, background: "#05070b" },
    controllers: [],
    layers: [],
    presets: [],
    sources: defaultSources(),
    masterBrightness: 80,
    locked: false,
    eyeSaver: false,
    ftb: { active: false, ms: 400 },
    color: { contrast: 100, saturation: 100, hue: 0, gamma: 1.0 },
    osd: {
      enabled: false,
      text: "LUMEN SPLICE",
      kind: "text",
      position: "top",
      speed: 40,
    },
    playlist: { ids: [], intervalSec: 8, running: false, cursor: 0 },
    media: [],
    clips: [],
    updatedAt: new Date().toISOString(),
  };
}

function mergeProject(raw) {
  const base = emptyProject();
  return {
    ...base,
    ...raw,
    canvas: { ...base.canvas, ...(raw.canvas || {}) },
    color: { ...base.color, ...(raw.color || {}) },
    osd: { ...base.osd, ...(raw.osd || {}) },
    ftb: { ...base.ftb, ...(raw.ftb || {}) },
    playlist: { ...base.playlist, ...(raw.playlist || {}) },
    media: raw.media || [],
    clips: raw.clips || [],
    sources: Array.isArray(raw.sources) && raw.sources.length ? raw.sources : base.sources,
    controllers: raw.controllers || [],
    layers: raw.layers || [],
    presets: raw.presets || [],
  };
}

export function createStore() {
  let project = emptyProject();

  async function load() {
    try {
      const raw = await fs.readFile(FILE, "utf8");
      project = mergeProject(JSON.parse(raw));
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
      hardwarePreset: 1,
      backupId: null,
      testPattern: false,
      edid: { width: tileW, height: tileH, refresh: 60 },
      portsUp: spec.ethernetPorts,
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
      controllerIds: (layer.controllerIds || []).filter((cid) => cid !== id),
    }));
    for (const controller of project.controllers) {
      if (controller.backupId === id) controller.backupId = null;
    }
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
      opacity: 100,
      kind: input.kind || "video",
      z: project.layers.length + 1,
      controllerIds: input.controllerIds || project.controllers.map((c) => c.id),
    };
    project.layers.push(layer);
    return layer;
  }

  function snapshotLooks() {
    return {
      canvas: structuredClone(project.canvas),
      controllers: project.controllers.map((c) => ({
        id: c.id,
        brightness: c.brightness,
        display: c.display,
        freeze: c.freeze,
        inputKey: c.inputKey,
        viewport: { ...c.viewport },
        hardwarePreset: c.hardwarePreset,
        testPattern: c.testPattern,
      })),
      layers: structuredClone(project.layers),
      masterBrightness: project.masterBrightness,
      color: structuredClone(project.color),
      osd: structuredClone(project.osd),
      eyeSaver: project.eyeSaver,
    };
  }

  function addPreset(name) {
    const preset = {
      id: randomUUID(),
      name: name || `Look ${project.presets.length + 1}`,
      savedAt: new Date().toISOString(),
      snapshot: snapshotLooks(),
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
    if (snap.color) project.color = { ...project.color, ...snap.color };
    if (snap.osd) project.osd = { ...project.osd, ...snap.osd };
    if (typeof snap.eyeSaver === "boolean") project.eyeSaver = snap.eyeSaver;
    for (const saved of snap.controllers || []) {
      const live = project.controllers.find((c) => c.id === saved.id);
      if (!live) continue;
      live.brightness = saved.brightness;
      live.display = saved.display;
      live.freeze = saved.freeze;
      live.inputKey = saved.inputKey;
      live.viewport = { ...saved.viewport };
      if (saved.hardwarePreset) live.hardwarePreset = saved.hardwarePreset;
      if (typeof saved.testPattern === "boolean") live.testPattern = saved.testPattern;
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
      controller.edid = { width, height, refresh: controller.edid?.refresh || 60 };
    });
  }

  function replace(next) {
    project = mergeProject(next);
  }

  function addMedia(input) {
    const item = {
      id: randomUUID(),
      name: input.name,
      kind: input.kind || "video",
      filename: input.filename,
      url: `/media/${input.filename}`,
    };
    project.media.push(item);
    return item;
  }

  function addClip(input = {}) {
    const media = project.media.find((item) => item.id === input.mediaId) || project.media[0];
    if (!media) {
      const err = new Error("Load a video or image first");
      err.status = 400;
      throw err;
    }
    const clip = {
      id: randomUUID(),
      mediaId: media.id,
      name: input.name || media.name,
      x: input.x ?? (project.clips.length % 4) * 120,
      y: input.y ?? Math.floor(project.clips.length / 4) * 80,
      width: input.width ?? 1920,
      height: input.height ?? 1080,
      z: project.clips.length + 1,
      start: Number(input.start) || 0,
      duration: Number(input.duration) || 10,
    };
    project.clips.push(clip);
    return clip;
  }

  function removeMedia(id) {
    const item = project.media.find((m) => m.id === id);
    project.media = project.media.filter((m) => m.id !== id);
    project.clips = project.clips.filter((c) => c.mediaId !== id);
    return item;
  }

  function removeClip(id) {
    project.clips = project.clips.filter((c) => c.id !== id);
  }

  function assertUnlocked() {
    if (project.locked) {
      const err = new Error("Screen is locked");
      err.status = 423;
      throw err;
    }
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
    addClip,
    addMedia,
    removeClip,
    removeMedia,
    replace,
    assertUnlocked,
    get project() {
      return project;
    },
  };
}
