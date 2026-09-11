export function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * H9-style take: each sender gets the topmost visible layer that covers it.
 * Layers are control-plane routing, not FPGA mixers — the picture is still
 * whatever is on that sender's HDMI/DP/DVI.
 */
export function takeMap(project) {
  const layers = [...(project.layers || [])]
    .filter((layer) => layer.visible !== false)
    .sort((a, b) => (a.z || 0) - (b.z || 0));
  const routes = [];
  for (const controller of project.controllers || []) {
    let source = controller.inputKey || "HDMI";
    let layerId = null;
    for (const layer of layers) {
      if (layer.controllerIds?.length && !layer.controllerIds.includes(controller.id)) {
        continue;
      }
      if (rectsOverlap(layer, controller.viewport)) {
        source = layer.source || source;
        layerId = layer.id;
      }
    }
    routes.push({
      controllerId: controller.id,
      inputKey: source,
      layerId,
    });
  }
  return routes;
}

export function eyeSaverBrightness(percent) {
  return Math.max(0, Math.min(100, Math.round(percent * 0.55)));
}
