import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAX_EMAIL_HTML_CHARS } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import type { InboundEmailContent } from "./parsers";
import {
  parsePoolComputrabajoAlerts,
  POOL_COMPUTRABAJO_SOURCE_KIND,
  POOL_COMPUTRABAJO_SOURCE_NAME,
  POOL_EMAIL_MAX_CARDS,
  poolEmailSkeleton,
} from "./pool-computrabajo";
import { readPoolInboundConfig } from "./pool-mailbox";

/**
 * R19-01 · Lector de las alertas de Computrabajo para el pool (ADR-043). Fixtures derivadas de las
 * públicas de R11-4: empresas, títulos e IDs inventados. Las de «pool-*» no traen parámetros del tracker.
 */
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "fixtures/computrabajo", name), "utf8");

const email = (html: string | null): InboundEmailContent => ({
  from: "Alertas <avisos@portal-ficticio.test>",
  to: ["pool-finanzas_contabilidad@ingest.example.com"],
  subject: "Nuevos empleos para tu alerta",
  html,
  text: null,
  receivedAt: new Date("2026-11-22T09:00:00Z"),
});
const parse = (html: string | null) => parsePoolComputrabajoAlerts(email(html));

const una = fixture("pool-alerta-una-tarjeta.html");
const varias = fixture("recomendaciones-tres-avisos.html");

/** Las tarjetas del HTML de una sola tarjeta, repetidas `n` veces con IDs distintos. */
function conTarjetas(n: number): string {
  const card = /<tr>\s*<td style="padding-top: 10px;">[\s\S]*?<\/a>\s*<\/td>\s*<\/tr>/.exec(
    una,
  )![0];
  const cards = Array.from({ length: n }, (_, i) =>
    card.replace("0A1B2C3D4E5F60718293A4B5C6D7E8F1", String(i).padStart(32, "A")),
  ).join("\n");
  return una.replace(card, cards);
}

describe("interruptor POOL_COMPUTRABAJO_READER", () => {
  it("apagado por defecto: solo el valor exacto «1» lo prende", () => {
    for (const v of [undefined, "", "0", "true", "si", " 1", "1 ", "yes"]) {
      expect(readPoolInboundConfig({ POOL_COMPUTRABAJO_READER: v }).computrabajoReader, v).toBe(
        false,
      );
    }
    expect(readPoolInboundConfig({ POOL_COMPUTRABAJO_READER: "1" }).computrabajoReader).toBe(true);
  });

  it("es independiente del interruptor de las casillas", () => {
    const cfg = readPoolInboundConfig({ POOL_SOURCE_COMPUTRABAJO_ALERTS: "1" });
    expect(cfg.enabled).toBe(true);
    expect(cfg.computrabajoReader).toBe(false);
  });
});

describe("parsePoolComputrabajoAlerts: una tarjeta", () => {
  it("devuelve el aviso con fuente del pool, ID de 32 hex y URL sin parámetros", () => {
    const res = parse(una);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs).toHaveLength(1);
    const job = res.jobs[0]!;
    expect(job.source).toEqual({
      kind: POOL_COMPUTRABAJO_SOURCE_KIND,
      name: POOL_COMPUTRABAJO_SOURCE_NAME,
      externalId: "0A1B2C3D4E5F60718293A4B5C6D7E8F1",
      url: "https://ar.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-contador-a-ficticio-0A1B2C3D4E5F60718293A4B5C6D7E8F1",
      rawRef: null,
    });
    expect(job.source.externalId).toMatch(/^[0-9A-F]{32}$/);
    expect(POOL_COMPUTRABAJO_SOURCE_KIND).toBe("computrabajo_alerts");
    expect(POOL_COMPUTRABAJO_SOURCE_NAME).toBe("vía Computrabajo");
    expect(job.title).toBe("Contador/a Ficticio");
    expect(job.companyRaw).toBe("Empresa A");
    expect(job.locationRaw).toBe("Ciudad Ficticia, Provincia Ficticia");
  });

  it("lo que el email no dice queda null: países, JD, fecha, contrato", () => {
    const res = parse(una);
    if (!res.ok) throw new Error(res.reason);
    const job = res.jobs[0]!;
    expect(job.countriesAllowed).toBeNull();
    expect(job.jdText).toBeNull();
    expect(job.postedAt).toBeNull();
    expect(job.contractType).toBeNull();
    expect(job.modality).toBe("desconocida");
  });
});

