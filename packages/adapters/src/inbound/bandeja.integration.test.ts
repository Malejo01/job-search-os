import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import {
  GMAIL_CONFIRM_HOSTS,
  GMAIL_FORWARDING_SENDER,
  normalizeTitle,
} from "@job-search-os/pipeline";
import { and, eq, inArray } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail } from "./handle";
import { linkedinParser } from "./linkedin";
import type { ReceivedEmailContent, ResendReceivedEvent } from "./resend";

/**
 * JS-119 · Bandeja automática: clasificación al llegar (seguridad, confirmación de reenvío de
 * Gmail, postulaciones de LinkedIn, avisos extraídos). Datos inventados: remitentes
 * @example.com, Empresa A y códigos falsos.
 */
const A = "c9000000-0000-4000-8000-000000000001";
const B = "c9000000-0000-4000-8000-000000000002";
const ADDR_A = "u_band_a@ingest.test";
const ADDR_B = "u_band_b@ingest.test";
const LINKEDIN = "LinkedIn <jobs-noreply@linkedin.com>";
// Ids de aviso inventados
const IDS = { uno: "81000001", dos: "81000002", tres: "81000003", corto: "82000001" };
const GMAIL = `Equipo de Gmail <${GMAIL_FORWARDING_SENDER}>`;

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = () => ({ db: conn.db, storage: pgBlobStorage(conn.db), logger });

let seq = 0;
const send = async (
  over: {
    from: string;
    subject: string;
    to?: string[];
    cc?: string[];
    received_for?: string[];
  },
  content: Partial<ReceivedEmailContent> | null = { html: null, text: "", headers: null },
) => {
  const ev: ResendReceivedEvent = {
    type: "email.received",
    created_at: "2026-10-08T12:00:00.000Z",
    data: {
      email_id: `em_band_${++seq}`,
      from: over.from,
      to: over.to ?? [ADDR_A],
      cc: over.cc ?? [],
      bcc: [],
      received_for: over.received_for ?? [],
      subject: over.subject,
      attachments: [],
    },
  };
  const out = await handleInboundEmail(
    ev,
    content ? ({ html: null, text: "", headers: null, ...content } as ReceivedEmailContent) : null,
    JSON.stringify(ev),
    deps(),
  );
  if (out.kind !== "stored") throw new Error(`no se guardó: ${out.kind}`);
  const [row] = await conn.db
    .select()
    .from(s.inboundEmails)
    .where(eq(s.inboundEmails.id, out.inboundId));
  const raw = (await pgBlobStorage(conn.db).get(row!.rawRef))!.body;
  return { out, row: row!, raw };
};

const addJob = async (
  userId: string,
  title: string,
  company: string,
  status: "evaluada" | "aplicada" | "descartada" = "evaluada",
  linkedinId?: string,
) => {
  const [job] = await conn.db
    .insert(s.jobs)
    .values({
      userId,
      companyRaw: company,
      title,
      titleNormalized: normalizeTitle(title),
      status,
    })
    .returning({ id: s.jobs.id });
  if (linkedinId) {
    await conn.db.insert(s.jobSources).values({
      jobId: job!.id,
      kind: "email_linkedin",
      externalId: linkedinId,
      url: `https://www.linkedin.com/jobs/view/${linkedinId}/`,
    });
  }
  return job!.id;
};

const statusOf = async (jobId: string) =>
  (await conn.db.select({ status: s.jobs.status }).from(s.jobs).where(eq(s.jobs.id, jobId)))[0]!
    .status;

beforeAll(async () => {
  let ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("jobsearch")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 2 });
  for (const [userId, addr] of [
    [A, ADDR_A],
    [B, ADDR_B],
  ] as const) {
    await conn.db
      .insert(s.profiles)
      .values({
        userId,
        displayName: "Persona de Prueba",
        locationCountry: "AR",
        remoteOnly: true,
        inboundAddress: addr,
        profileSummary: "Perfil ficticio.",
      })
      .onConflictDoNothing();
  }
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: A, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  if (conn) {
    const users = [A, B];
    await conn.db.delete(s.inboundEmails).where(inArray(s.inboundEmails.userId, users));
    await conn.db.delete(s.rawBlobs).where(inArray(s.rawBlobs.userId, users));
    await conn.db.delete(s.jobs).where(inArray(s.jobs.userId, users));
    await conn.db.delete(s.evaluationCriteria).where(inArray(s.evaluationCriteria.userId, users));
    await conn.db.delete(s.profiles).where(inArray(s.profiles.userId, users));
  }
  await conn?.close();
  await container?.stop();
});

