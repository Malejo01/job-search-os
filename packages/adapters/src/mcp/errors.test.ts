import { InvalidTransitionError } from "@job-search-os/pipeline";
import { describe, expect, it, vi } from "vitest";
import { ApplicantFailure } from "../applicant/context";
import { JobNotFoundError } from "../applications/apply-event";
import { JdNotPendingError } from "../ingest/attach-jd";
import { PersonQuotaError } from "../quota/person-quota";
import { mcpFailure, mcpFailureResult } from "./errors";

/** Error con la forma que deja Drizzle: el message trae la consulta y sus parámetros. */
function drizzleLikeError() {
  return Object.assign(
    new Error(
      'Failed query: insert into "jobs" ("title", "jd_text") values ($1, $2)\nparams: Titulo Reservado,Texto Reservado',
    ),
    { cause: { name: "PostgresError", code: "23505", constraint_name: "jobs_dedup" } },
  );
}

const textOf = (r: { content: { text: string }[] }) => r.content[0]!.text;

describe("mcpFailureResult: solo códigos y mensajes fijos", () => {
  it("un error de la base no muestra la consulta ni los parámetros", () => {
    const out = textOf(mcpFailureResult(drizzleLikeError(), () => {}));
    expect(out).not.toContain("Failed query");
    expect(out).not.toContain("Reservado");
    expect(out).not.toContain("insert into");
    expect(out).not.toContain("jobs_dedup");
  });

  it("un error cualquiera no muestra su message", () => {
    const out = textOf(mcpFailureResult(new Error("detalle interno 12345"), () => {}));
    expect(out).not.toContain("detalle interno");
    expect(out).toContain("error_interno");
  });

  it("algo que no es un Error tampoco se muestra", () => {
    const out = textOf(mcpFailureResult("texto suelto con datos", () => {}));
    expect(out).not.toContain("texto suelto");
  });

  it("marca la respuesta como error y empieza con 'no se pudo'", () => {
    const r = mcpFailureResult(new Error("x"), () => {});
    expect(r.isError).toBe(true);
    expect(textOf(r).startsWith("no se pudo")).toBe(true);
  });

  it("el detalle va al log solo con código, constraint y nombre", () => {
    const log = vi.fn();
    mcpFailureResult(drizzleLikeError(), log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toEqual({
      name: "PostgresError",
      code: "23505",
      constraint: "jobs_dedup",
    });
    expect(JSON.stringify(log.mock.calls[0])).not.toContain("Reservado");
  });
});

describe("mcpFailure: errores esperados con mensaje fijo por código", () => {
  it.each([
    ["job_not_found", "oferta_inexistente"],
    ["profile_not_found", "perfil_inexistente"],
    ["empty_question", "pregunta_vacia"],
    ["empty_form", "formulario_vacio"],
  ] as const)("ApplicantFailure %s → %s, sin el detalle", (code, expected) => {
    const f = mcpFailure(new ApplicantFailure(code, "detalle-con-id-123"));
    expect(f.code).toBe(expected);
    expect(f.message).not.toContain("detalle-con-id-123");
    expect(f.message.length).toBeGreaterThan(0);
  });

  it.each([
    ["manual_jobs", "cuota_ofertas"],
    ["raw_bytes", "cuota_espacio"],
  ] as const)("PersonQuotaError %s → %s", (kind, expected) => {
    expect(mcpFailure(new PersonQuotaError(kind)).code).toBe(expected);
  });

  it("la cuota de respuestas guardadas tiene su código y habla de respuestas, no de avisos", () => {
    const f = mcpFailure(
      new PersonQuotaError(
        "raw_bytes",
        "llegaste al máximo de respuestas guardadas: borrá alguna que ya no uses",
      ),
    );
    expect(f.code).toBe("cuota_respuestas");
    expect(f.message).toContain("respuestas");
    expect(f.message).not.toContain("avisos");
    expect(mcpFailure(new PersonQuotaError("raw_bytes")).code).toBe("cuota_espacio");
  });

  it("una oferta inexistente y una ajena dan exactamente la misma respuesta", () => {
    const missing = mcpFailureResult(new JobNotFoundError(), () => {});
    const foreign = mcpFailureResult(new ApplicantFailure("job_not_found", "id-ajeno"), () => {});
    expect(missing).toEqual(foreign);
    expect(missing.content[0]!.text).toContain("oferta_inexistente");
    expect(missing.content[0]!.text).not.toContain("id-ajeno");
  });

  it("pegar la JD en una oferta que no está pendiente tiene su código", () => {
    const f = mcpFailure(new JdNotPendingError());
    expect(f.code).toBe("oferta_no_pendiente");
    expect(f.expected).toBe(true);
  });

  it("una transición inválida tiene su código", () => {
    expect(mcpFailure(new InvalidTransitionError("evaluada", "interview")).code).toBe(
      "transicion_invalida",
    );
  });

  it("JD corta y JD larga se reconocen por nombre", () => {
    const short = Object.assign(new Error("x"), { name: "JdTooShortError" });
    const long = Object.assign(new Error("x"), { name: "JdTooLongError" });
    expect(mcpFailure(short).code).toBe("jd_corta");
    expect(mcpFailure(long).code).toBe("jd_larga");
  });

  it("un error esperado no se manda al log", () => {
    const log = vi.fn();
    mcpFailureResult(new PersonQuotaError("manual_jobs"), log);
    expect(log).not.toHaveBeenCalled();
  });
});
