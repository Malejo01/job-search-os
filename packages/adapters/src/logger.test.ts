import pino from "pino";
import { describe, expect, it } from "vitest";
import { loggerOptions } from "./logger";

/** Devuelve la línea que escribiría el logger, ya interpretada. */
function logLine(write: (log: pino.Logger) => void): Record<string, unknown> {
  const lines: string[] = [];
  const log = pino(loggerOptions({ task: "prueba" }), {
    write: (line: string) => {
      lines.push(line);
    },
  });
  write(log);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

/** Forma de un error de consulta de Drizzle: la consulta y sus parámetros viajan en el error. */
function queryError(): Error {
  const cause = Object.assign(new Error("duplicate key"), {
    name: "PostgresError",
    code: "23505",
    constraint_name: "users_email_unique",
  });
  return Object.assign(new Error("Failed query: select 1\nparams: persona@example.com,dato"), {
    name: "DrizzleQueryError",
    query: "select * from users where email = $1",
    params: ["persona@example.com", "dato-sensible"],
    cause,
  });
}

describe("logger", () => {
  it.each(["err", "error"])("un error de consulta en `%s` no deja los parámetros", (key) => {
    const line = logLine((log) => log.error({ [key]: queryError() }, "falló"));
    const text = JSON.stringify(line);
    expect(text).not.toContain("persona@example.com");
    expect(text).not.toContain("dato-sensible");
    expect(text).not.toContain("select * from users");
    expect(text).not.toContain("Failed query");
    expect(line[key]).toEqual({
      name: "PostgresError",
      code: "23505",
      constraint: "users_email_unique",
    });
  });

  it("un error común queda solo con su nombre", () => {
    const line = logLine((log) =>
      log.error({ err: new TypeError("texto con persona@example.com") }, "falló"),
    );
    expect(line.err).toEqual({ name: "TypeError" });
  });

  it("un motivo en texto se conserva", () => {
    const line = logLine((log) => log.info({ error: "sin parser", err: "record_failed" }, "ok"));
    expect(line.error).toBe("sin parser");
    expect(line.err).toBe("record_failed");
  });

  it.each(["authorization", "cookie", "password", "token", "email", "params", "query"])(
    "oculta el campo `%s`, también dentro de un objeto",
    (key) => {
      const line = logLine((log) =>
        log.info({ [key]: "valor-secreto", req: { [key]: "valor-secreto" } }, "pedido"),
      );
      expect(JSON.stringify(line)).not.toContain("valor-secreto");
    },
  );

  it("conserva los identificadores que sirven para seguir un caso", () => {
    const line = logLine((log) => log.info({ user_id: "u1", job_id: "j1" }, "ok"));
    expect(line).toMatchObject({ user_id: "u1", job_id: "j1", task: "prueba", msg: "ok" });
  });
});
