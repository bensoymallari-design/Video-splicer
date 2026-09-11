const headers = { "Content-Type": "application/json" };

async function json(method, url, body) {
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const api = {
  project: () => json("GET", "/api/project"),
  addController: (payload) => json("POST", "/api/controllers", payload),
  patchController: (id, payload) => json("PATCH", `/api/controllers/${id}`, payload),
  removeController: (id) => json("DELETE", `/api/controllers/${id}`),
  probe: (id) => json("POST", `/api/controllers/${id}/probe`),
  command: (id, payload) => json("POST", `/api/controllers/${id}/command`, payload),
  group: (payload) => json("POST", "/api/group/command", payload),
  layout: (payload) => json("POST", "/api/layout", payload),
  addLayer: (payload) => json("POST", "/api/layers", payload),
  patchLayer: (id, payload) => json("PATCH", `/api/layers/${id}`, payload),
  removeLayer: (id) => json("DELETE", `/api/layers/${id}`),
  addPreset: (name) => json("POST", "/api/presets", { name }),
  applyPreset: (id) => json("POST", `/api/presets/${id}/apply`),
  removePreset: (id) => json("DELETE", `/api/presets/${id}`),
  startLab: (count) => json("POST", "/api/lab/start", { count }),
  stopLab: () => json("POST", "/api/lab/stop"),
  masterBrightness: (value) => json("POST", "/api/master-brightness", { value }),
  take: () => json("POST", "/api/take"),
  ftb: (payload) => json("POST", "/api/ftb", payload),
  settings: (payload) => json("POST", "/api/settings", payload),
  playlistAdd: (payload) => json("POST", "/api/playlist/add", payload),
  playlistNext: () => json("POST", "/api/playlist/next"),
  importProject: (payload) => json("POST", "/api/project/import", payload),
};

export function connectSocket(onProject) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "project") onProject(msg.payload);
  };
  return ws;
}
