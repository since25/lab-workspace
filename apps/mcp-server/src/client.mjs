// Minimal HTTP client for the Lab Workspace API. Uses a normal user session cookie,
// so the MCP server inherits the same permissions as that account.
export class LabWorkspaceClient {
  constructor({ baseUrl, username, password, timeoutMs = 20000 }) {
    if (!baseUrl) throw new Error("缺少 LAB_WORKSPACE_URL");
    if (!username || !password) throw new Error("缺少 LAB_USERNAME / LAB_PASSWORD");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.username = username;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.cookie = "";
  }

  async login() {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await parseResponse(response);
    if (!response.ok) throw new Error(data.error || `登录失败（${response.status}）`);
    const cookies = response.headers.getSetCookie?.() ?? [];
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    if (!cookie) throw new Error("登录成功但服务器没有返回会话 Cookie");
    this.cookie = cookie;
  }

  async request(path, options = {}) {
    if (!this.cookie) await this.login();
    let response = await this.#send(path, options);
    if (response.status === 401) {
      this.cookie = "";
      await this.login();
      response = await this.#send(path, options);
    }
    const data = await parseResponse(response);
    if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
    return data;
  }

  async #send(path, options) {
    const headers = new Headers(options.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    return fetch(`${this.baseUrl}${path}`, {
      method: options.method || (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  searchContext(query, months = 2) {
    const params = new URLSearchParams({ q: query, months: String(months) });
    return this.request(`/api/v1/materials/reconcile/search?${params}`);
  }

  submitReconciliation(payload) {
    return this.request("/api/v1/materials/reconcile", { method: "POST", body: payload });
  }

  getRequest(id) {
    return this.request(`/api/v1/materials/reconcile/${id}`);
  }

  listRequests({ status = "all", page = 1 } = {}) {
    const params = new URLSearchParams({ status, page: String(page) });
    return this.request(`/api/v1/materials/reconcile?${params}`);
  }
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: `服务器返回了非 JSON 内容（${response.status}）` };
  }
}