describe("seguridad", () => {
  it("un código de verificación de cualquier remitente: descartado, sin cuerpo y con el asunto enmascarado", async () => {
    const { row, raw } = await send(
      { from: "Servicio X <no-reply@example.com>", subject: "Tu código de verificación es 482913" },
      { text: "Tu código es 482913. CUERPO-SECRETO-FALSO", html: "<p>CUERPO-SECRETO-FALSO</p>" },
    );
    expect(row.dismissedAt).not.toBeNull();
    expect(row.parser).toBe("seguridad");
    expect(row.subject).toBe("Tu código de verificación es •••");
    expect(raw).not.toContain("482913");
    expect(raw).not.toContain("CUERPO-SECRETO-FALSO");
    expect(raw).toContain("•••");
  });

  it("también si viene de un dominio de empleo marcado por la persona o de LinkedIn", async () => {
    const { row, raw } = await send(
      { from: "LinkedIn <security-noreply@linkedin.com>", subject: "Your security code: 556677" },
      { text: "CUERPO-SECRETO-FALSO" },
    );
    expect(row.dismissedAt).not.toBeNull();
    expect(row.subject).toBe("Your security code: •••");
    expect(raw).not.toContain("CUERPO-SECRETO-FALSO");
  });
});

describe("asunto enmascarado, HTML sin texto y remitentes esperados", () => {
  it("un remitente no esperado que no es de seguridad también guarda el asunto enmascarado", async () => {
    const { row, raw } = await send(
      { from: "Banco Ficticio <avisos@example.com>", subject: "Resumen 20261008 saldo 123456" },
      { text: "CUERPO-SECRETO-FALSO" },
    );
    expect(row.subject).toBe("Resumen ••• saldo •••");
    expect(raw).not.toContain("123456");
    expect(raw).not.toContain("CUERPO-SECRETO-FALSO");
  });

  it("sin parte de texto, clasifica con el HTML (código solo en el cuerpo HTML)", async () => {
    const { row, raw } = await send(
      { from: "Servicio Y <no-reply@example.com>", subject: "Tu acceso" },
      { text: "", html: "<p>Tu <b>código de verificación</b> es 554433</p>" },
    );
    expect(row.parser).toBe("seguridad");
    expect(row.dismissedAt).not.toBeNull();
    expect(raw).not.toContain("554433");
  });

  it("un enlace mágico se descarta", async () => {
    const { row } = await send(
      { from: "Servicio Y <no-reply@example.com>", subject: "Your magic link" },
      { text: "https://servicio.example/entrar?t=FALSO" },
    );
    expect(row.parser).toBe("seguridad");
  });

  it("de un remitente esperado, un cuerpo con «security code is 123456» no se pierde", async () => {
    const { row } = await send(
      {
        from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
        subject: "Staff Engineer: 1 nueva oferta",
      },
      { text: "Staff Engineer\nEmpresa A · Remoto\nsecurity code is 123456 en la JD de ejemplo" },
    );
    expect(row.parser).not.toBe("seguridad");
    expect(row.dismissedAt).toBeNull();
  });
});

describe("confirmación de reenvío de Gmail", () => {
  const SUBJECT = "Gmail Forwarding Confirmation - Receive Mail from persona@example.com";
  const BODY = { text: `Confirmá: https://${[...GMAIL_CONFIRM_HOSTS][0]}/mail/vf-FALSO-LINK` };

  it("dirigida a la dirección del usuario: se guarda completa y queda pendiente", async () => {
    const { row, raw } = await send({ from: GMAIL, subject: SUBJECT, to: [ADDR_A] }, BODY);
    expect(row.parser).toBe("gmail_reenvio");
    expect(row.error).toBeNull();
    expect(row.seenAt).toBeNull();
    expect(row.dismissedAt).toBeNull();
    expect(raw).toContain("vf-FALSO-LINK");
  });

  it("dirigida a otra dirección (el usuario solo en cc): sin cuerpo", async () => {
    const { row, raw } = await send(
      { from: GMAIL, subject: SUBJECT, to: ["otra@example.com"], cc: [ADDR_A] },
      BODY,
    );
    expect(row.parser).toBe("none");
    expect(row.error).toContain("remitente no esperado");
    expect(raw).not.toContain("vf-FALSO-LINK");
  });

  it("de un remitente que no es forwarding-noreply@: sin cuerpo", async () => {
    const { row, raw } = await send(
      {
        from: `Gmail <${GMAIL_FORWARDING_SENDER.replace("forwarding-", "")}>`,
        subject: SUBJECT,
        to: [ADDR_A],
      },
      BODY,
    );
    expect(row.error).toContain("remitente no esperado");
    expect(raw).not.toContain("vf-FALSO-LINK");
  });
});

