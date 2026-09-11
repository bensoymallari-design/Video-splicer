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

function sourceLabel(project, key) {
  return project.sources?.find((item) => item.key === key)?.label || key;
}

export default function App() {
  const [project, setProject] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedLayer, setSelectedLayer] = useState(null);
  const [tab, setTab] = useState("sender");
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState({ playing: false, mediaTime: 0, loop: true });
  const [form, setForm] = useState({
    host: "192.168.0.10",
    port: 5200,
    name: "",
    model: "MCTRL4K",
    transport: "tcp",
  });

  useEffect(() => {
    api.project().then(setProject).catch((err) => setToast(err.message));
    const ws = connectSocket((msg) => {
      if (msg.type === "project") setProject(msg.payload);
      if (msg.type === "clock") setClock(msg.payload);
    });
    return () => ws.close();
  }, []);

  useEffect(() => {
    if (!project?.controllers.length) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!project.controllers.some((c) => c.id === selectedId)) {
      setSelectedId(project.controllers[0].id);
    }
  }, [project, selectedId]);

  useEffect(() => {
    if (!project?.playlist?.running) return undefined;
    const timer = setInterval(() => {
      api.playlistNext().then((result) => result.project && setProject(result.project)).catch(() => {});
    }, (project.playlist.intervalSec || 8) * 1000);
    return () => clearInterval(timer);
  }, [project?.playlist?.running, project?.playlist?.intervalSec]);

  const selected = project?.controllers.find((c) => c.id === selectedId) || null;
  const layer = project?.layers.find((item) => item.id === selectedLayer) || null;

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

  async function deleteLayer(id) {
    await run(async () => {
      const result = await api.removeLayer(id);
      setSelectedLayer((current) => (current === id ? null : current));
      return result;
    }, "Layer removed");
  }

  async function startLab(count) {
    const result = await run(() => api.startLab(count), `Lab started with ${count} MCTRL4K simulators`);
    if (result?.controllers?.[0]) setSelectedId(result.controllers[0].id);
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        run(() => api.importProject(JSON.parse(reader.result)), "Project imported");
      } catch (err) {
        setToast(err.message);
      }
    };
    reader.readAsText(file);
  }

  if (!project) {
    return <div className="empty">Starting control desk…</div>;
  }

  const locked = project.locked;

  return (
    <div className={`app ${locked ? "is-locked" : ""} ${project.eyeSaver ? "eye-saver" : ""}`}>
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
            <small>{project.name}</small>
          </div>
        </div>
        <div className="master">
          <label>Master</label>
          <input
            type="range"
            min="0"
            max="100"
            disabled={locked}
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
          <button className="btn primary" disabled={busy || locked} onClick={() => run(() => api.take(), "Take sent to senders")}>
            Take
          </button>
          <button className="btn" disabled={busy || locked} onClick={() => run(() => api.ftb({ active: false }), "Live")}>
            Live
          </button>
          <button className="btn" disabled={busy || locked} onClick={() => run(() => api.group({ command: { type: "freeze" } }))}>
            Freeze
          </button>
          <button className="btn danger" disabled={busy || locked} onClick={() => run(() => api.ftb({ active: true }), "FTB")}>
            FTB
          </button>
          <button className="btn" disabled={busy} onClick={() => run(() => api.settings({ locked: !locked }))}>
            {locked ? "Unlock" : "Lock"}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => startLab(4)}>
            Lab 4×
          </button>
        </div>
      </header>

      <ShowBar
        project={project}
        clock={clock}
        busy={busy}
        locked={locked}
        onRun={run}
        onToast={setToast}
      />

      <main className="workspace">
        <aside className="side">
          <div className="section-h">
            Controllers
            <span>{project.controllers.length}</span>
          </div>
          <div className="row">
            <button className="btn primary" disabled={locked} onClick={() => setModal(true)}>Add by IP</button>
            <button className="btn" disabled={busy} onClick={() => startLab(6)}>Lab 6</button>
            {project.lab?.running ? (
              <button className="btn danger" onClick={() => run(() => api.stopLab(), "Lab stopped")}>Stop lab</button>
            ) : null}
          </div>
          {!project.controllers.length ? (
            <div className="empty">
              Add MCTRL4K units by IP, or start a local lab. Take applies layer sources to overlapping senders over IP.
            </div>
          ) : (
            <div className="card-list">
              {project.controllers.map((controller) => (
                <article
                  key={controller.id}
                  className={`device ${selectedId === controller.id ? "selected" : ""}`}
                  onClick={() => { setSelectedId(controller.id); setTab("sender"); }}
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
                    <span>{sourceLabel(project, controller.inputKey)}</span>
                    <span>{Math.round((controller.brightness / 255) * 100)}%</span>
                    {controller.backupId ? <span>BKP</span> : null}
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
          selectedLayer={selectedLayer}
          onSelect={(id) => { setSelectedId(id); setTab("sender"); }}
          onSelectLayer={(id) => { setSelectedLayer(id); setTab("layer"); }}
          onMove={(id, viewport) => {
            setProject({
              ...project,
              controllers: project.controllers.map((c) =>
                c.id === id ? { ...c, viewport } : c,
              ),
            });
          }}
          onMoveEnd={(id, viewport) => run(() => api.patchController(id, { viewport }))}
          onMoveLayer={(id, box) => {
            setProject({
              ...project,
              layers: project.layers.map((item) => (item.id === id ? { ...item, ...box } : item)),
            });
          }}
          onMoveLayerEnd={(id, box) => run(() => api.patchLayer(id, box))}
          clock={clock}
        />

        <Inspector
          tab={tab}
          setTab={setTab}
          project={project}
          selected={selected}
          layer={layer}
          busy={busy}
          locked={locked}
          onCommand={(type, extra) =>
            selected && run(() => api.command(selected.id, { type, ...extra }))
          }
          onRoute={(id, inputKey) => run(() => api.command(id, { type: "input", inputKey }))}
          onProbe={() => selected && run(() => api.probe(selected.id))}
          onRemove={() =>
            selected &&
            run(async () => {
              const result = await api.removeController(selected.id);
              setSelectedId(null);
              return result;
            }, "Controller removed")
          }
          onPatch={(payload) => selected && run(() => api.patchController(selected.id, payload))}
          onPatchLayer={(payload) => layer && run(() => api.patchLayer(layer.id, payload))}
          onSettings={(payload) => run(() => api.settings(payload))}
          onDeleteLayer={() => layer && deleteLayer(layer.id)}
          onImport={importFile}
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
            <span className="section-actions">
              <button
                className="btn ghost"
                disabled={locked}
                onClick={() =>
                  run(async () => {
                    const result = await api.addLayer({ name: `Layer ${project.layers.length + 1}` });
                    if (result.layer?.id) {
                      setSelectedLayer(result.layer.id);
                      setTab("layer");
                    }
                    return result;
                  })
                }
              >
                Add layer
              </button>
              <button
                className="btn danger"
                disabled={locked || !selectedLayer}
                onClick={() => selectedLayer && deleteLayer(selectedLayer)}
              >
                Delete layer
              </button>
            </span>
          </div>
          <div className="chips">
            {project.layers.map((item) => (
              <div
                key={item.id}
                className={`chip layer-chip ${selectedLayer === item.id ? "on" : ""}`}
                style={{ opacity: item.visible === false ? 0.45 : 1 }}
              >
                <button
                  type="button"
                  className="chip-main"
                  onClick={() => { setSelectedLayer(item.id); setTab("layer"); }}
                >
                  <b>{item.name}</b>
                  <span>{item.width}×{item.height} · {sourceLabel(project, item.source)}</span>
                </button>
                <button
                  type="button"
                  className="chip-del"
                  title="Remove layer"
                  disabled={locked}
                  onClick={() => deleteLayer(item.id)}
                >
                  Delete
                </button>
              </div>
            ))}
            {!project.layers.length ? <span className="empty">No layers yet. Layers are control routing only — they do not carry Resolume video.</span> : null}
          </div>
        </div>
        <div className="dock-col">
          <div className="section-h">
            Looks / playlist
            <span>
              <button className="btn ghost" disabled={locked} onClick={() => run(() => api.addPreset(`Look ${project.presets.length + 1}`), "Look saved")}>
                Save look
              </button>
              <button className="btn ghost" disabled={locked || !project.presets.length} onClick={() => run(() => api.playlistAdd({}), "Added to playlist")}>
                + Playlist
              </button>
            </span>
          </div>
          <div className="chips">
            {LAYOUTS.map((layout) => (
              <button key={layout.id} className="chip" disabled={locked} onClick={() => run(() => api.layout({ pattern: layout.id }))}>
                <b>{layout.label}</b>
                <span>Tile senders</span>
              </button>
            ))}
            {project.presets.map((preset) => (
              <button key={preset.id} className="chip" disabled={locked} onClick={() => run(() => api.applyPreset(preset.id), `Loaded ${preset.name}`)}>
                <b>{preset.name}</b>
                <span>Recall</span>
              </button>
            ))}
            <button
              className="chip"
              disabled={locked || !project.playlist.ids.length}
              onClick={() => run(() => api.settings({ playlist: { running: !project.playlist.running } }))}
            >
              <b>{project.playlist.running ? "Stop playlist" : "Play playlist"}</b>
              <span>{project.playlist.ids.length} looks · {project.playlist.intervalSec}s</span>
            </button>
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
                <option value="tcp">TCP 5200</option>
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

function ShowBar({ project, clock, busy, locked, onRun, onToast }) {
  function openDisplays() {
    if (!project.controllers.length) {
      onToast("Add controllers or start Lab, then open displays");
      return;
    }
    for (const controller of project.controllers) {
      window.open(`/output/${controller.id}`, `lumen-display-${controller.id}`);
    }
    onToast("Drag each display window onto the HDMI screen that feeds that MCTRL4K");
  }

  return (
    <div className="showbar">
      <span className="showbar-label">Show</span>
      <label className="btn">
        Load media
        <input
          type="file"
          accept="video/mp4,video/webm,video/quicktime,image/*"
          hidden
          disabled={locked}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onRun(() => api.uploadMedia(file), `${file.name} on stage`);
          }}
        />
      </label>
      <button className="btn primary" disabled={busy || !(project.clips || []).length} onClick={() => onRun(() => api.showPlay(), "Playing all displays")}>
        Play
      </button>
      <button className="btn" disabled={busy} onClick={() => onRun(() => api.showPause())}>Pause</button>
      <button className="btn" disabled={busy} onClick={() => onRun(() => api.showStop())}>Stop</button>
      <button className="btn" disabled={busy} onClick={openDisplays}>Open displays</button>
      <span className="showbar-meta">
        {(project.media || []).length} media · {(project.clips || []).length} on stage · {clock.playing ? "PLAY" : "STOP"} {Math.floor(clock.mediaTime || 0)}s
      </span>
      {(project.media || []).map((item) => (
        <button key={item.id} className="chip ghost-chip" disabled={locked} onClick={() => onRun(() => api.removeMedia(item.id), "Media removed")}>
          {item.name} ×
        </button>
      ))}
      <span className="showbar-hint">Watchout-style: this PC plays the file. Drag display windows to the screens cabled into each controller.</span>
    </div>
  );
}

function Inspector({
  tab, setTab, project, selected, layer, busy, locked,
  onCommand, onProbe, onRemove, onPatch, onPatchLayer, onSettings, onDeleteLayer, onImport, onPreviewBrightness, onRoute,
}) {
  return (
    <aside className="inspector">
      <div className="tabs">
        {["sender", "layer", "matrix", "screen"].map((id) => (
          <button key={id} className={`tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
            {id}
          </button>
        ))}
      </div>
      {tab === "sender" ? (
        <SenderPane
          project={project}
          selected={selected}
          busy={busy}
          locked={locked}
          onCommand={onCommand}
          onProbe={onProbe}
          onRemove={onRemove}
          onPatch={onPatch}
          onPreviewBrightness={onPreviewBrightness}
        />
      ) : null}
      {tab === "layer" ? (
        <LayerPane project={project} layer={layer} locked={locked} onPatchLayer={onPatchLayer} onDeleteLayer={onDeleteLayer} />
      ) : null}
      {tab === "matrix" ? (
        <MatrixPane project={project} locked={locked} onRoute={onRoute} />
      ) : null}
      {tab === "screen" ? (
        <ScreenPane project={project} locked={locked} onSettings={onSettings} onImport={onImport} />
      ) : null}
    </aside>
  );
}

function SenderPane({ project, selected, busy, locked, onCommand, onProbe, onRemove, onPatch, onPreviewBrightness }) {
  if (!selected) {
    return <p className="note">Select a sender. IP control covers brightness, freeze, FTB, input, presets, and tiling — not H9 FPGA splicing.</p>;
  }
  const warning = capacityWarning(selected, project.models);
  const spec = project.models?.[selected.model];
  const ports = spec?.ethernetPorts || 16;
  return (
    <>
      <div className="section-h">{selected.name}</div>
      <div className="field">
        <label>Status</label>
        <div>
          <span className={`led ${selected.online ? "on" : "off"}`} />
          {selected.online ? "Online" : "Offline"} {selected.simulated ? "· simulator" : ""}
        </div>
      </div>
      <div className="field">
        <label>Brightness</label>
        <input
          type="range"
          min="0"
          max="100"
          disabled={locked}
          value={Math.round((selected.brightness / 255) * 100)}
          onChange={(e) => onPreviewBrightness(Number(e.target.value))}
          onMouseUp={(e) => onCommand("brightness", { value: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>Input</label>
        <select disabled={locked} value={selected.inputKey} onChange={(e) => onCommand("input", { inputKey: e.target.value })}>
          {(project.sources || []).map((source) => (
            <option key={source.key} value={source.key}>{source.label}</option>
          ))}
        </select>
      </div>
      <div className="row">
        <button className="btn" disabled={busy || locked} onClick={() => onCommand("normal")}>Live</button>
        <button className="btn" disabled={busy || locked} onClick={() => onCommand("freeze")}>Freeze</button>
        <button className="btn danger" disabled={busy || locked} onClick={() => onCommand("blackout")}>Black</button>
      </div>
      <div className="field">
        <label>Hardware preset</label>
        <div className="preset-grid">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              className={`btn ${selected.hardwarePreset === n ? "primary" : ""}`}
              disabled={busy || locked}
              onClick={() => onCommand("hardwarePreset", { index: n })}
            >
              P{n}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <button className="btn" disabled={busy || locked} onClick={() => onCommand("lowLatency", { on: !selected.lowLatency })}>
          Low latency {selected.lowLatency ? "on" : "off"}
        </button>
        <button className="btn" disabled={busy || locked} onClick={() => onCommand("mode3d", { on: !selected.mode3d })}>
          3D {selected.mode3d ? "on" : "off"}
        </button>
        <button className="btn" disabled={busy || locked} onClick={() => onCommand("testPattern", { on: !selected.testPattern })}>
          Test {selected.testPattern ? "on" : "off"}
        </button>
      </div>
      <div className="field">
        <label>EDID / viewport</label>
        <div className="edid-row">
          <input
            type="number"
            disabled={locked}
            defaultValue={selected.edid?.width || selected.viewport.width}
            key={`${selected.id}-w-${selected.edid?.width || selected.viewport.width}`}
            onBlur={(e) => onPatch({ edid: { width: Number(e.target.value), height: selected.edid?.height || selected.viewport.height, refresh: 60 } })}
          />
          ×
          <input
            type="number"
            disabled={locked}
            defaultValue={selected.edid?.height || selected.viewport.height}
            key={`${selected.id}-h-${selected.edid?.height || selected.viewport.height}`}
            onBlur={(e) => onPatch({ edid: { width: selected.edid?.width || selected.viewport.width, height: Number(e.target.value), refresh: 60 } })}
          />
        </div>
      </div>
      <div className="field">
        <label>Backup sender</label>
        <select
          disabled={locked}
          value={selected.backupId || ""}
          onChange={(e) => onPatch({ backupId: e.target.value || null })}
        >
          <option value="">None</option>
          {project.controllers.filter((c) => c.id !== selected.id).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Ethernet ports</label>
        <div className="ports">
          {Array.from({ length: ports }, (_, i) => (
            <span key={i} className={`port ${i < (selected.portsUp || ports) ? "up" : ""}`} title={`Port ${i + 1}`} />
          ))}
        </div>
      </div>
      {warning ? <div className="warn-box">{warning}</div> : null}
      <div className="row">
        <button className="btn" onClick={onProbe}>Probe IP</button>
        <button className="btn danger" disabled={locked} onClick={onRemove}>Remove</button>
      </div>
    </>
  );
}

function LayerPane({ project, layer, locked, onPatchLayer, onDeleteLayer }) {
  if (!layer) {
    return (
      <p className="note">
        Click a layer chip at the bottom, then use <b>Delete layer</b> next to Add layer,
        or the red Delete on that chip. If Lock is on in the top bar, removal is blocked.
      </p>
    );
  }
  return (
    <>
      <div className="section-h">{layer.name}</div>
      <div className="field">
        <label>Name</label>
        <input disabled={locked} defaultValue={layer.name} key={layer.id + layer.name} onBlur={(e) => onPatchLayer({ name: e.target.value })} />
      </div>
      <div className="field">
        <label>Source</label>
        <select disabled={locked} value={layer.source} onChange={(e) => onPatchLayer({ source: e.target.value })}>
          {(project.sources || []).map((source) => (
            <option key={source.key} value={source.key}>{source.label}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Kind</label>
        <select disabled={locked} value={layer.kind || "video"} onChange={(e) => onPatchLayer({ kind: e.target.value })}>
          <option value="video">Video layer</option>
          <option value="bkg">BKG (does not steal z-order)</option>
          <option value="osd">OSD</option>
        </select>
      </div>
      <div className="row">
        <button className="btn" disabled={locked} onClick={() => onPatchLayer({ visible: layer.visible === false })}>
          {layer.visible === false ? "Show" : "Hide"}
        </button>
        <button className="btn" disabled={locked} onClick={() => onPatchLayer({ locked: !layer.locked })}>
          {layer.locked ? "Unlock layer" : "Lock layer"}
        </button>
        <button className="btn danger" disabled={locked} onClick={onDeleteLayer}>
          Delete
        </button>
      </div>
      <p className="note">
        {layer.width}×{layer.height} at {layer.x},{layer.y} · z {layer.z}.
        Use × on the layer chip below, or Delete here. Screen Lock blocks removal.
      </p>
    </>
  );
}

function MatrixPane({ project, locked, onRoute }) {
  const sources = project.sources || [];
  return (
    <>
      <div className="section-h">Input matrix</div>
      <p className="note">Click a cell to route that source to a sender. This is IP switching, not an H9 crosspoint card.</p>
      <div className="matrix">
        <div className="matrix-row head">
          <span />
          {sources.map((source) => <span key={source.key}>{source.label}</span>)}
        </div>
        {project.controllers.map((controller) => (
          <div className="matrix-row" key={controller.id}>
            <span>{controller.name}</span>
            {sources.map((source) => (
              <button
                key={source.key}
                disabled={locked}
                className={controller.inputKey === source.key ? "on" : ""}
                onClick={() => onRoute(controller.id, source.key)}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function ScreenPane({ project, locked, onSettings, onImport }) {
  const color = project.color || {};
  const osd = project.osd || {};
  return (
    <>
      <div className="section-h">Screen</div>
      <div className="row">
        <button className="btn" disabled={locked} onClick={() => onSettings({ eyeSaver: !project.eyeSaver })}>
          Eye saver {project.eyeSaver ? "on" : "off"}
        </button>
        <button className="btn" disabled={locked} onClick={() => onSettings({ osd: { enabled: !osd.enabled } })}>
          OSD {osd.enabled ? "on" : "off"}
        </button>
      </div>
      <div className="field">
        <label>OSD text</label>
        <input disabled={locked} defaultValue={osd.text} key={osd.text} onBlur={(e) => onSettings({ osd: { text: e.target.value, enabled: true } })} />
      </div>
      <div className="field">
        <label>Contrast {color.contrast}</label>
        <input type="range" min="50" max="150" disabled={locked} defaultValue={color.contrast} key={`c${color.contrast}`} onMouseUp={(e) => onSettings({ color: { contrast: Number(e.target.value) } })} />
      </div>
      <div className="field">
        <label>Saturation {color.saturation}</label>
        <input type="range" min="0" max="200" disabled={locked} defaultValue={color.saturation} key={`s${color.saturation}`} onMouseUp={(e) => onSettings({ color: { saturation: Number(e.target.value) } })} />
      </div>
      <div className="field">
        <label>Hue {color.hue}</label>
        <input type="range" min="-180" max="180" disabled={locked} defaultValue={color.hue} key={`h${color.hue}`} onMouseUp={(e) => onSettings({ color: { hue: Number(e.target.value) } })} />
      </div>
      <div className="row">
        <a className="btn" href="/api/project/export">Export</a>
        <label className="btn">
          Import
          <input type="file" accept="application/json" hidden onChange={(e) => e.target.files[0] && onImport(e.target.files[0])} />
        </label>
      </div>
      <p className="note">
        Color and OSD preview on this desk. LED cabinets only receive brightness / freeze / blackout / input over the published IP protocol. HDMI ingest, HDR, Genlock, and sending-card Ethernet cannot be added in software.
      </p>
    </>
  );
}

}

function StageVideo({ src, style, clock }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const t = clock?.mediaTime || 0;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      const target = clock?.loop ? t % video.duration : Math.min(t, video.duration);
      if (Math.abs(video.currentTime - target) > 0.35) video.currentTime = target;
    }
    if (clock?.playing) video.play().catch(() => {});
    else video.pause();
  }, [clock]);
  return <video ref={ref} className="stage-clip" style={style} src={src} muted playsInline loop={clock?.loop} />;
}

function CanvasBoard({
  project, selectedId, selectedLayer, onSelect, onSelectLayer,
  onMove, onMoveEnd, onMoveLayer, onMoveLayerEnd, clock,
}) {
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

  const filter = [
    `contrast(${project.color?.contrast || 100}%)`,
    `saturate(${project.color?.saturation || 100}%)`,
    `hue-rotate(${project.color?.hue || 0}deg)`,
    project.eyeSaver ? "sepia(0.18) brightness(0.96)" : "",
  ].join(" ");

  function toCanvas(event) {
    const box = ref.current.getBoundingClientRect();
    return {
      x: (event.clientX - box.left - offset.x) / scale,
      y: (event.clientY - box.top - offset.y) / scale,
    };
  }

  function onPointerDown(event, target, kind, mode) {
    event.stopPropagation();
    if (kind === "layer") onSelectLayer(target.id);
    else onSelect(target.id);
    if (target.locked) return;
    const start = toCanvas(event);
    drag.current = {
      id: target.id,
      kind,
      mode,
      start,
      origin: kind === "layer"
        ? { x: target.x, y: target.y, width: target.width, height: target.height }
        : { ...target.viewport },
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag.current) return;
    const now = toCanvas(event);
    const dx = now.x - drag.current.start.x;
    const dy = now.y - drag.current.start.y;
    const origin = drag.current.origin;
    const box = drag.current.mode === "resize"
      ? { ...origin, width: Math.max(320, Math.round(origin.width + dx)), height: Math.max(180, Math.round(origin.height + dy)) }
      : { ...origin, x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) };
    if (drag.current.kind === "layer") onMoveLayer(drag.current.id, box);
    else onMove(drag.current.id, box);
  }

  function onPointerUp() {
    if (!drag.current) return;
    if (drag.current.kind === "layer") {
      const item = project.layers.find((layer) => layer.id === drag.current.id);
      if (item) onMoveLayerEnd(item.id, { x: item.x, y: item.y, width: item.width, height: item.height });
    } else {
      const controller = project.controllers.find((c) => c.id === drag.current.id);
      if (controller) onMoveEnd(controller.id, controller.viewport);
    }
    drag.current = null;
  }

  return (
    <section className="stage-wrap">
      <div className="stage-toolbar">
        <span className="btn ghost">Canvas {project.canvas.width}×{project.canvas.height}</span>
      </div>
      <div className="hint">Take applies layers · drag senders or layers · FTB / freeze / lock on the top bar</div>
      <div
        className="canvas"
        ref={ref}
        style={{ filter }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {(project.clips || []).map((clip) => {
          const media = (project.media || []).find((item) => item.id === clip.mediaId);
          if (!media) return null;
          const style = {
            left: offset.x + clip.x * scale,
            top: offset.y + clip.y * scale,
            width: clip.width * scale,
            height: clip.height * scale,
            zIndex: 1,
            pointerEvents: "none",
          };
          if (media.kind === "image") {
            return <img key={clip.id} alt="" src={media.url} className="stage-clip" style={style} />;
          }
          return <StageVideo key={clip.id} src={media.url} style={style} clock={clock} />;
        })}
        {project.layers.filter((layer) => layer.visible !== false).map((layer) => (
          <div
            key={layer.id}
            className={`layer-box ${selectedLayer === layer.id ? "selected" : ""} ${layer.kind || ""}`}
            style={{
              left: offset.x + layer.x * scale,
              top: offset.y + layer.y * scale,
              width: layer.width * scale,
              height: layer.height * scale,
              zIndex: selectedLayer === layer.id ? 8 : 2,
              pointerEvents: "auto",
              opacity: (layer.opacity || 100) / 100,
            }}
            onPointerDown={(event) => onPointerDown(event, layer, "layer", "move")}
          >
            <span>{layer.name} · {layer.source}</span>
            <div className="handle" onPointerDown={(event) => onPointerDown(event, layer, "layer", "resize")} />
          </div>
        ))}
        {project.controllers.map((controller) => (
          <div
            key={controller.id}
            className={`tile ${selectedId === controller.id ? "selected" : ""} ${controller.testPattern ? "bars" : ""}`}
            style={{
              left: offset.x + controller.viewport.x * scale,
              top: offset.y + controller.viewport.y * scale,
              width: controller.viewport.width * scale,
              height: controller.viewport.height * scale,
            }}
            onPointerDown={(event) => onPointerDown(event, controller, "controller", "move")}
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
            <div className="handle" onPointerDown={(event) => onPointerDown(event, controller, "controller", "resize")} />
          </div>
        ))}
        {project.osd?.enabled ? (
          <div className={`osd-banner ${project.osd.position || "top"}`}>{project.osd.text}</div>
        ) : null}
        {project.ftb?.active ? <div className="ftb-veil" /> : null}
      </div>
    </section>
  );
}
