export function assignOutputs(screens, count) {
  const list = Array.isArray(screens) ? screens.filter(Boolean) : [];
  const extras = list.filter((screen) => !screen.isPrimary);
  const pool = extras.length ? extras : list;
  return Array.from({ length: count }, (_, i) => pool[i] || null);
}

export function windowFeatures(screen) {
  if (!screen) return "popup=yes,width=1280,height=720";
  const left = Math.round(Number(screen.left) || 0);
  const top = Math.round(Number(screen.top) || 0);
  const width = Math.max(320, Math.round(Number(screen.width) || 1280));
  const height = Math.max(180, Math.round(Number(screen.height) || 720));
  return `popup=yes,left=${left},top=${top},width=${width},height=${height}`;
}

export async function listScreens() {
  const fallback = [
    {
      id: "current",
      label: "This screen",
      left: window.screen?.availLeft || 0,
      top: window.screen?.availTop || 0,
      width: window.screen?.availWidth || window.innerWidth,
      height: window.screen?.availHeight || window.innerHeight,
      isPrimary: true,
    },
  ];
  if (typeof window.getScreenDetails !== "function") {
    return { screens: fallback, permission: "unsupported" };
  }
  try {
    const details = await window.getScreenDetails();
    const screens = [...(details.screens || [])].map((screen, index) => ({
      id: String(index),
      label: screen.label || `Output ${index + 1}`,
      left: screen.availLeft,
      top: screen.availTop,
      width: screen.availWidth,
      height: screen.availHeight,
      isPrimary: Boolean(screen.isPrimary),
    }));
    return {
      screens: screens.length ? screens : fallback,
      permission: "granted",
    };
  } catch {
    return { screens: fallback, permission: "denied" };
  }
}
