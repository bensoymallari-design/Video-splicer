import { useEffect, useMemo, useRef, useState } from "react";
import { api, connectSocket } from "./api.js";

const LAYOUTS = [
  { id: "1xN", label: "1 × N" },
  { id: "Nx1", label: "N × 1" },
  { id: "2x2", label: "2 × 2" },
  { id: "2x3", label: "2 × 3" },
  { id: "auto", label: "Auto" },
];

function pixels(controller) {
  return controller.viewport.width * controller.viewport.height;
}

function capacityWarning(controller, models) {
  const spec = models?.[controller.model];
  if (!spec) return null;
  if (pixels(controller) > spec.maxPixels) {
    return `Viewport exceeds ${spec.label} loading (${spec.maxPixels.toLocaleString()} px).`;
  }
  if (controller.viewport.width > spec.maxWidth || controller.viewport.height > spec.maxHeight) {
    return `Width/height exceeds ${spec.label} max ${spec.maxWidth}×${spec.maxHeight}.`;
  }
  return null;
}

function displayLabel(controller) {
  if (controller.display === "blackout") return "BLACK";
  if (controller.freeze || controller.display === "freeze") return "FREEZE";
  return "LIVE";
}

export default function App() {
  const [project, setProject] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedLayer, setSelectedLayer] = useState(null);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [form, setForm] = useState({
    host: "192.168.0.10",
    port: 5200,
    name: "",
    model: "MCTRL4K",
    transport: "tcp",
  });

  useEffect(() => {
    api.project().then(setProject).catch((err) => setToast(err.message));
    const ws = connectSocket(setProject);
    return () => ws.close();
  }, []);

  const selected = project?.controllers.find((c) => c.id === selectedId) || null;

  async function run(fn, success) {
    setBusy(true);
    try {
      const result = await fn();
      if (result?.project) setProject(result.project);
      else if (result?.controllers) setProject(result);
      if (success) setToast(success);
      return result;
    } catch (err) {
      setToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function startLab(count) {
    const result = await run(() => api.startLab(count), `Lab started with ${count} MCTRL4K simulators`);
    if (result?.controllers?.[0]) setSelectedId(result.controllers[0].id);
  }

  if (!project) {
    return <div className="empty">Starting control desk…</div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg className="logo" viewBox="0 0 34 34" aria-hidden="true">
            <rect width="34" height="34" rx="8" fill="#121821" />
            <rect x="5" y="7" width="11" height="8" fill="#e8a23a" />
            <rect x="18" y="7" width="11" height="8" fill="#3dd68c" />
            <rect x="5" y="18" width="24" height="9" fill="#4aa3ff" />
          </svg>
          <div>
            <h1>Lumen Splice</h1>
            <small>IP controller desk</small>
          </div>
        </div>
        <div className="master">
          <label>Master brightness</label>
          <input
            type="range"
            min="0"
            max="100"
            value={project.masterBrightness}
            onChange={(e) =>
              setProject({ ...project, masterBrightness: Number(e.target.value) })
            }
            onMouseUp={(e) => run(() => api.masterBrightness(Number(e.target.value)))}
            onTouchEnd={(e) => run(() => api.masterBrightness(Number(e.target.value)))}
          />
          <span className="pct">{project.masterBrightness}%</span>
        </div>
        <div className="actions">
          <button className="btn" disabled={busy} onClick={() => run(() => api.group({ command: { type: "normal" } }), "All outputs live")}>
            Live
          </button>
          <button className="btn" disabled={busy} onClick={() => run(() => api.group({ command: { type: "freeze" } }), "All frozen")}>
            Freeze
          </button>
          <button className="btn danger" disabled={busy} onClick={() => run(() => api.group({ command: { type: "blackout" } }), "All black")}>
            Blackout
          </button>
          <button className="btn primary" disabled={busy} onClick={() => startLab(4)}>
            Lab 4× MCTRL4K
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="side">
          <div className="section-h">
            Controllers
            <span>{project.controllers.length}</span>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => setModal(true)}>Add by IP</button>
            <button className="btn" disabled={busy} onClick={() => startLab(6)}>Lab 6</button>
            {project.lab?.running ? (
              <button className="btn danger" onClick={() => run(() => api.stopLab(), "Lab stopped")}>Stop lab</button>
            ) : null}
          </div>
          {!project.controllers.length ? (
            <div className="empty">
              Add real MCTRL4K units by IP, or start a local lab of simulated controllers.
              Video still enters each sender over HDMI/DP; this desk is the H9-style control plane.
            </div>
          ) : (
            <div className="card-list">
              {project.controllers.map((controller) => (
                <article
                  key={controller.id}
                  className={`device ${selectedId === controller.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(controller.id)}
                >
                  <div className="device-top">
                    <h3>
                      <span className={`led ${controller.online ? "on" : "off"}`} />
                      {controller.name}
                    </h3>
                    <span>{displayLabel(controller)}</span>
                  </div>
                  <div className="ip">{controller.host}:{controller.port}</div>
                  <div className="meta">
                    <span>{controller.model}</span>
                    <span>{controller.inputKey}</span>
                    <span>{Math.round((controller.brightness / 255) * 100)}%</span>
                    {controller.simulated ? <span>SIM</span> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </aside>

        <CanvasBoard
          project={project}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMove={(id, viewport) => {
            const next = {
              ...project,
              controllers: project.controllers.map((c) =>
                c.id === id ? { ...c, viewport } : c,
              ),
            };
            setProject(next);
          }}
          onMoveEnd={(id, viewport) => run(() => api.patchController(id, { viewport }))}
        />

        <Inspector
          project={project}
          selected={selected}
          busy={busy}
          onCommand={(type, extra) =>
            selected && run(() => api.command(selected.id, { type, ...extra }))
          }
          onProbe={() => selected && run(() => api.probe(selected.id))}
          onRemove={() =>
            selected &&
            run(async () => {
              const result = await api.removeController(selected.id);
              setSelectedId(null);
              return result;
            }, "Controller removed")
          }
          onPreviewBrightness={(value) => {
            setProject((current) => ({
              ...current,
              controllers: current.controllers.map((item) =>
                item.id === selectedId
                  ? { ...item, brightness: Math.round((value / 100) * 255) }
                  : item,
              ),
            }));
          }}
        />
      </main>

      <footer className="dock">
        <div className="dock-col">
          <div className="section-h">
            Layers
            <button className="btn ghost" onClick={() => run(() => api.addLayer({ name: `Layer ${project.layers.length + 1}` }))}>
              Add layer
            </button>
          </div>
          <div className="chips">
            {project.layers.map((layer) => (
              <button
                key={layer.id}
                className="chip"
                onClick={() => setSelectedLayer(layer.id)}
                style={{ outline: selectedLayer === layer.id ? "1px solid var(--violet)" : undefined }}
              >
                <b>{layer.name}</b>
                <span>{layer.width}×{layer.height} · {layer.source}</span>
              </button>
            ))}
            {!project.layers.length ? <span className="empty">No layers yet.</span> : null}
          </div>
        </div>
        <div className="dock-col">
          <div className="section-h">
            Presets / layout
            <button className="btn ghost" onClick={() => run(() => api.addPreset(`Look ${project.presets.length + 1}`), "Preset saved")}>
              Save look
            </button>
          </div>
          <div className="chips">
            {LAYOUTS.map((layout) => (
              <button key={layout.id} className="chip" onClick={() => run(() => api.layout({ pattern: layout.id }))}>
                <b>{layout.label}</b>
                <span>Tile senders</span>
              </button>
            ))}
            {project.presets.map((preset) => (
              <button key={preset.id} className="chip" onClick={() => run(() => api.applyPreset(preset.id), `Loaded ${preset.name}`)}>
                <b>{preset.name}</b>
                <span>Recall</span>
              </button>
            ))}
          </div>
        </div>
      </footer>

      {modal ? (
        <div className="modal-back" onClick={() => setModal(false)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const result = await api.addController(form);
                setSelectedId(result.controller.id);
                setModal(false);
                return result;
              }, "Controller added");
            }}
          >
            <h2>Add controller by IP</h2>
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Stage left" />
            </div>
            <div className="field">
              <label>IP address</label>
              <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
            </div>
            <div className="field">
              <label>TCP/UDP port</label>
              <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Model</label>
              <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
                {Object.values(project.models || {}).map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Transport</label>
              <select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })}>
                <option value="tcp">TCP 5200 (NovaStar central control)</option>
                <option value="udp">UDP 5201</option>
              </select>
            </div>
            <div className="row">
              <button className="btn primary" type="submit">Connect</button>
              <button className="btn" type="button" onClick={() => setModal(false)}>Cancel</button>
            </div>
          </form>
        </div>
      ) : null}

      {toast ? (
        <div className="toast" onClick={() => setToast("")}>{toast}</div>
      ) : null}
    </div>
  );
}

function Inspector({ project, selected, busy, onCommand, onProbe, onRemove, onPreviewBrightness }) {
  if (!selected) {
    return (
      <aside className="inspector">
        <div className="section-h">Inspector</div>
        <p className="note">
          Lumen Splice talks to NovaStar senders over IP using the published central-control protocol
          (TCP 5200 / UDP 5201). It can drive 2–6+ MCTRL4K units from a laptop, including brightness,
          freeze, blackout, input routing, and canvas tiling.
        </p>
        <p className="note">
          It does not replace the H9 FPGA video processor. Each MCTRL4K still needs an HDMI/DP/DVI
          picture. Use this desk instead of the H9 when the laptop (or a GPU/matrix) is the video
          source and you only need unified IP control.
        </p>
      </aside>
    );
  }
  const warning = capacityWarning(selected, project.models);
  const spec = project.models?.[selected.model];
  return (
    <aside className="inspector">
      <div className="section-h">{selected.name}</div>
      <div className="field">
        <label>Status</label>
        <div>
          <span className={`led ${selected.online ? "on" : "off"}`} />
          {selected.online ? "Online" : "Offline"} {selected.simulated ? "· simulator" : ""}
          {selected.lastError ? ` · ${selected.lastError}` : ""}
        </div>
      </div>
      <div className="field">
        <label>Brightness</label>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round((selected.brightness / 255) * 100)}
          onChange={(e) => onPreviewBrightness(Number(e.target.value))}
          onMouseUp={(e) => onCommand("brightness", { value: Number(e.target.value) })}
          onTouchEnd={(e) => onCommand("brightness", { value: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>Input</label>
        <select value={selected.inputKey} onChange={(e) => onCommand("input", { inputKey: e.target.value })}>
          {Object.entries(project.inputs || {}).map(([key, value]) => (
            <option key={key} value={key}>{value.label}</option>
          ))}
        </select>
      </div>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => onCommand("normal")}>Live</button>
        <button className="btn" disabled={busy} onClick={() => onCommand("freeze")}>Freeze</button>
        <button className="btn danger" disabled={busy} onClick={() => onCommand("blackout")}>Black</button>
      </div>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => onCommand("lowLatency", { on: !selected.lowLatency })}>
          Low latency {selected.lowLatency ? "on" : "off"}
        </button>
        <button className="btn" disabled={busy} onClick={() => onCommand("mode3d", { on: !selected.mode3d })}>
          3D {selected.mode3d ? "on" : "off"}
        </button>
      </div>
      <div className="field">
        <label>Viewport (canvas pixels)</label>
        <div className="ip">
          {selected.viewport.x},{selected.viewport.y} {selected.viewport.width}×{selected.viewport.height}
          <br />
          {pixels(selected).toLocaleString()} px
          {spec ? ` / ${spec.maxPixels.toLocaleString()} max` : ""}
        </div>
      </div>
      {warning ? <div className="warn-box">{warning}</div> : null}
      <div className="row">
        <button className="btn" onClick={onProbe}>Probe IP</button>
        <button className="btn danger" onClick={onRemove}>Remove</button>
      </div>
      <p className="note">
        Ethernet {spec?.ethernetPorts || 16} · Optical {spec?.opticalPorts || 4} · default port 5200
      </p>
    </aside>
  );
}

function CanvasBoard({ project, selectedId, onSelect, onMove, onMoveEnd }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 400 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observe = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    observe();
    const ro = new ResizeObserver(observe);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    const sx = size.w / project.canvas.width;
    const sy = size.h / project.canvas.height;
    return Math.min(sx, sy);
  }, [size, project.canvas.width, project.canvas.height]);

  const offset = {
    x: (size.w - project.canvas.width * scale) / 2,
    y: (size.h - project.canvas.height * scale) / 2,
  };

  function toCanvas(event) {
    const box = ref.current.getBoundingClientRect();
    return {
      x: (event.clientX - box.left - offset.x) / scale,
      y: (event.clientY - box.top - offset.y) / scale,
    };
  }

  function onPointerDown(event, controller, mode) {
    event.stopPropagation();
    onSelect(controller.id);
    const start = toCanvas(event);
    drag.current = {
      id: controller.id,
      mode,
      start,
      origin: { ...controller.viewport },
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag.current) return;
    const now = toCanvas(event);
    const dx = now.x - drag.current.start.x;
    const dy = now.y - drag.current.start.y;
    const origin = drag.current.origin;
    let viewport;
    if (drag.current.mode === "resize") {
      viewport = {
        ...origin,
        width: Math.max(320, Math.round(origin.width + dx)),
        height: Math.max(180, Math.round(origin.height + dy)),
      };
    } else {
      viewport = {
        ...origin,
        x: Math.round(origin.x + dx),
        y: Math.round(origin.y + dy),
      };
    }
    onMove(drag.current.id, viewport);
  }

  function onPointerUp() {
    if (!drag.current) return;
    const controller = project.controllers.find((c) => c.id === drag.current.id);
    if (controller) onMoveEnd(controller.id, controller.viewport);
    drag.current = null;
  }

  return (
    <section className="stage-wrap">
      <div className="stage-toolbar">
        <span className="btn ghost">
          Canvas {project.canvas.width}×{project.canvas.height}
        </span>
      </div>
      <div className="hint">Drag tiles to place senders on the wall · corner handle resizes</div>
      <div
        className="canvas"
        ref={ref}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {project.layers.map((layer) => (
          <div
            key={layer.id}
            className="layer-box"
            style={{
              left: offset.x + layer.x * scale,
              top: offset.y + layer.y * scale,
              width: layer.width * scale,
              height: layer.height * scale,
            }}
          >
            <span>{layer.name}</span>
          </div>
        ))}
        {project.controllers.map((controller) => (
          <div
            key={controller.id}
            className={`tile ${selectedId === controller.id ? "selected" : ""}`}
            style={{
              left: offset.x + controller.viewport.x * scale,
              top: offset.y + controller.viewport.y * scale,
              width: controller.viewport.width * scale,
              height: controller.viewport.height * scale,
            }}
            onPointerDown={(event) => onPointerDown(event, controller, "move")}
          >
            <div className="tile-label">
              <strong>{controller.name}</strong>
              <span>{displayLabel(controller)}</span>
            </div>
            <div className="tile-body">
              {controller.host}
              <br />
              {controller.viewport.width}×{controller.viewport.height}
              <br />
              {controller.inputKey} · {Math.round((controller.brightness / 255) * 100)}%
            </div>
            <div
              className="handle"
              onPointerDown={(event) => onPointerDown(event, controller, "resize")}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
