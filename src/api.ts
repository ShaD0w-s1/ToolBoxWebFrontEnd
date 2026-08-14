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
  verifyAirnav: (password: string) => request<{ ok: boolean; verified?: boolean; token?: string; expires_in?: number }>("/api/airnav-verify/", { method: "POST", body: { password } }),
  getConfig: () => request<ApiEnvelope<{ watch_enabled?: boolean; watch_max_users?: number }>>("/api/config/"),
  getAircraftNumbers: () => request<ApiEnvelope<string[]>>("/api/aircraft-numbers/"),
  listControlDocs: () => request<ApiEnvelope<Array<{ _id: string; type: string; fileName: string; cloudObjectId: string; uploadedAt?: string }>>>("/api/control-docs/"),
  uploadControlDoc: (payload: { type: string; fileName: string; content: string }) =>
    request<ApiEnvelope<{ _id: string; type: string; fileName: string; cloudObjectId: string }>>("/api/control-docs/", { method: "POST", body: payload }),
  getControlDocUrl: (id: string) => request<ApiEnvelope<{ downloadUrl: string; fileName?: string }>>(`/api/control-docs/${encodeURIComponent(id)}/`),
  deleteControlDoc: (id: string) => request<ApiEnvelope>(`/api/control-docs/${encodeURIComponent(id)}/`, { method: "DELETE" }),
  listProjects: () => request<ApiEnvelope<unknown>>("/api/projects/?limit=100"),
  createProject: (project: ProjectPayload) => request<ApiEnvelope<Record<string, unknown>>>("/api/projects/", { method: "POST", body: project }),
  updateProject: (id: string, project: ProjectPayload | Partial<ProjectPayload>, expectedVersion?: number) =>
    request<ApiEnvelope>(`/api/projects/${encodeURIComponent(id)}/`, { method: "PATCH", body: { ...project, expected_version: expectedVersion } }),
  applyWorkcard: (id: string, payload: { 机号?: string; 工作内容?: string; 地点?: string; cards?: Array<{ 项次: string; 工卡号: string; 工卡名称: string }>; aircraft_type?: string }) =>
    request<ApiEnvelope<{ written: number; tool_deleted: number; tool_added: number; material_deleted: number; material_added: number }>>(
      `/api/projects/${encodeURIComponent(id)}/apply-workcard/`,
      { method: "POST", body: payload },
    ),
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
  getStandardLibrary: (key: string, token?: string) =>
    request<ApiEnvelope<unknown>>(`/api/standard-libraries/${encodeURIComponent(key)}/`, token ? { headers: { "X-Airnav-Token": token } } : {}),
  saveStandardLibrary: (key: string, rows: Record<string, string>[], token?: string) =>
    request<ApiEnvelope>(`/api/standard-libraries/${encodeURIComponent(key)}/`, { method: "PUT", body: { rows }, ...(token ? { headers: { "X-Airnav-Token": token } } : {}) }),
  getAnnouncement: () => request<ApiEnvelope<unknown>>("/api/announcement/"),
  saveAnnouncement: (content: string) => request<ApiEnvelope>("/api/announcement/", { method: "PUT", body: { content } }),
};
