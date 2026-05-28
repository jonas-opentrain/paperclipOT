declare global {
  interface Window {
    __PAPERCLIP_BASE_PATH__?: string;
  }
}

function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed || trimmed === ".") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function getPublicBasePath(): string {
  if (typeof window !== "undefined") {
    const injected = normalizeBasePath(window.__PAPERCLIP_BASE_PATH__);
    if (injected) return injected;
  }

  const configured = normalizeBasePath(import.meta.env.VITE_PAPERCLIP_BASE_PATH);
  if (configured) return configured;

  const viteBase = normalizeBasePath(import.meta.env.BASE_URL);
  return viteBase === "/" ? "" : viteBase;
}

export function withPublicBasePath(path: string): string {
  const basePath = getPublicBasePath();
  if (!basePath) return path;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) return path;
  if (path === "/") return basePath || "/";
  if (!path.startsWith("/")) return path;
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
  return `${basePath}${path}`;
}

export function publicWebSocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${withPublicBasePath(path)}`;
}
