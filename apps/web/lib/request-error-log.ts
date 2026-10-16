// Arma lo que se loguea cuando Next reporta un error de request (onRequestError).
// Lista blanca: nunca message, stack, cause, headers ni query (pueden traer JDs, emails o parámetros SQL).
// Pura y sin imports: instrumentation.ts se compila también para edge.

export type RequestErrorLog = {
  errorName: string;
  digest?: string;
  code?: string;
  path: string;
  method: string;
  routeType: string;
  routerKind: string;
  routePath: string;
};

type Rec = Record<string, unknown>;

function asRecord(v: unknown): Rec | null {
  return typeof v === "object" && v !== null ? (v as Rec) : null;
}

/** Ruta sin query ni fragmento. */
export function stripQuery(path: unknown): string {
  if (typeof path !== "string") return "";
  return path.split(/[?#]/)[0] ?? "";
}

/** Solo valores cortos y de forma de código (SQLSTATE, ECONNRESET…), por si el campo trae texto libre. */
function safeCode(v: unknown): string | undefined {
  return typeof v === "string" && /^[A-Za-z0-9_.-]{1,32}$/.test(v) ? v : undefined;
}

function safeName(v: unknown): string {
  return typeof v === "string" && /^[A-Za-z0-9_$]{1,64}$/.test(v) ? v : "Error";
}

export function buildRequestErrorLog(
  error: unknown,
  request: { path?: unknown; method?: unknown },
  context: { routeType?: unknown; routerKind?: unknown; routePath?: unknown },
): RequestErrorLog {
  const err = asRecord(error);
  const cause = asRecord(err?.cause);
  const out: RequestErrorLog = {
    errorName: safeName(err?.name),
    path: stripQuery(request.path),
    method: typeof request.method === "string" ? request.method : "",
    routeType: typeof context.routeType === "string" ? context.routeType : "",
    routerKind: typeof context.routerKind === "string" ? context.routerKind : "",
    routePath: typeof context.routePath === "string" ? context.routePath : "",
  };
  const digest = safeCode(err?.digest);
  if (digest) out.digest = digest;
  // El SQLSTATE de postgres-js viene en la causa del error de Drizzle.
  const code = safeCode(err?.code) ?? safeCode(cause?.code);
  if (code) out.code = code;
  return out;
}
