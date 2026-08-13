import type { ProjectPayload, SectionPayload } from "./domain/toolbox";

const configuredBase = (import.meta.env.VITE_API_BASE_URL || "").trim();
const apiBase = configuredBase.replace(/\/$/, "");
let csrfReady = false;
let csrfToken = "";

export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  documents?: T[];
  items?: T[];
  list?: T[];
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
  if (csrfReady && csrfToken) return;
  const response = await fetch(url("/api/csrf/"), { credentials: "include" });
  if (!response.ok) throw new ApiError("无法获取 CSRF Cookie", response.status);
  const payload = await response.json() as { csrf_token?: string };
  csrfToken = payload.csrf_token || "";
  if (!csrfToken) throw new ApiError("Backend did not return a CSRF token", response.status, payload);
  csrfReady = true;
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) await ensureCsrf();

  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const token = csrfToken || cookie("csrftoken");
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
  verifyAirnav: (password: string) => request<ApiEnvelope>("/api/airnav-verify/", { method: "POST", body: { password } }),
  listProjects: () => request<ApiEnvelope<unknown>>("/api/projects/?limit=100"),
  createProject: (project: ProjectPayload) => request<ApiEnvelope<Record<string, unknown>>>("/api/projects/", { method: "POST", body: project }),
  updateProject: (id: string, project: ProjectPayload | Partial<ProjectPayload>, expectedVersion?: number) =>
    request<ApiEnvelope>(`/api/projects/${encodeURIComponent(id)}/`, { method: "PATCH", body: { ...project, expected_version: expectedVersion } }),
  deleteProject: (id: string) => request<ApiEnvelope>(`/api/projects/${encodeURIComponent(id)}/`, { method: "DELETE" }),
  poll: (revision?: string) =>
    request<ApiEnvelope<{ revision: string; changed: boolean; poll_after_ms?: number }>>(
      `/api/poll/${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`,
    ),
  getTemplate: (type: string) => request<ApiEnvelope<unknown>>(`/api/templates/${encodeURIComponent(type)}/`),
  saveTemplate: (type: string, sections: SectionPayload[]) => request<ApiEnvelope>(`/api/templates/${encodeURIComponent(type)}/`, { method: "PUT", body: { sections } }),
  getMaterialTemplate: (type: string) => request<ApiEnvelope<unknown>>(`/api/material-templates/${encodeURIComponent(type)}/`),
  saveMaterialTemplate: (type: string, sections: SectionPayload[]) => request<ApiEnvelope>(`/api/material-templates/${encodeURIComponent(type)}/`, { method: "PUT", body: { sections } }),
  getToolCart: () => request<ApiEnvelope<unknown>>("/api/tool-cart/"),
  saveToolCart: (items: Array<{ name: string; quantity: number }>) => request<ApiEnvelope>("/api/tool-cart/", { method: "PUT", body: { items } }),
  getStandardLibrary: (key: string) => request<ApiEnvelope<unknown>>(`/api/standard-libraries/${encodeURIComponent(key)}/`),
  saveStandardLibrary: (key: string, rows: Record<string, string>[]) =>
    request<ApiEnvelope>(`/api/standard-libraries/${encodeURIComponent(key)}/`, { method: "PUT", body: { rows } }),
  getAnnouncement: () => request<ApiEnvelope<unknown>>("/api/announcement/"),
  saveAnnouncement: (content: string) => request<ApiEnvelope>("/api/announcement/", { method: "PUT", body: { content } }),
};