describe("postulaciones de LinkedIn", () => {
  it("enviada con un aviso de A que coincide por id: queda aplicada, el email visto y los de B no cambian", async () => {
    const jobA = await addJob(A, "Ingeniero de Pruebas", "Empresa A", "evaluada", IDS.uno);
    const jobB = await addJob(B, "Ingeniero de Pruebas", "Empresa A", "evaluada", IDS.uno);
    const { row } = await send(
      { from: LINKEDIN, subject: "Se ha enviado tu solicitud a Empresa A" },
      { text: `Ver: https://www.linkedin.com/comm/jobs/view/${IDS.uno}/?trk=falso` },
    );
    expect(row.parser).toBe("linkedin_postulacion");
    expect(row.seenAt).not.toBeNull();
    expect(row.error).toBeNull();
    expect(await statusOf(jobA)).toBe("aplicada");
    expect(await statusOf(jobB)).toBe("evaluada");
    const apps = await conn.db
      .select()
      .from(s.applications)
      .where(and(eq(s.applications.jobId, jobA), eq(s.applications.userId, A)));
    expect(apps).toHaveLength(1);
    expect(apps[0]!.appliedAt).not.toBeNull();
    expect(
      await conn.db.select().from(s.applications).where(eq(s.applications.jobId, jobB)),
    ).toHaveLength(0);
  });

  it("enviada sin id: coincide por empresa normalizada + puesto si hay un único candidato", async () => {
    const jobA = await addJob(A, "Analista de Datos", "Empresa Cobre S.A.");
    const { row } = await send(
      { from: LINKEDIN, subject: "Your application was sent to Empresa Cobre" },
      {
        text: "Your application was sent to Empresa Cobre\nAnalista de Datos\nEmpresa Cobre · Remoto",
      },
    );
    expect(row.seenAt).not.toBeNull();
    expect(await statusOf(jobA)).toBe("aplicada");
  });

  it("enviada sin aviso que coincida: queda vista y no toca ofertas", async () => {
    const other = await addJob(A, "Analista de Datos", "Empresa D");
    const { row } = await send(
      { from: LINKEDIN, subject: "Se ha enviado tu solicitud a Empresa Inexistente" },
      { text: "Se ha enviado tu solicitud a Empresa Inexistente\nPuesto Inexistente" },
    );
    expect(row.seenAt).not.toBeNull();
    expect(row.parser).toBe("linkedin_postulacion");
    expect(await statusOf(other)).toBe("evaluada");
  });

  it("enviada con dos candidatos: queda vista y no toca ninguno", async () => {
    const one = await addJob(A, "Desarrollador Senior", "Empresa E");
    const two = await addJob(A, "Desarrollador Senior", "Empresa E");
    const { row } = await send(
      { from: LINKEDIN, subject: "Se ha enviado tu solicitud a Empresa E" },
      { text: "Se ha enviado tu solicitud a Empresa E\nDesarrollador Senior" },
    );
    expect(row.seenAt).not.toBeNull();
    expect(await statusOf(one)).toBe("evaluada");
    expect(await statusOf(two)).toBe("evaluada");
  });

  it("enviada sobre una oferta ya aplicada: no retrocede ni duplica la postulación", async () => {
    const job = await addJob(A, "Tester de Integración", "Empresa F", "aplicada", IDS.dos);
    await conn.db.insert(s.applications).values({ jobId: job, userId: A, appliedAt: new Date() });
    await send(
      { from: LINKEDIN, subject: "Se ha enviado tu solicitud a Empresa F" },
      { text: `https://www.linkedin.com/jobs/view/${IDS.dos}/` },
    );
    expect(await statusOf(job)).toBe("aplicada");
    expect(
      await conn.db.select().from(s.applications).where(eq(s.applications.jobId, job)),
    ).toHaveLength(1);
  });

  it("el id de LinkedIn corta al final: uno que es prefijo de otro no coincide con los dos", async () => {
    const corto = await addJob(A, "Auditor de Calidad", "Empresa H", "evaluada", IDS.corto);
    const largo = await addJob(A, "Auditor de Calidad", "Empresa H", "evaluada", `${IDS.corto}1`);
    await send(
      { from: LINKEDIN, subject: "Se ha enviado tu solicitud a Empresa H" },
      { text: `https://www.linkedin.com/jobs/view/${IDS.corto}/?trk=falso` },
    );
    expect(await statusOf(corto)).toBe("aplicada");
    expect(await statusOf(largo)).toBe("evaluada");
  });

  it("vista: deja una línea en la nota de la postulación y el email queda visto", async () => {
    const job = await addJob(A, "Soporte Técnico", "Empresa G", "aplicada", IDS.tres);
    await conn.db.insert(s.applications).values({ jobId: job, userId: A, appliedAt: new Date() });
    const { row } = await send(
      { from: LINKEDIN, subject: "Empresa G ha visto tu solicitud" },
      { text: `https://www.linkedin.com/jobs/view/${IDS.tres}/` },
    );
    expect(row.seenAt).not.toBeNull();
    expect(row.parser).toBe("linkedin_postulacion");
    const [app] = await conn.db
      .select({ note: s.applications.outcomeNote, outcome: s.applications.outcome })
      .from(s.applications)
      .where(eq(s.applications.jobId, job));
    expect(app!.note).toContain("la empresa vio la solicitud");
    expect(app!.outcome).toBe("sin_respuesta");
    expect(await statusOf(job)).toBe("aplicada");
  });
});