describe("parsePoolComputrabajoAlerts: varias tarjetas", () => {
  it("una por tarjeta, en orden, y ningún parámetro del tracker llega al resultado", () => {
    const res = parse(varias);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs.map((j) => j.companyRaw)).toEqual([
      "Empresa A",
      "Empresa B & Asociados",
      "Empresa C",
    ]);
    expect(res.jobs.map((j) => j.source.kind)).toEqual(Array(3).fill("computrabajo_alerts"));
    const dump = JSON.stringify(res.jobs);
    for (const rastro of ["ipo", "idu", "isd", "TOKENFICTICIO", "USUARIOFICTICIO", "utm_"]) {
      expect(dump, rastro).not.toContain(rastro);
    }
    // Tampoco quedan en la URL: query ni fragmento
    for (const j of res.jobs) expect(j.source.url).not.toMatch(/[?#]/);
  });
});

describe("parsePoolComputrabajoAlerts: falla cerrado", () => {
  it("tracker sin url=: el email entero va a la cola manual", () => {
    const res = parse(una.replace("aviso?url=", "aviso?destino="));
    expect(res.ok).toBe(false);
  });

  it("url= que no es de Computrabajo: ok false", () => {
    const res = parse(una.replace("ar.computrabajo.com", "ofertas.ejemplo.example"));
    expect(res.ok).toBe(false);
  });

  it("un link que no es del tracker de Computrabajo: ok false", () => {
    const res = parse(una.replace("go.computrabajo.com", "tracker.ejemplo.example"));
    expect(res.ok).toBe(false);
  });

  it("ID que no es de 32 hex: ok false", () => {
    const res = parse(una.replace("0A1B2C3D4E5F60718293A4B5C6D7E8F1", "0A1B2C"));
    expect(res.ok).toBe(false);
  });

  it("estructura desconocida (avisos fuera de las tarjetas conocidas): ok false", () => {
    expect(parse(fixture("pool-estructura-desconocida.html")).ok).toBe(false);
  });

  it("recordatorio y seguimiento de empresa: ok false", () => {
    expect(parse(fixture("recordatorio-volve-a-revisar.html")).ok).toBe(false);
    expect(parse(fixture("empresa-vio-tu-cv.html")).ok).toBe(false);
  });

  it("sin HTML o vacío: ok false", () => {
    expect(parse(null).ok).toBe(false);
    expect(parse("").ok).toBe(false);
  });

  it("una tarjeta mala hace fallar el email entero: nunca extracción parcial", () => {
    const rota = varias.replace("Empresa C", "").replace(/class="texto_oferta"/, 'class="otra"');
    expect(parse(rota).ok).toBe(false);
  });

  it("el motivo no trae texto ni links del email", () => {
    const res = parse(una.replace("ar.computrabajo.com", "ofertas.ejemplo.example"));
    if (res.ok) throw new Error("debía fallar");
    expect(res.reason).not.toMatch(/Empresa A|Contador|ejemplo\.example|http/);
  });
});

describe("parsePoolComputrabajoAlerts: topes de tamaño", () => {
  it("el límite de tarjetas pasa; uno más, cola manual", () => {
    const ok = parse(conTarjetas(POOL_EMAIL_MAX_CARDS));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.jobs).toHaveLength(POOL_EMAIL_MAX_CARDS);
    expect(parse(conTarjetas(POOL_EMAIL_MAX_CARDS + 1)).ok).toBe(false);
  });

  it("HTML de más de MAX_EMAIL_HTML_CHARS: ok false", () => {
    const grande = una + " ".repeat(MAX_EMAIL_HTML_CHARS);
    expect(parse(grande).ok).toBe(false);
  });
});

describe("poolEmailSkeleton: esqueleto para el log", () => {
  it("cuenta la estructura y no lleva texto, links ni IDs", () => {
    const sk = poolEmailSkeleton(varias);
    expect(sk).toMatchObject({ cards: 3, titleCells: 3, textCells: 6 });
    expect(sk.trackerLinks).toBeGreaterThanOrEqual(3);
    const dump = JSON.stringify(sk);
    for (const dato of [
      "Empresa",
      "Analista",
      "Ciudad",
      "http",
      "computrabajo",
      "0A1B2C",
      "TOKENFICTICIO",
      "USUARIOFICTICIO",
    ]) {
      expect(dump, dato).not.toContain(dato);
    }
  });

  it("es estable: el mismo HTML da el mismo esqueleto y otro distinto, otra forma", () => {
    expect(poolEmailSkeleton(una)).toEqual(poolEmailSkeleton(una));
    expect(poolEmailSkeleton(una).shape).not.toBe(poolEmailSkeleton(varias).shape);
    expect(poolEmailSkeleton(una).shape).toMatch(/^[0-9a-f]{12}$/);
  });

  it("de un HTML hostil no lanza ni filtra nombres raros de etiqueta o parámetro", () => {
    const sk = poolEmailSkeleton(
      '<secreto-empresa-a x="1"><a href="https://go.computrabajo.com/x?dato_personal_largo_123=1&url=z">t</a></secreto-empresa-a>',
    );
    const dump = JSON.stringify(sk);
    expect(dump).not.toContain("secreto");
    expect(dump).not.toContain("dato_personal");
  });
});
