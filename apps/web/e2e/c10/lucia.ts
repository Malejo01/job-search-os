// Sin @job-search-os/db (ver helpers.ts): solo schema, postgres y el hash de contraseña.
import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import { eq, inArray } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { FIRST_STEPS_COOKIE, ownerDb } from "../helpers";
import { TERMS_VERSION } from "../../lib/terms";

/**
 * Datos de prueba de C10 (fidelidad visual): la persona ficticia «Lucía», contadora en Salta, con
 * las mismas ofertas que las pantallas aprobadas el 4/11 (`docs/ux/rediseno-afiniajobs/referencias/`).
 * Todo inventado: nombre, email (`@personas.test`), empresas y avisos. Solo existe en la base local
 * de los e2e o en el Postgres del CI. Idempotente: cada llamada deja a Lucía exactamente así.
 */
export const LUCIA_USER_ID = "c1000000-0000-4000-8000-000000000010";
export const LUCIA_EMAIL = "lucia-c10@personas.test";
export const LUCIA_PASSWORD = "personas-clave-local-lucia-c10";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

type Item = {
  id: string;
  kind: "estructurado" | "skill" | "texto";
  nivel: "must" | "deseable";
  pide: string;
  tenes: string | null;
  status: "cumple" | "no_cumple" | "no_se_sabe";
};

type Offer = {
  key: "analista" | "liquidador" | "asistente" | "gerente";
  title: string;
  company: string;
  location: string;
  modality: "remoto" | "hibrido" | "presencial";
  daysAgo: number;
  score: number;
  locationOk: "ok" | "riesgo" | "no";
  jd: string;
  items: Item[];
};

const texto = (
  id: string,
  nivel: Item["nivel"],
  pide: string,
  status: Item["status"],
  tenes: string | null = null,
): Item => ({
  id,
  kind: "texto",
  nivel,
  pide,
  tenes,
  status,
});
const skill = (slug: string, pide: string, status: Item["status"]): Item => ({
  id: `skill:${slug}`,
  kind: "skill",
  nivel: "deseable",
  pide,
  tenes: status === "cumple" ? "Nivel productivo" : null,
  status,
});

/**
 * Las cuatro ofertas de las referencias, en orden de afinidad. Los chips de la tarjeta K2 salen de
 * los ítems que no son skill (lib/jobs.ts), así que lo que la referencia cuenta como «(+n)» va como
 * skill: suma al conteo («3 a tu favor») sin sumar chips.
 */
export const LUCIA_OFFERS: readonly Offer[] = [
  {
    key: "analista",
    title: "Analista contable semi senior",
    company: "Estudio Ruiz y Asociados",
    location: "Salta",
    modality: "presencial",
    daysAgo: 2,
    score: 8.5,
    locationOk: "ok",
    jd: "Estudio contable con 15 personas busca analista para liquidación de sueldos y presentación de impuestos. Jornada de lunes a viernes, de 9 a 17. Requisitos: experiencia en liquidación de sueldos, IVA y Ganancias, residencia en Salta, trabajo presencial. Deseable: Tango Gestión.",
    items: [
      texto("req:1", "must", "Liquidación de sueldos", "cumple", "3 años liquidando sueldos"),
      texto("req:2", "must", "IVA y Ganancias", "cumple", "IVA y Ganancias"),
      { ...texto("residencia", "must", "Vivís en Salta", "cumple", "Salta"), kind: "estructurado" },
      {
        ...texto("modalidad", "must", "Presencial", "cumple", "Presencial, como querés"),
        kind: "estructurado",
      },
      texto("req:3", "deseable", "Tango Gestión", "no_cumple"),
    ],
  },
  {
    key: "liquidador",
    title: "Liquidador de sueldos",
    company: "Grupo Norte",
    location: "Argentina",
    modality: "remoto",
    daysAgo: 1,
    score: 7.4,
    locationOk: "ok",
    jd: "Grupo de empresas del norte argentino busca liquidador de sueldos para trabajar en forma remota. Convenios colectivos de comercio y construcción. Inglés intermedio para reportes regionales.",
    items: [
      texto("req:1", "must", "Convenios colectivos", "cumple", "Comercio y construcción"),
      skill("general_accounting", "Contabilidad y conciliaciones", "cumple"),
      skill("tax_compliance", "Impuestos, auditoría y controles", "cumple"),
      { ...texto("ingles", "must", "inglés intermedio", "no_cumple"), kind: "estructurado" },
    ],
  },
  {
    key: "asistente",
    title: "Asistente contable",
    company: "Consultora Andina",
    location: "Salta",
    modality: "hibrido",
    daysAgo: 3,
    score: 6.1,
    locationOk: "ok",
    jd: "Consultora busca asistente contable para tareas de IVA y conciliaciones bancarias, con esquema híbrido en Salta. Dos años de experiencia en estudio contable.",
    items: [
      texto("req:1", "must", "IVA", "cumple", "IVA y Ganancias"),
      skill("general_accounting", "Contabilidad y conciliaciones", "cumple"),
      { ...texto("anos", "must", "2 años de experiencia", "no_cumple"), kind: "estructurado" },
      skill("erp_accounting", "Software contable (NetSuite, QuickBooks, Xero)", "no_cumple"),
    ],
  },
  {
    key: "gerente",
    title: "Gerente de finanzas",
    company: "Holding Sur",
    location: "CABA",
    modality: "presencial",
    daysAgo: 4,
    score: 2.4,
    locationOk: "riesgo",
    jd: "Holding con sede en CABA busca gerente de finanzas con 10 años de experiencia liderando equipos. Presencial.",
    items: [
      { ...texto("anos", "must", "10 años de experiencia", "no_cumple"), kind: "estructurado" },
    ],
  },
];