describe("avisos extraídos y alertas con títulos de seguridad", () => {
  const html = readFileSync(resolve(__dirname, "fixtures/linkedin/alerta-un-aviso.html"), "utf8");

  it("un email con avisos extraídos queda visto", async () => {
    const { row, out } = await send(
      {
        from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
        subject: "AI Engineer: 1 nueva oferta",
      },
      { html, text: null },
    );
    expect(out.jobsExtracted).toBeGreaterThan(0);
    expect(row.seenAt).not.toBeNull();
    expect(row.dismissedAt).toBeNull();
  });

  it("un fallo parcial de ingesta no marca visto: queda en Pendientes con su error", async () => {
    const dos = readFileSync(
      resolve(__dirname, "fixtures/linkedin/alerta-dos-avisos.html"),
      "utf8",
    );
    const parsed = linkedinParser.parse({
      from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
      to: [ADDR_A],
      subject: "AI Engineer: 2 nuevas ofertas",
      html: dos,
      text: null,
      receivedAt: new Date("2026-10-08T12:00:00.000Z"),
    });
    if (!parsed.ok) throw new Error("la fixture de dos avisos no se parseó");
    expect(parsed.jobs.length).toBe(2);
    // Un NUL en el título de uno hace fallar su INSERT (Postgres no admite 0x00 en text)
    const title = parsed.jobs[0]!.title;
    expect(dos).toContain(title);
    // Id nuevo: si no, el aviso ya cargado por otro test se fusiona y nunca llega a insertarse
    const roto = dos
      .replaceAll(parsed.jobs[0]!.source.externalId!, "7770001")
      .replace(title, `${title}\u0000`);
    const { row, out } = await send(
      {
        from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
        subject: "AI Engineer: 2 nuevas ofertas",
      },
      { html: roto, text: null },
    );
    expect(out.jobsExtracted).toBeGreaterThan(0);
    expect(row.error).toContain("con error al ingestar");
    expect(row.seenAt).toBeNull();
  });

  it("una alerta de LinkedIn con «Security Engineer» en el asunto no se descarta", async () => {
    const { row, out } = await send(
      {
        from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
        subject: "Security Engineer: 1 nueva oferta en Empresa A",
      },
      { html, text: null },
    );
    expect(row.dismissedAt).toBeNull();
    expect(row.parser).toBe("linkedin");
    expect(out.jobsExtracted).toBeGreaterThan(0);
    expect(row.subject).toBe("Security Engineer: 1 nueva oferta en Empresa A");
  });
});
