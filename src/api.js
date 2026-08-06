const configuredBase = (import.meta.env.VITE_API_BASE_URL || "").trim();
const apiBase = configuredBase.replace(/\/$/, "");
let csrfReady = false;

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function url(path) {
  return `${apiBase}${path}`;
}

function cookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : "";
}

async function ensureCsrf() {
  if (csrfReady && cookie("csrftoken")) return;
  const response = await fetch(url("/api/csrf/"), { credentials: "include" });
  if (!response.ok) throw new ApiError("无法获取 CSRF Cookie", response.status);
  csrfReady = true;
}

async function request(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) await ensureCsrf();

  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const token = cookie("csrftoken");
  if (token) headers.set("X-CSRFToken", token);

  const response = await fetch(url(path), {
    ...options,
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "include",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new ApiError(payload?.error || `请求失败（HTTP ${response.status}）`, response.status, payload);
  }
  return payload;
}

export const backend = {
  status: () => request("/api/cloudbase/status/"),
  listProjects: () => request("/api/projects/?limit=100"),
  createProject: (project) => request("/api/projects/", { method: "POST", body: project }),
  updateProject: (id, project) => request(`/api/projects/${encodeURIComponent(id)}/`, { method: "PATCH", body: project }),
  deleteProject: (id) => request(`/api/projects/${encodeURIComponent(id)}/`, { method: "DELETE" }),
  getTemplate: (type) => request(`/api/templates/${encodeURIComponent(type)}/`),
  saveTemplate: (type, sections) => request(`/api/templates/${encodeURIComponent(type)}/`, { method: "PUT", body: { sections } }),
  getToolCart: () => request("/api/tool-cart/"),
  saveToolCart: (items) => request("/api/tool-cart/", { method: "PUT", body: { items } }),
};