/** Ofertas que esperan la descripción: «Pegar la descripción de 2 ofertas» en «Para hacer hoy». */
const PENDING_TITLES = ["Contador junior", "Auxiliar contable"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function counts(items: Item[], nivel: Item["nivel"]) {
  const of = items.filter((i) => i.nivel === nivel);
  return {
    cumple: of.filter((i) => i.status === "cumple").length,
    no_cumple: of.filter((i) => i.status === "no_cumple").length,
    no_se_sabe: of.filter((i) => i.status === "no_se_sabe").length,
  };
}

function checklistOf(items: Item[]) {
  const full = items.map((i) => ({
    ...i,
    evidencia: null,
    fuente: { pide: "modelo" as const, tenes: i.tenes ? ("perfil" as const) : null },
    bloquea: false,
  }));
  return {
    items: full,
    must: counts(items, "must"),
    deseable: counts(items, "deseable"),
    parcial: false,
    descarte_rapido: full.find((i) => i.status === "no_cumple") ?? null,
  };
}

/**
 * Deja a Lucía como en las referencias: perfil completo (resumen y skills), áreas elegidas, CV
 * empezado, las 4 ofertas evaluadas y 2 que esperan la descripción. Devuelve el id de cada oferta.
 */
export async function seedLucia(): Promise<Record<Offer["key"], string>> {
  const { db, close } = ownerDb();
  try {
    await db
      .insert(s.users)
      .values({
        id: LUCIA_USER_ID,
        email: LUCIA_EMAIL,
        name: "Lucía",
        passwordHash: hashPassword(LUCIA_PASSWORD),
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: s.users.id,
        set: { termsVersion: TERMS_VERSION, passwordHash: hashPassword(LUCIA_PASSWORD) },
      });
    const profile = {
      displayName: "Lucía",
      locationCountry: "AR",
      locationCity: "Salta",
      remoteOnly: false,
      acceptedModalities: ["presencial", "hibrido", "remoto"],
      jobLanguages: ["es"],
      yearsTotal: 3,
      englishCefr: "A2",
      targetRole: "finanzas_contabilidad",
      targetRoles: ["finanzas_contabilidad"],
      targetSpecialties: { finanzas_contabilidad: [] as string[] },
      profileSummary:
        "Perfil ficticio de Lucía para las pruebas visuales: contadora en Salta con tres años liquidando sueldos e impuestos en un estudio contable.",
    };
    await db
      .insert(s.profiles)
      .values({ userId: LUCIA_USER_ID, inboundAddress: "u_lucia_c10@ingest.test", ...profile })
      .onConflictDoUpdate({ target: s.profiles.userId, set: profile });
    const [crit] = await db
      .select({ id: s.evaluationCriteria.id })
      .from(s.evaluationCriteria)
      .where(eq(s.evaluationCriteria.userId, LUCIA_USER_ID));
    if (!crit) {
      await db
        .insert(s.evaluationCriteria)
        .values({ userId: LUCIA_USER_ID, version: 1, active: true, rules: {} as never });
    }
    // «Completaste tu perfil» pide al menos una skill con nivel
    const owned = await db
      .select({ id: s.skills.id })
      .from(s.skills)
      .where(inArray(s.skills.slug, ["general_accounting", "tax_compliance"]));
    for (const { id } of owned) {
      await db
        .insert(s.skillLevels)
        .values({ userId: LUCIA_USER_ID, skillId: id, level: 2, confidence: 1, state: "parcial" })
        .onConflictDoNothing();
    }
    // «Subir tu CV» hecho
    await db.delete(s.careerHistory).where(eq(s.careerHistory.userId, LUCIA_USER_ID));
    await db.insert(s.careerHistory).values({
      userId: LUCIA_USER_ID,
      kind: "trabajo",
      organization: "Estudio contable ficticio",
      title: "Asistente contable",
      startMonth: "2023-03",
      bullets: ["Liquidación de sueldos de 40 empleados.", "Declaraciones de IVA y Ganancias."],
    });

    // Ofertas: se borran y se vuelven a crear (evaluaciones y fuentes caen en cascada)
    await db.delete(s.jobs).where(eq(s.jobs.userId, LUCIA_USER_ID));
    const now = Date.now();
    const ids = {} as Record<Offer["key"], string>;
    for (const offer of LUCIA_OFFERS) {
      const seen = new Date(now - offer.daysAgo * DAY_MS);
      const [job] = await db
        .insert(s.jobs)
        .values({
          userId: LUCIA_USER_ID,
          companyRaw: offer.company,
          title: offer.title,
          titleNormalized: offer.title.toLowerCase(),
          canonicalUrl: `https://example.com/c10/${offer.key}`,
          locationRaw: offer.location,
          modality: offer.modality,
          status: "evaluada",
          jdText: offer.jd,
          flags: [],
          firstSeenAt: seen,
          postedAt: seen,
        })
        .returning({ id: s.jobs.id });
      ids[offer.key] = job!.id;
      await db.insert(s.jobSources).values({
        jobId: job!.id,
        kind: "email_generic",
        sourceName: "c10",
        url: `https://example.com/c10/${offer.key}`,
        seenAt: seen,
      });
      const have = offer.items.filter((i) => i.status === "cumple").map((i) => i.pide);
      const missing = offer.items.filter((i) => i.status === "no_cumple").map((i) => i.pide);
      await db.insert(s.evaluations).values({
        jobId: job!.id,
        userId: LUCIA_USER_ID,
        criteriaVersion: 1,
        promptVersion: "evaluate_job@c10",
        model: "fake",
        hadFullJd: true,
        score: offer.score,
        locationOk: offer.locationOk,
        modality: offer.modality,
        discipline: "otra",
        matchFuerte: have,
        gaps: missing,
        bloqueadoresDuros: [],
        senalesPositivas: [],
        veredicto: "Evaluación de prueba (C10).",
        accion: offer.score >= 7 ? "aplicar" : offer.score >= 5 ? "guardar" : "descartar",
        riesgos: [],
        decision: { adjustments: [], checklist: checklistOf(offer.items) },
      });
    }
    for (const [n, title] of PENDING_TITLES.entries()) {
      await db.insert(s.jobs).values({
        userId: LUCIA_USER_ID,
        companyRaw: `Empresa ficticia ${n + 1}`,
        title,
        titleNormalized: title.toLowerCase(),
        canonicalUrl: `https://example.com/c10/pendiente-${n + 1}`,
        locationRaw: "Salta",
        modality: "presencial",
        status: "pendiente_jd",
        flags: [],
        firstSeenAt: new Date(now - DAY_MS),
      });
    }
    return ids;
  } finally {
    await close();
  }
}

/** Entra como Lucía (sin «Primeros pasos»: no es parte de las referencias). */
export async function loginAsLucia(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([{ name: FIRST_STEPS_COOKIE, value: LUCIA_USER_ID, url: BASE_URL }]);
  await page.goto("/login");
  await page.getByLabel("Email").fill(LUCIA_EMAIL);
  await page.getByLabel("Contraseña").fill(LUCIA_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/hoy**");
}
