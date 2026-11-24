import { PEOPLE_PAGE_SIZE, type PeopleFilter } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Panel /admin, sección Personas (ADM-1). Solo servidor. Cada función corre con la sesión de quien
 * administra y la base exige la fila en `app_admins` (rls/0064); las páginas y acciones, además, llaman a
 * `lib/admin-guard`. Solo devuelve datos de la cuenta y conteos: nunca ofertas, CV ni respuestas.
 */

export type PersonRow = {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  isTest: boolean;
  blockedAt: Date | null;
  onboarded: boolean;
  plan: string;
  planUntil: Date | null;
  planSource: string | null;
  isAdmin: boolean;
  isTester: boolean;
  lastAiAt: Date | null;
};

export type PersonDetail = PersonRow & {
  termsVersion: string | null;
  jobs: number;
  applications: number;
  interviews: number;
  feedback: number;
};

export type PersonHistoryRow = {
  action: string;
  source: string | null;
  adminEmail: string | null;
  createdAt: Date;
};

export type PanelSummary = {
  waitlist: number;
  paymentNotices: number;
  expiring7d: number;
  feedbackNew: number;
  blocked: number;
  people: number;
  new7d: number;
};

type Raw = Record<string, unknown>;

const date = (v: unknown): Date | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function toPerson(r: Raw): PersonRow {
  return {
    id: String(r.id),
    email: String(r.email),
    name: r.name == null ? null : String(r.name),
    createdAt: date(r.created_at) ?? new Date(0),
    isTest: r.is_test === true,
    blockedAt: date(r.blocked_at),
    onboarded: r.onboarded === true,
    plan: String(r.plan ?? "gratis"),
    planUntil: date(r.plan_until),
    planSource: r.plan_source == null ? null : String(r.plan_source),
    isAdmin: r.is_admin === true,
    isTester: r.is_tester === true,
    lastAiAt: date(r.last_ai_at),
  };
}

export async function listPeople(
  adminId: string,
  opts: { query: string | null; filter: PeopleFilter; page: number },
): Promise<{ rows: PersonRow[]; total: number }> {
  const offset = (opts.page - 1) * PEOPLE_PAGE_SIZE;
  const rows = (await withUser(adminId, (tx) =>
    tx.execute(
      sql`select * from admin_people_list(${opts.query}, ${opts.filter}, ${PEOPLE_PAGE_SIZE}, ${offset})`,
    ),
  )) as unknown as Raw[];
  return { rows: rows.map(toPerson), total: rows.length > 0 ? num(rows[0]!.total) : 0 };
}

export async function getPerson(adminId: string, personId: string): Promise<PersonDetail | null> {
  const rows = (await withUser(adminId, (tx) =>
    tx.execute(sql`select * from admin_person_get(${personId}::uuid)`),
  )) as unknown as Raw[];
  const r = rows[0];
  if (!r) return null;
  return {
    ...toPerson(r),
    termsVersion: r.terms_version == null ? null : String(r.terms_version),
    jobs: num(r.jobs),
    applications: num(r.applications),
    interviews: num(r.interviews),
    feedback: num(r.feedback),
  };
}

export async function getPersonHistory(
  adminId: string,
  personId: string,
): Promise<PersonHistoryRow[]> {
  const rows = (await withUser(adminId, (tx) =>
    tx.execute(sql`select * from admin_person_history(${personId}::uuid, 30)`),
  )) as unknown as Raw[];
  return rows.map((r) => ({
    action: String(r.action),
    source: r.source == null ? null : String(r.source),
    adminEmail: r.admin_email == null ? null : String(r.admin_email),
    createdAt: date(r.created_at) ?? new Date(0),
  }));
}

/** Conteos de la portada. `null` si la base todavía no tiene la función o la cuenta no está en app_admins. */
export async function getPanelSummary(adminId: string): Promise<PanelSummary | null> {
  try {
    const rows = (await withUser(adminId, (tx) =>
      tx.execute(sql`select admin_panel_summary() as s`),
    )) as unknown as { s: Raw | null }[];
    const s = rows[0]?.s;
    if (!s) return null;
    return {
      waitlist: num(s.waitlist),
      paymentNotices: num(s.payment_notices),
      expiring7d: num(s.expiring_7d),
      feedbackNew: num(s.feedback_new),
      blocked: num(s.blocked),
      people: num(s.people),
      new7d: num(s.new_7d),
    };
  } catch {
    return null;
  }
}

async function call(adminId: string, query: ReturnType<typeof sql>): Promise<string> {
  const rows = (await withUser(adminId, (tx) => tx.execute(query))) as unknown as { r: string }[];
  return String(rows[0]?.r ?? "");
}

export function setTester(adminId: string, personId: string, on: boolean): Promise<string> {
  return call(adminId, sql`select admin_person_role(${personId}::uuid, 'tester', ${on}) as r`);
}

export function setBlocked(adminId: string, personId: string, on: boolean): Promise<string> {
  return call(adminId, sql`select admin_person_block(${personId}::uuid, ${on}) as r`);
}

export function setTestAccount(adminId: string, personId: string, on: boolean): Promise<string> {
  return call(adminId, sql`select admin_person_test(${personId}::uuid, ${on}) as r`);
}
