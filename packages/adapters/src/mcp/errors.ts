import { ApplicantFailure } from "../applicant/context";
import { JobNotFoundError } from "../applications/apply-event";
import { JdNotPendingError } from "../ingest/attach-jd";
import { createLogger } from "../logger";
import { safeDbError, type SafeDbError } from "../logging/safe-error";
import { PersonQuotaError } from "../quota/person-quota";

/**
 * Errores de las tools del MCP: la respuesta lleva solo un código y un mensaje fijo, nunca el
 * `message` de una excepción (en la base trae la consulta con sus parámetros: JD, título, empresa).
 * Lo inesperado va al log con `safeDbError` y a la persona le llega `error_interno`.
 */
export type McpFailure = { code: string; message: string; expected: boolean };

const APPLICANT: Record<ApplicantFailure["code"], { code: string; message: string }> = {
  job_not_found: { code: "oferta_inexistente", message: "No existe esa oferta en tu cuenta." },
  profile_not_found: { code: "perfil_inexistente", message: "Todavía no hay un perfil cargado." },
  empty_question: { code: "pregunta_vacia", message: "La pregunta o la respuesta está vacía." },
  empty_form: { code: "formulario_vacio", message: "El formulario no tiene preguntas." },
};

const QUOTA: Record<PersonQuotaError["kind"], { code: string; message: string }> = {
  manual_jobs: {
    code: "cuota_ofertas",
    message: "Llegaste al máximo de ofertas cargadas a mano.",
  },
  raw_bytes: {
    code: "cuota_espacio",
    message: "Llegaste al máximo de espacio para avisos guardados.",
  },
};

/** Errores de otros módulos que se reconocen por nombre (no se importan acá). */
const BY_NAME: Record<string, { code: string; message: string }> = {
  InvalidTransitionError: {
    code: "transicion_invalida",
    message: "Ese cambio de estado no vale desde el estado actual de la oferta.",
  },
  JdTooShortError: {
    code: "jd_corta",
    message: "La descripción es muy corta (mínimo 200 caracteres).",
  },
  JdTooLongError: { code: "jd_larga", message: "La descripción es demasiado larga." },
};

export function mcpFailure(e: unknown): McpFailure {
  if (e instanceof ApplicantFailure) return { ...APPLICANT[e.code], expected: true };
  // Una oferta inexistente y una de otra persona dan el mismo código: no se revela cuál es
  if (e instanceof JobNotFoundError) return { ...APPLICANT.job_not_found, expected: true };
  if (e instanceof PersonQuotaError) {
    // La cuota de respuestas guardadas usa el tipo `raw_bytes` con su propio texto
    if (e.kind === "raw_bytes" && e.message.includes("respuestas guardadas")) {
      return {
        code: "cuota_respuestas",
        message: "Llegaste al máximo de respuestas guardadas: borrá alguna o acortá las largas.",
        expected: true,
      };
    }
    return { ...QUOTA[e.kind], expected: true };
  }
  if (e instanceof JdNotPendingError) {
    return {
      code: "oferta_no_pendiente",
      message: "La oferta ya tiene descripción o ya se evaluó: no se cambia desde acá.",
      expected: true,
    };
  }
  const known = e instanceof Error ? BY_NAME[e.name] : undefined;
  if (known) return { ...known, expected: true };
  return {
    code: "error_interno",
    message: "No se pudo completar la acción. Probá de nuevo en un rato.",
    expected: false,
  };
}

/**
 * Respuesta de falla de una tool. Lo inesperado se manda a `log` como `safeDbError(e)`: código
 * SQLSTATE, constraint y nombre de la clase, sin message, consulta ni parámetros.
 */
/**
 * La que usa la ruta: el log (con `user_id`) se arma acá para que la ruta no cree loggers ni
 * pueda escribir el error o el request en ningún lado.
 */
export const mcpFailed = (e: unknown, userId: string, tool?: string) =>
  mcpFailureResult(e, (detail) =>
    createLogger({ user_id: userId, source: "mcp", ...(tool ? { tool } : {}) }).error(
      { err: detail },
      "mcp: la tool falló",
    ),
  );

type McpLog = (userId: string, tool: string, detail: SafeDbError) => void;

const defaultMcpLog: McpLog = (userId, tool, detail) =>
  createLogger({ user_id: userId, source: "mcp", tool }).error(
    { err: detail },
    "mcp: la tool falló",
  );

/**
 * Envuelve el callback de una tool: cualquier excepción (también la de resolver a la persona)
 * sale como respuesta fija. Un solo punto para todas las tools, así una tool nueva no puede
 * olvidarse del `try/catch`. El log lleva `user_id` y el nombre de la tool, nunca los parámetros.
 * Lo que la tool ya devuelve (incluidas sus fallas con código) pasa sin cambios.
 */
export function guardMcpTool<A, C, R>(
  tool: string,
  resolveUser: (ctx: C) => Promise<string>,
  run: (args: A, ctx: C) => Promise<R>,
  log: McpLog = defaultMcpLog,
): (args: A, ctx: C) => Promise<R | ReturnType<typeof mcpFailureResult>> {
  return async (args, ctx) => {
    try {
      return await run(args, ctx);
    } catch (e) {
      let userId = "desconocido";
      try {
        userId = await resolveUser(ctx);
      } catch {
        // sin persona resuelta: el log queda con "desconocido"
      }
      return mcpFailureResult(e, (detail) => log(userId, tool, detail));
    }
  };
}

export function mcpFailureResult(e: unknown, log: (detail: SafeDbError) => void) {
  const failure = mcpFailure(e);
  if (!failure.expected) log(safeDbError(e));
  return {
    content: [{ type: "text" as const, text: `no se pudo (${failure.code}): ${failure.message}` }],
    isError: true,
  };
}
