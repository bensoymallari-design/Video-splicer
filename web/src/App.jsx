import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { assignOutputs, listScreens, windowFeatures } from "./screens.js";

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function formatTime(s) {
  const n = Math.max(0, Number(s) || 0);
  const m = Math.floor(n / 60);
  const r = (n - m * 60).toFixed(2).padStart(5, "0");
  return `${m}:${r}`;
}

function brightnessPct(controller) {
  return Math.round(((controller?.brightness ?? 0) / 255) * 100);
}

export default function App() {
  const [project, setProject] = useState(null);
  const [show, setShow] = useState({ playing: false, loop: true, mediaTime: 0 });
  const [playhead, setPlayhead] = useState(0);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [selectedDisplayId, setSelectedDisplayId] = useState(null);
  const [ip, setIp] = useState("192.168.1.10");
  const [zoom, setZoom] = useState(0.12);
  const [drag, setDrag] = useState(null);
  const fileRef = useRef(null);
  const stageRef = useRef(null);
  const timelineRef = useRef(null);
  const videosRef = useRef(new Map());
  const projectRef = useRef(null);

  const refresh = useCallback(async () => {
    const data = await api.project();
    setProject(data);
    projectRef.current = data;
    if (data.show) {
      setShow(data.show);
      setPlayhead(data.show.mediaTime || 0);
    }
  }, []);

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [refresh]);

  useEffect(() => {
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "project") {
        setProject(msg.payload);
        projectRef.current = msg.payload;
        if (msg.payload?.show) setShow(msg.payload.show);
      }
      if (msg.type === "clock") {
        setShow(msg.payload);
        setPlayhead(msg.payload.mediaTime || 0);
      }
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    if (!show.playing) return undefined;
    const origin = performance.now();
    const base = show.mediaTime || 0;
    let id = 0;
    const tick = () => {
      setPlayhead(base + (performance.now() - origin) / 1000);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [show.playing, show.mediaTime]);

  useEffect(() => {
    const clips = project?.clips || [];
    for (const [id, video] of videosRef.current) {
      if (!video) continue;
      const clip = clips.find((item) => item.id === id);
      const start = clip?.start || 0;
      const local = Math.max(0, playhead - start);
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target =
        duration > 0 ? (show.loop ? local % duration : Math.min(local, duration)) : local;
      if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 0.3) {
        video.currentTime = target;
      }
      if (show.playing && local >= 0) video.play().catch(() => {});
      else video.pause();
    }
  }, [playhead, project, show.loop, show.playing]);

  useEffect(() => {
    const onMove = (event) => {
      if (!drag || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const x = (event.clientX - rect.left) / zoom - drag.ox;
      const y = (event.clientY - rect.top) / zoom - drag.oy;
      setProject((prev) => {
        if (!prev) return prev;
        if (drag.kind === "clip") {
          const next = {
            ...prev,
            clips: prev.clips.map((clip) =>
              clip.id === drag.id
                ? { ...clip, x: Math.round(x), y: Math.round(y) }
                : clip,
            ),
          };
          projectRef.current = next;
          return next;
        }
        if (drag.kind === "clip-resize") {
          const next = {
            ...prev,
            clips: prev.clips.map((clip) =>
              clip.id === drag.id
                ? {
                    ...clip,
                    width: Math.max(160, Math.round(x - clip.x)),
                    height: Math.max(90, Math.round(y - clip.y)),
                  }
                : clip,
            ),
          };
          projectRef.current = next;
          return next;
        }
        if (drag.kind === "display") {
          const next = {
            ...prev,
            controllers: prev.controllers.map((controller) =>
              controller.id === drag.id
                ? {
                    ...controller,
                    viewport: {
                      ...controller.viewport,
                      x: Math.round(x),
                      y: Math.round(y),
                    },
                  }
                : controller,
            ),
          };
          projectRef.current = next;
          return next;
        }
        if (drag.kind === "display-resize") {
          const next = {
            ...prev,
            controllers: prev.controllers.map((controller) => {
              if (controller.id !== drag.id) return controller;
              return {
                ...controller,
                viewport: {
                  ...controller.viewport,
                  width: Math.max(320, Math.round(x - controller.viewport.x)),
                  height: Math.max(180, Math.round(y - controller.viewport.y)),
                },
              };
            }),
          };
          projectRef.current = next;
          return next;
        }
        return prev;
      });
    };
    const onUp = async () => {
      if (!drag) return;
      const current = drag;
      setDrag(null);
      const latest = projectRef.current;
      if (!latest) return;
      try {
        if (current.kind === "clip" || current.kind === "clip-resize") {
          const clip = latest.clips.find((item) => item.id === current.id);
          if (clip) {
            await api.patchClip(clip.id, {
              x: clip.x,
              y: clip.y,
              width: clip.width,
              height: clip.height,
            });
          }
        }
        if (current.kind === "display" || current.kind === "display-resize") {
          const controller = latest.controllers.find((item) => item.id === current.id);
          if (controller) {
            await api.patchController(controller.id, { viewport: controller.viewport });
          }
        }
      } catch (err) {
        setError(err.message);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, zoom]);

  async function run(label, fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(`${label}: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function stagePoint(event, originX = 0, originY = 0) {
    const rect = stageRef.current.getBoundingClientRect();
    return {
      ox: (event.clientX - rect.left) / zoom - originX,
      oy: (event.clientY - rect.top) / zoom - originY,
    };
  }

  function onClipPointerDown(event, clip) {
    event.stopPropagation();
    setSelectedClipId(clip.id);
    setSelectedDisplayId(null);
    setDrag({ kind: "clip", id: clip.id, ...stagePoint(event, clip.x, clip.y) });
  }

  async function onClipLoaded(clip, media) {
    const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
    if (duration && duration !== clip.duration) {
      await api.patchClip(clip.id, { duration });
    }
  }

  async function seekFromTimeline(event) {
    const el = timelineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = ((event.clientX - rect.left) / rect.width) * timelineDuration;
    await api.showSeek(Math.max(0, t));
  }

  const canvas = project?.canvas || { width: 7680, height: 2160 };
  const controllers = project?.controllers || [];
  const clips = project?.clips || [];
  const media = project?.media || [];
  const selectedClip = clips.find((clip) => clip.id === selectedClipId);
  const selectedDisplay = controllers.find((controller) => controller.id === selectedDisplayId);
  const timelineDuration = Math.max(
    30,
    ...clips.map((clip) => (clip.start || 0) + (clip.duration || 10)),
  );
  const wrappedHead = show.loop ? playhead % timelineDuration : playhead;
  const playheadPct = clamp((wrappedHead / timelineDuration) * 100, 0, 100);

  if (!project) {
    return <div className="boot">Opening production…</div>;
  }

  return (
    <div className="wo">
      <header className="wo-top">
        <div className="wo-brand">
          <strong>Lumen Splice</strong>
          <span>Watchout production</span>
        </div>
        <div className="wo-transport">
          <button
            className="go"
            disabled={busy}
            onClick={() => run("Go", () => api.showPlay())}
          >
            GO
          </button>
          <button disabled={busy} onClick={() => run("Play", () => api.showPlay())}>
            ▶ Play
          </button>
          <button disabled={busy} onClick={() => run("Pause", () => api.showPause())}>
            ⏸ Pause
          </button>
          <button disabled={busy} onClick={() => run("Stop", () => api.showStop())}>
            ■ Stop
          </button>
          <span className="wo-clock">{formatTime(wrappedHead)}</span>
          <span className={`wo-state ${show.playing ? "live" : ""}`}>
            {show.playing ? "PLAYING" : wrappedHead > 0 ? "PAUSED" : "STOPPED"}
          </span>
        </div>
        <div className="wo-top-actions">
          <label>
            Stage zoom
            <input
              type="range"
              min="0.04"
              max="0.28"
              step="0.01"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <button
            disabled={busy || !controllers.length}
            onClick={() =>
              run("Place on outputs", async () => {
                const { screens, permission } = await listScreens();
                const mapped = assignOutputs(screens, controllers.length);
                const opened = [];
                controllers.forEach((controller, index) => {
                  const screen = mapped[index];
                  const popup = window.open(
                    `/output/${controller.id}?fs=1`,
                    `out-${controller.id}`,
                    windowFeatures(screen),
                  );
                  if (popup) opened.push(controller.name);
                });
                if (!opened.length) {
                  throw new Error("The browser blocked the output windows");
                }
                const gpu = screens.filter((screen) => !screen.isPrimary);
                if (permission === "unsupported") {
                  setNote(
                    "This browser cannot list GPU outputs. Drag each window onto an HDMI, DP, or USB-C screen, then press F.",
                  );
                } else if (gpu.length) {
                  setNote(
                    `Placed on ${gpu.length} extra GPU output${gpu.length === 1 ? "" : "s"} (HDMI / DP / USB-C). Remaining windows stay here to drag.`,
                  );
                } else {
                  setNote(
                    "Only one OS screen is visible. Extend the desktop across your output cards, then click Place on outputs again.",
                  );
                }
              })
            }
          >
            Place on outputs
          </button>
        </div>
      </header>

      {error ? <div className="wo-error">{error}</div> : null}
      {note ? <div className="wo-note">{note}</div> : null}

      <div className="wo-body">
        <aside className="wo-bin">
          <h2>Media</h2>
          <p className="hint">Load files into the bin, then add cues to the stage.</p>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="video/*,image/*"
            onChange={(e) => {
              const files = [...(e.target.files || [])];
              e.target.value = "";
              if (!files.length) return;
              run("Load media", async () => {
                for (const file of files) await api.uploadMedia(file);
              });
            }}
          />
          <button disabled={busy} onClick={() => fileRef.current?.click()}>
            Load media…
          </button>
          <ul className="media-list">
            {media.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.kind}</span>
                </div>
                <div className="row-inline">
                  <button
                    disabled={busy}
                    onClick={() =>
                      run("Add cue", () =>
                        api.addClip({
                          mediaId: item.id,
                          x: 120 + clips.length * 40,
                          y: 120 + clips.length * 24,
                        }),
                      )
                    }
                  >
                    + Stage
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => run("Remove media", () => api.removeMedia(item.id))}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {media.length === 0 ? <p className="empty">No media loaded.</p> : null}
        </aside>

        <main className="wo-stage-wrap">
          <div className="wo-stage-label">
            Stage · {canvas.width} × {canvas.height} px · cues play here, displays crop their
            viewports
          </div>
          <div
            className="wo-stage"
            ref={stageRef}
            onPointerDown={() => {
              setSelectedClipId(null);
              setSelectedDisplayId(null);
            }}
          >
            <div
              className="wo-stage-inner"
              style={{
                width: canvas.width * zoom,
                height: canvas.height * zoom,
              }}
            >
              {clips.map((clip) => {
                const item = media.find((entry) => entry.id === clip.mediaId);
                if (!item) return null;
                return (
                  <div
                    key={clip.id}
                    className={`wo-clip ${selectedClipId === clip.id ? "sel" : ""}`}
                    style={{
                      left: clip.x * zoom,
                      top: clip.y * zoom,
                      width: clip.width * zoom,
                      height: clip.height * zoom,
                      zIndex: 2 + (clip.z || 0),
                    }}
                    onPointerDown={(event) => onClipPointerDown(event, clip)}
                  >
                    {item.kind === "video" ? (
                      <video
                        src={item.url}
                        muted
                        playsInline
                        onLoadedMetadata={(event) => onClipLoaded(clip, event.currentTarget)}
                        ref={(node) => {
                          if (node) videosRef.current.set(clip.id, node);
                          else videosRef.current.delete(clip.id);
                        }}
                      />
                    ) : (
                      <img
                        src={item.url}
                        alt={clip.name}
                        onLoad={(event) => onClipLoaded(clip, event.currentTarget)}
                      />
                    )}
                    <span>{clip.name}</span>
                    <i
                      className="wo-handle"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        setSelectedClipId(clip.id);
                        setDrag({
                          kind: "clip-resize",
                          id: clip.id,
                          ...stagePoint(event, 0, 0),
                        });
                      }}
                    />
                  </div>
                );
              })}
              {controllers.map((controller) => (
                <div
                  key={controller.id}
                  className={`wo-display ${selectedDisplayId === controller.id ? "sel" : ""} ${controller.online ? "on" : "off"}`}
                  style={{
                    left: controller.viewport.x * zoom,
                    top: controller.viewport.y * zoom,
                    width: controller.viewport.width * zoom,
                    height: controller.viewport.height * zoom,
                  }}
                >
                  <button
                    type="button"
                    className="wo-display-label"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelectedDisplayId(controller.id);
                      setSelectedClipId(null);
                      setDrag({
                        kind: "display",
                        id: controller.id,
                        ...stagePoint(event, controller.viewport.x, controller.viewport.y),
                      });
                    }}
                  >
                    <b>{controller.name}</b>
                    <small>
                      {controller.host}:{controller.port} · {controller.viewport.width}×
                      {controller.viewport.height}
                    </small>
                  </button>
                  <i
                    className="wo-handle"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelectedDisplayId(controller.id);
                      setDrag({
                        kind: "display-resize",
                        id: controller.id,
                        ...stagePoint(event, 0, 0),
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </main>

        <aside className="wo-inspector">
          {selectedClip ? (
            <>
              <h2>Cue</h2>
              <label>
                Name
                <input
                  value={selectedClip.name}
                  onChange={(event) =>
                    setProject((prev) => ({
                      ...prev,
                      clips: prev.clips.map((clip) =>
                        clip.id === selectedClip.id
                          ? { ...clip, name: event.target.value }
                          : clip,
                      ),
                    }))
                  }
                  onBlur={() => api.patchClip(selectedClip.id, { name: selectedClip.name })}
                />
              </label>
              {["x", "y", "width", "height", "start", "duration"].map((key) => (
                <label key={key}>
                  {key}
                  <input
                    type="number"
                    step={key === "start" || key === "duration" ? "0.01" : "1"}
                    value={selectedClip[key] ?? 0}
                    onChange={(event) => {
                      const n = Number(event.target.value);
                      setProject((prev) => ({
                        ...prev,
                        clips: prev.clips.map((clip) =>
                          clip.id === selectedClip.id ? { ...clip, [key]: n } : clip,
                        ),
                      }));
                    }}
                    onBlur={() =>
                      api.patchClip(selectedClip.id, { [key]: selectedClip[key] })
                    }
                  />
                </label>
              ))}
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  run("Delete cue", async () => {
                    await api.removeClip(selectedClip.id);
                    setSelectedClipId(null);
                  })
                }
              >
                Delete cue
              </button>
            </>
          ) : selectedDisplay ? (
            <>
              <h2>Display</h2>
              <p className="hint">
                Open a window for this display and drag it onto the screen cabled into this
                sender. IP below is NovaStar control only — not video.
              </p>
              <div className="kv">
                <span>Name</span>
                <strong>{selectedDisplay.name}</strong>
                <span>Host</span>
                <strong>
                  {selectedDisplay.host}:{selectedDisplay.port}
                </strong>
                <span>Viewport</span>
                <strong>
                  {selectedDisplay.viewport.width}×{selectedDisplay.viewport.height} @{" "}
                  {selectedDisplay.viewport.x},{selectedDisplay.viewport.y}
                </strong>
                <span>Online</span>
                <strong>{selectedDisplay.online ? "yes" : "no"}</strong>
              </div>
              {["x", "y", "width", "height"].map((key) => (
                <label key={key}>
                  Viewport {key}
                  <input
                    type="number"
                    value={selectedDisplay.viewport[key]}
                    onChange={(event) => {
                      const n = Number(event.target.value);
                      setProject((prev) => ({
                        ...prev,
                        controllers: prev.controllers.map((controller) =>
                          controller.id === selectedDisplay.id
                            ? {
                                ...controller,
                                viewport: { ...controller.viewport, [key]: n },
                              }
                            : controller,
                        ),
                      }));
                    }}
                    onBlur={() =>
                      api.patchController(selectedDisplay.id, {
                        viewport: selectedDisplay.viewport,
                      })
                    }
                  />
                </label>
              ))}
              <label>
                Brightness {brightnessPct(selectedDisplay)}%
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={brightnessPct(selectedDisplay)}
                  onChange={(event) =>
                    api.command(selectedDisplay.id, {
                      type: "brightness",
                      value: Number(event.target.value),
                    })
                  }
                />
              </label>
              <div className="row">
                <button
                  disabled={busy}
                  onClick={() =>
                    run("Freeze", () =>
                      api.command(selectedDisplay.id, {
                        type: selectedDisplay.freeze ? "unfreeze" : "freeze",
                      }),
                    )
                  }
                >
                  {selectedDisplay.freeze ? "Unfreeze" : "Freeze"}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run("Black", () =>
                      api.command(selectedDisplay.id, {
                        type: selectedDisplay.display === "blackout" ? "normal" : "blackout",
                      }),
                    )
                  }
                >
                  {selectedDisplay.display === "blackout" ? "Unblack" : "Black"}
                </button>
                <button
                  onClick={() =>
                    window.open(
                      `/output/${selectedDisplay.id}?fs=1`,
                      `out-${selectedDisplay.id}`,
                      "popup,width=1280,height=720",
                    )
                  }
                >
                  Open window
                </button>
              </div>
              <button
                disabled={busy}
                onClick={() => run("Probe", () => api.probe(selectedDisplay.id))}
              >
                Probe IP
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  run("Remove display", async () => {
                    await api.removeController(selectedDisplay.id);
                    setSelectedDisplayId(null);
                  })
                }
              >
                Remove display
              </button>
            </>
          ) : (
            <>
              <h2>Displays</h2>
              <p className="hint">
                Each display is one NovaStar controller. Place on outputs puts a fullscreen
                window on each extra GPU screen (HDMI, DisplayPort, USB-C). Keep this desk on
                the laptop panel.
              </p>
              <div className="row">
                <input value={ip} onChange={(event) => setIp(event.target.value)} placeholder="IP" />
                <button
                  disabled={busy}
                  onClick={() => run("Add display", () => api.addController({ host: ip }))}
                >
                  Add
                </button>
              </div>
              <div className="row">
                <button disabled={busy} onClick={() => run("Lab 4", () => api.startLab(4))}>
                  Lab 4
                </button>
                <button disabled={busy} onClick={() => run("Lab 6", () => api.startLab(6))}>
                  Lab 6
                </button>
                <button disabled={busy} onClick={() => run("Stop lab", () => api.stopLab())}>
                  Stop lab
                </button>
              </div>
              <ul className="display-list">
                {controllers.map((controller) => (
                  <li key={controller.id}>
                    <button type="button" onClick={() => setSelectedDisplayId(controller.id)}>
                      <b>{controller.name}</b>
                      <small>
                        {controller.host}:{controller.port} · {controller.viewport.width}×
                        {controller.viewport.height}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
              {controllers.length === 0 ? (
                <p className="empty">No displays. Start Lab 4 or add a sender by IP.</p>
              ) : null}
            </>
          )}
        </aside>
      </div>

      <footer className="wo-timeline">
        <div className="wo-tl-head">
          <strong>Timeline</strong>
          <span>
            {formatTime(wrappedHead)} / {formatTime(timelineDuration)}
          </span>
        </div>
        <div
          className="wo-ruler"
          ref={timelineRef}
          onClick={seekFromTimeline}
          role="slider"
          aria-valuenow={wrappedHead}
          aria-valuemin={0}
          aria-valuemax={timelineDuration}
        >
          <div className="wo-playhead" style={{ left: `${playheadPct}%` }} />
          {clips.map((clip) => {
            const start = clip.start || 0;
            const dur = clip.duration || 10;
            return (
              <button
                key={clip.id}
                type="button"
                className={`wo-tl-clip ${selectedClipId === clip.id ? "sel" : ""}`}
                style={{
                  left: `${(start / timelineDuration) * 100}%`,
                  width: `${Math.max(2, (dur / timelineDuration) * 100)}%`,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedClipId(clip.id);
                  setSelectedDisplayId(null);
                }}
              >
                {clip.name}
              </button>
            );
          })}
        </div>
        <p className="wo-foot-note">
          Watchout-inspired production on one PC: Place on outputs fills this computer’s HDMI /
          DisplayPort / USB-C screens. That is not Dataton Watchout (no clustering, warp, blend,
          or show files). Video still leaves the GPU into each sender — not over Ethernet.
        </p>
      </footer>
    </div>
  );
}
