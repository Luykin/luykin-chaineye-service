export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

type RequestOptions = RequestInit & {
  body?: BodyInit | Record<string, unknown> | null;
};

function normalizeBaseUrl(value?: string | null) {
  const base = (value || "").trim();
  return base.replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  return normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
}

export function buildApiUrl(input: string) {
  if (/^https?:\/\//i.test(input)) {
    return input;
  }

  const normalizedPath = input.startsWith("/") ? input : `/${input}`;
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    return normalizedPath;
  }

  return `${baseUrl}${normalizedPath}`;
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export async function apiRequest<T = unknown>(
  input: string,
  options: RequestOptions = {}
): Promise<T> {
  const { body, headers, ...rest } = options;
  const finalHeaders = new Headers(headers || {});

  let finalBody: BodyInit | null | undefined = body as BodyInit | null | undefined;
  if (
    body &&
    typeof body === "object" &&
    !(body instanceof FormData) &&
    !(body instanceof URLSearchParams) &&
    !(body instanceof Blob)
  ) {
    finalHeaders.set("Content-Type", "application/json");
    finalBody = JSON.stringify(body);
  }

  const requestUrl = buildApiUrl(input);

  const response = await fetch(requestUrl, {
    credentials: "include",
    ...rest,
    headers: finalHeaders,
    body: finalBody,
  });

  const data = await parseResponse(response);
  if (!response.ok) {
    const message =
      typeof data === "object" && data && "error" in data
        ? String((data as { error?: string }).error || "请求失败")
        : `请求失败 (${response.status})`;
    throw new ApiError(message, response.status, data);
  }

  return data as T;
}
