// Talking to the Laravel API (same origin; session cookie + CSRF token, Sanctum SPA).

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let csrf: Promise<void> | null = null;
function ensureCsrf(force = false): Promise<void> {
  if (force || !csrf || !document.cookie.includes("XSRF-TOKEN=")) {
    csrf = fetch("/sanctum/csrf-cookie", { credentials: "same-origin" }).then(() => undefined);
  }
  return csrf;
}
function xsrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

/** Signed out (session ended / switched off): the app shows the sign-in page. */
export const SIGNED_OUT = "sss:signed-out";

async function send(method: string, url: string, body?: unknown, retry = true): Promise<Response> {
  if (method !== "GET") await ensureCsrf();
  const res = await fetch(`/api${url}`, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-XSRF-TOKEN": xsrf() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // CSRF token expired (page open too long): get a new one and send again once
  if (res.status === 419 && retry) {
    await ensureCsrf(true);
    return send(method, url, body, false);
  }
  if (res.status === 401 && url !== "/me" && url !== "/login") window.dispatchEvent(new Event(SIGNED_OUT));
  return res;
}

/** GET a JSON page of data; throws ApiError on 4xx / 5xx (screens show it). */
export async function get<T>(url: string): Promise<T> {
  const res = await send("GET", url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || "Could not load. Check your internet and try again.");
  return data as T;
}

/**
 * POST / PUT / DELETE an action. Answers like the old server actions: { ok: true, ... } or { ok: false, error, fieldErrors? }.
 * A dropped connection becomes { ok: false } too, so forms can show it.
 */
export async function act<T extends { ok: boolean }>(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  try {
    const res = await send(method, url, body ?? {});
    const data = await res.json().catch(() => null);
    if (data && typeof data === "object" && "ok" in data) return data as T;
    if (res.ok) return { ok: true, ...(data ?? {}) } as T;
    return { ok: false, error: (data && data.error) || `Could not save (error ${res.status}). Try again.` } as unknown as T;
  } catch {
    return { ok: false, error: "No connection. Check your internet and try again." } as unknown as T;
  }
}
