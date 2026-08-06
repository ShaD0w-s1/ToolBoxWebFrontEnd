import type { ProjectPayload, SectionPayload } from "./domain/toolbox";

const configuredBase = (import.meta.env.VITE_API_BASE_URL || "").trim();
const apiBase = configuredBase.replace(/\/$/, "");
let csrfReady = false;

export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  documents?: T[];
  items?: T[];
  error?: string;
  configured?: boolean;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function url(path: string): string {
  return `${apiBase}${path}`;
}

function cookie(name: string): string {
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : "";
}

/** Django 写请求必须先获取 CSRF Cookie。 */
async function ensureCsrf(): Promise<void> {
  if (csrfReady && cookie("csrftoken")) return;
  const response = await fetch(url("/api/csrf/"), { credentials: "include" });
  if (!response.ok) throw new ApiError("无法获取 CSRF Cookie", response.status);
  csrfReady = true;
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || payload?.ok === false) {
    throw new ApiError(payload?.error || `请求失败（HTTP ${response.status}）`, response.status, payload);
  }
  return payload as T;
}

export const backend = {
  status: () => request<ApiEnvelope>("/api/cloudbase/status/"),
  listProjects: () => request<ApiEnvelope<unknown>>("/api/projects/?limit=100"),
  createProject: (project: ProjectPayload) => request<ApiEnvelope<Record<string, unknown>>>("/api/projects/", { method: "POST", body: project }),
  updateProject: (id: string, project: ProjectPayload) => request<ApiEnvelope>(`/api/projects/${encodeURIComponent(id)}/`, { method: "PATCH", body: project }),
  deleteProject: (id: string) => request<ApiEnvelope>(`/api/projects/${encodeURIComponent(id)}/`, { method: "DELETE" }),
  getTemplate: (type: string) => request<ApiEnvelope<unknown>>(`/api/templates/${encodeURIComponent(type)}/`),
  saveTemplate: (type: string, sections: SectionPayload[]) => request<ApiEnvelope>(`/api/templates/${encodeURIComponent(type)}/`, { method: "PUT", body: { sections } }),
  getToolCart: () => request<ApiEnvelope<unknown>>("/api/tool-cart/"),
  saveToolCart: (items: Array<{ name: string; quantity: number }>) => request<ApiEnvelope>("/api/tool-cart/", { method: "PUT", body: { items } }),
};
