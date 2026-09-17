import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { linkedinParser } from "./linkedin";
import type { InboundEmailContent } from "./parsers";

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "fixtures/linkedin", name), "utf8");

const email = (
  html: string | null,
  subject = "«AI Engineer»: aviso publicado el 9/15/26",
): InboundEmailContent => ({
  from: "Alertas de empleo de LinkedIn <jobalerts-noreply@linkedin.com>",
  to: ["u_a0000000@ingest.example.com"],
  subject,
  html,
  text: null,
  receivedAt: new Date("2026-09-17T12:00:00Z"),
});

describe("linkedinParser: alertas de empleo", () => {
  it("extrae el único aviso con todos sus campos", () => {
    const res = linkedinParser.parse(email(fixture("alerta-un-aviso.html")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs).toHaveLength(1);
    const job = res.jobs[0]!;
    expect(job.title).toBe("AI Engineer (Remote)");
    expect(job.companyRaw).toBe("Contoso Cloud");
    expect(job.locationRaw).toBe("Argentina");
    expect(job.modality).toBe("remoto");
    expect(job.badges).toEqual(["Solicitud sencilla"]);
    expect(job.source).toMatchObject({
      kind: "email_linkedin",
      externalId: "4400000001",
      url: "https://www.linkedin.com/jobs/view/4400000001/",
    });
    expect(job.source.name).toBe("alerta «AI Engineer»");
  });

  it("extrae los cinco avisos de una alerta larga, sin repetir ids", () => {
    const res = linkedinParser.parse(email(fixture("alerta-cinco-avisos.html")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs).toHaveLength(5);
    expect(res.jobs.map((j) => j.title)).toEqual([
      "Senior AI Engineer",
      "LLM Engineer",
      "AI Platform Engineer",
      "Applied AI Engineer",
      "Agent Engineer",
    ]);
    expect(new Set(res.jobs.map((j) => j.source.externalId)).size).toBe(5);
    expect(res.jobs.every((j) => j.modality === "remoto")).toBe(true);
  });

  it("toma la ubicación tal como viene cuando es una ciudad", () => {
    const res = linkedinParser.parse(email(fixture("alerta-ubicacion-ciudad.html")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs[0]).toMatchObject({ locationRaw: "Salta", modality: "remoto" });
  });

  it("ignora el texto del pie que no es un badge conocido", () => {
    const res = linkedinParser.parse(email(fixture("alerta-tres-avisos.html")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs).toHaveLength(3);
    expect(res.jobs[2]!.badges).toEqual([]);
  });

  it("no inventa países, descripción ni fecha: la alerta no los trae", () => {
    const res = linkedinParser.parse(email(fixture("alerta-dos-avisos.html")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const job of res.jobs) {
      expect(job.countriesAllowed).toBeNull(); // el prefiltro tiene que marcar riesgo de ubicación
      expect(job.jdText).toBeNull(); // sin descripción: queda pendiente_jd
      expect(job.postedAt).toBeNull();
      expect(job.salaryMinUsd).toBeNull();
      expect(job.candidatesCount).toBeNull();
    }
  });

  it("usa un nombre de fuente genérico si el asunto no trae la alerta", () => {
    const res = linkedinParser.parse(email(fixture("alerta-un-aviso.html"), "Empleos para vos"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs[0]!.source.name).toBe("alerta de LinkedIn");
  });
});

describe("linkedinParser: falla cerrado", () => {
  it("manda a la cola manual un email de LinkedIn que no es una alerta con tarjetas", () => {
    for (const f of ["no-es-alerta-digest-empresa.html", "no-es-alerta-recordatorio.html"]) {
      const res = linkedinParser.parse(email(fixture(f)));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toMatch(/tarjeta/i);
    }
  });

  it("falla si el email no trae HTML", () => {
    const res = linkedinParser.parse(email(null));
    expect(res).toEqual({ ok: false, reason: expect.stringMatching(/html/i) });
  });

  it("falla el email entero si una tarjeta no se entiende, en vez de extraer a medias", () => {
    // el id aparece en el link del logo y en el del título: hay que sacar los dos
    const html = fixture("alerta-dos-avisos.html").replaceAll(
      "https://www.linkedin.com/comm/jobs/view/4400000002/",
      "https://www.linkedin.com/comm/jobs/collections/",
    );
    const res = linkedinParser.parse(email(html));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/id/i);
  });
});
