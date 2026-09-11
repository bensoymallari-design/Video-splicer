import { useEffect, useMemo, useRef, useState } from "react";
import { connectSocket } from "./api.js";

export default function Output({ controllerId }) {
  const [project, setProject] = useState(null);
  const [clock, setClock] = useState({ playing: false, mediaTime: 0, loop: true });
  const videos = useRef(new Map());
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    fetch("/api/project")
      .then((r) => r.json())
      .then(setProject)
      .catch(() => {});
    const ws = connectSocket((msg) => {
      if (msg.type === "project") setProject(msg.payload);
      if (msg.type === "clock") setClock(msg.payload);
    });
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => {
      ws.close();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    for (const video of videos.current.values()) {
      if (!video) continue;
      const t = clock.mediaTime || 0;
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const target = clock.loop ? t % video.duration : Math.min(t, video.duration);
        if (Math.abs(video.currentTime - target) > 0.35) video.currentTime = target;
      }
      if (clock.playing) video.play().catch(() => {});
      else video.pause();
    }
  }, [clock]);

  const controller = project?.controllers.find((c) => c.id === controllerId);
  const layout = useMemo(() => {
    if (!project || !controller) return null;
    const vp = controller.viewport;
    const scale = Math.max(size.w / vp.width, size.h / vp.height);
    return {
      scale,
      left: -vp.x * scale + (size.w - vp.width * scale) / 2,
      top: -vp.y * scale + (size.h - vp.height * scale) / 2,
      width: project.canvas.width * scale,
      height: project.canvas.height * scale,
    };
  }, [project, controller, size]);

  if (!project) return <div className="output-root">Connecting display…</div>;
  if (!controller) {
    return (
      <div className="output-root">
        Unknown display. Open this window from Open displays on the production desk.
      </div>
    );
  }

  return (
    <div className="output-root">
      <div
        className="output-stage"
        style={{
          left: layout.left,
          top: layout.top,
          width: layout.width,
          height: layout.height,
        }}
      >
        {(project.clips || []).map((clip) => {
          const media = project.media?.find((item) => item.id === clip.mediaId);
          if (!media) return null;
          const style = {
            left: (clip.x / project.canvas.width) * 100 + "%",
            top: (clip.y / project.canvas.height) * 100 + "%",
            width: (clip.width / project.canvas.width) * 100 + "%",
            height: (clip.height / project.canvas.height) * 100 + "%",
          };
          if (media.kind === "image") {
            return <img key={clip.id} alt="" src={media.url} className="output-clip" style={style} />;
          }
          return (
            <video
              key={clip.id}
              className="output-clip"
              style={style}
              src={media.url}
              muted
              playsInline
              loop={clock.loop}
              ref={(node) => {
                if (node) videos.current.set(clip.id, node);
                else videos.current.delete(clip.id);
              }}
            />
          );
        })}
      </div>
      <div className="output-tag">{controller.name}</div>
    </div>
  );
}
