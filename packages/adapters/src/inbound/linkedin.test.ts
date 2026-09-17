import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { linkedinParser } from "./linkedin";
import type { InboundEmailContent } from "./parsers";

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "fixtures/linkedin", name), "utf8");

const email = (
  html: string | null,
  subject: string | null = "«AI Engineer»: aviso publicado el 9/15/26",
): InboundEmailContent => ({
  from: "Alertas de empleo de LinkedIn <jobalerts-noreply@linkedin.com>",
  to: ["u_a0000000@ingest.example.com"],
  subject,
  html,
  text: null,
  receivedAt: new Date("2026-09-17T12:00:00Z"),
});

/** Las 8 alertas reales del 2026-09-17, anonimizadas: 17 avisos en total. */
const ALERTAS: { fixture: string; avisos: number }[] = [
  { fixture: "alerta-un-aviso.html", avisos: 1 },
  { fixture: "alerta-dos-avisos.html", avisos: 2 },
  { fixture: "alerta-tres-avisos.html", avisos: 3 },
  { fixture: "alerta-tres-empresas.html", avisos: 3 },
  { fixture: "alerta-cinco-avisos.html", avisos: 5 },
  { fixture: "alerta-ubicacion-ciudad.html", avisos: 1 },
  { fixture: "alerta-dos-badges.html", avisos: 1 },
  { fixture: "alerta-badge-crecimiento.html", avisos: 1 },
];

describe("linkedinParser: cobertura de las alertas reales", () => {
  it.each(ALERTAS)("$fixture: extrae $avisos avisos completos", ({ fixture: f, avisos }) => {
    const res = linkedinParser.parse(email(fixture(f)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs).toHaveLength(avisos);
    for (const job of res.jobs) {
      // ningún campo obligatorio vacío y ninguno inventado
      expect(job.title.length).toBeGreaterThan(2);
      expect(job.companyRaw.length).toBeGreaterThan(1);
      expect(job.locationRaw).toBeTruthy();
      expect(job.source.externalId).toMatch(/^\d+$/);
      expect(job.source.url).toBe(`https://www.linkedin.com/jobs/view/${job.source.externalId}/`);
      expect(job.source.kind).toBe("email_linkedin");
      expect(job.countriesAllowed).toBeNull();
      expect(job.jdText).toBeNull();
    }
  });

  it("las 8 alertas suman los 17 avisos del email reenviado", () => {
    const total = ALERTAS.reduce((acc, { fixture: f }) => {
      const res = linkedinParser.parse(email(fixture(f)));
      return acc + (res.ok ? res.jobs.length : 0);
    }, 0);
    expect(total).toBe(17);
  });

  it("reconoce varios badges en la misma tarjeta", () => {
    const res = linkedinParser.parse(email(fixture("alerta-dos-badges.html")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs[0]!.badges).toEqual(["En busca de personal", "Solicitud sencilla"]);
  });
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

/** Tarjeta mínima con la misma forma que la real, para cubrir variantes que el email del día no trajo. */
const tarjeta = (linea: string, titulo = "AI Engineer", id = "999") =>
  `<td class="pt-3" data-test-id="job-card" style="padding-top: 24px;">
     <a href="https://www.linkedin.com/comm/jobs/view/${id}/"><img alt="Empresa" src="x.png"></a>
     <a href="https://www.linkedin.com/comm/jobs/view/${id}/">${titulo}</a>
     <p>${linea}</p>
   </td>`;

describe("linkedinParser: variantes de modalidad y texto", () => {
  it.each([
    ["Empresa · Buenos Aires (Híbrido)", "hibrido", "Buenos Aires"],
    ["Empresa · Salta (Presencial)", "presencial", "Salta"],
    ["Empresa · Argentina (En remoto)", "remoto", "Argentina"],
    ["Empresa · Argentina (Jornada completa)", "desconocida", "Argentina"],
    ["Empresa · Argentina", "desconocida", "Argentina"],
  ])("%s → %s", (linea, modality, locationRaw) => {
    const res = linkedinParser.parse(email(tarjeta(linea)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs[0]).toMatchObject({ modality, locationRaw, companyRaw: "Empresa" });
  });

  it("deja la ubicación en null si la tarjeta solo trae la modalidad", () => {
    const res = linkedinParser.parse(email(tarjeta("Empresa · (En remoto)")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs[0]).toMatchObject({ locationRaw: null, modality: "remoto" });
  });

  it("usa el nombre de fuente genérico si el email no trae asunto", () => {
    const res = linkedinParser.parse(email(tarjeta("Empresa · Argentina (En remoto)"), null));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs[0]!.source.name).toBe("alerta de LinkedIn");
  });

  it("decodifica entidades HTML y deja intactas las que no conoce", () => {
    const res = linkedinParser.parse(
      email(tarjeta("Ipsum &amp; Co · Argentina (En remoto)", "C&#39;est AI &hearts;")),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs[0]!.companyRaw).toBe("Ipsum & Co");
    expect(res.jobs[0]!.title).toBe("C'est AI &hearts;");
  });
});

describe("linkedinParser: falla cerrado", () => {
  it("falla si la tarjeta no tiene la línea Empresa · Ubicación", () => {
    const sinLinea = `<td class="pt-3" data-test-id="job-card" style="x">
        <a href="https://www.linkedin.com/comm/jobs/view/999/"><img alt="Empresa" src="x.png"></a>
        <a href="https://www.linkedin.com/comm/jobs/view/999/">AI Engineer</a>
      </td>`;
    const res = linkedinParser.parse(email(sinLinea));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/Empresa · Ubicación/i);
  });

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
