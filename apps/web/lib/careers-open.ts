import { isOpenableCareer, parseOpenCareers, type RoleKey } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { getAppDb, withUser } from "./db";
import { canCreateInvitations, NotInvitationAdminError } from "./invitations";

/**
 * Carreras abiertas de la beta (R32-03), solo servidor. La lista vive en la base (`open_careers`) y se lee y escribe
 * únicamente por funciones SECURITY DEFINER (rls/0074); las reglas (qué significa para una persona) son del
 * pipeline (`career-opening.ts`). Nada abre solo: este módulo no mira cobertura.
 */

/**
 * La lista de carreras abiertas, para quien sea (la lista de espera pública no tiene sesión). `null` si no se pudo
 * leer o la migración todavía no está: quien llama trata `null` como «no sé», nunca como «todo abierto».
 */
export async function getOpenCareers(): Promise<RoleKey[] | null> {
  try {
    const rows = (await getAppDb().transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '3s'`);
      return tx.execute(sql`select public.careers_open_list() as list`);
    })) as unknown as { list: string[] | null }[];
    return parseOpenCareers(rows[0]?.list ?? []);
  } catch {
    return null;
  }
}

export class CareerAdminNotEnabledInDbError extends Error {
  constructor() {
    super("la cuenta es admin en la app pero no está habilitada en la base (app_admins)");
    this.name = "CareerAdminNotEnabledInDbError";
  }
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
      const message = (e as { message?: unknown }).message;
      if (typeof message === "string" && /admin_career\w*: no autorizado/.test(message)) {
        throw new CareerAdminNotEnabledInDbError();
      }
    }
    throw error;
  }
}

async function assertAdmin(userId: string): Promise<void> {
  if (!(await canCreateInvitations(userId))) throw new NotInvitationAdminError();
}

export type OpenCareerRow = { career: RoleKey; openedAt: Date; openedByEmail: string | null };

/** Qué está abierto, desde cuándo y quién lo abrió. Solo admins. */
export async function listOpenCareersAdmin(userId: string): Promise<OpenCareerRow[]> {
  await assertAdmin(userId);
  const rows = (await guarded(() =>
    withUser(userId, (tx) => tx.execute(sql`select * from public.admin_careers_open()`)),
  )) as unknown as { career: string; opened_at: Date | string; opened_by_email: string | null }[];
  return rows
    .filter((r) => isOpenableCareer(r.career))
    .map((r) => ({
      career: r.career as RoleKey,
      openedAt: new Date(r.opened_at),
      openedByEmail: r.opened_by_email,
    }));
}

export type SetCareerResult = "ok" | "sin_cambio" | "invalida";

/** Abre o cierra una carrera. Solo admins; solo claves del catálogo (nunca «Otra»). Cada cambio real queda en el historial. */
export async function setCareerOpen(
  userId: string,
  career: unknown,
  open: boolean,
): Promise<SetCareerResult> {
  await assertAdmin(userId);
  if (!isOpenableCareer(career)) return "invalida";
  const rows = (await guarded(() =>
    withUser(userId, (tx) =>
      tx.execute(sql`select public.admin_career_set(${career}::text, ${open}::boolean) as status`),
    ),
  )) as unknown as { status: string }[];
  const status = rows[0]?.status;
  if (status === "ok" || status === "sin_cambio" || status === "invalida") return status;
  throw new Error("admin_career_set devolvió un estado inesperado");
}

export type CareerOpeningEventRow = {
  career: string;
  action: "abrir" | "cerrar";
  adminEmail: string | null;
  createdAt: Date;
};

/** Últimos cambios, los más nuevos primero. Solo admins. */
export async function listCareerOpeningHistory(
  userId: string,
  limit = 30,
): Promise<CareerOpeningEventRow[]> {
  await assertAdmin(userId);
  const rows = (await guarded(() =>
    withUser(userId, (tx) =>
      tx.execute(sql`select * from public.admin_career_history(${limit}::integer)`),
    ),
  )) as unknown as {
    career: string;
    action: string;
    admin_email: string | null;
    created_at: Date | string;
  }[];
  return rows.flatMap((r) =>
    r.action === "abrir" || r.action === "cerrar"
      ? [
          {
            career: r.career,
            action: r.action,
            adminEmail: r.admin_email,
            createdAt: new Date(r.created_at),
          },
        ]
      : [],
  );
}
