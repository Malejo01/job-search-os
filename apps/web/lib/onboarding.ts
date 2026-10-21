import { createLogger } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import {
  criteriaFromOnboarding,
  isProfileComplete,
  type OnboardingInput,
  parseOnboarding,
  targetRolesLimit,
  toRoleKey,
  type RoleKey,
} from "@job-search-os/pipeline";
import { and, eq, sql } from "drizzle-orm";
import { withUser } from "./db";

/** Onboarding obligatorio (B2, JS-094): la regla de "completo" vive en packages/pipeline. */

/** ¿El perfil del usuario ya puede evaluar ofertas? Sin perfil o sin criterios activos, no. */
export async function isOnboardingComplete(userId: string): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const [profile] = await tx
      .select({
        locationCountry: s.profiles.locationCountry,
        profileSummary: s.profiles.profileSummary,
      })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    if (!profile) return false;
    const [active] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(s.evaluationCriteria)
      .where(and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)));
    return isProfileComplete({ ...profile, activeCriteriaCount: active?.n ?? 0 });
  });
}

/**
 * Claves conocidas y sin repetir, en el orden guardado: la base no valida, el código sí. La clave
 * anterior `producto_proyectos` se traduce (`toRoleKey`), así que un perfil sin migrar sigue andando.
 */
function knownRoles(values: readonly unknown[] | null | undefined): RoleKey[] {
  const out: RoleKey[] = [];
  for (const v of values ?? []) {
    const key = toRoleKey(v);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

function sameRoleSet(a: readonly RoleKey[], b: readonly RoleKey[]): boolean {
  return a.length === b.length && a.every((r) => b.includes(r));
}

/**
 * Puestos que la persona dijo que busca (`profiles.target_roles`, ronda 45). El primero es el
 * principal. Vacío si todavía no eligió. Los valores que no son una clave conocida se ignoran.
 */
export async function getTargetRoles(userId: string): Promise<RoleKey[]> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ targetRoles: s.profiles.targetRoles })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    return knownRoles(row?.targetRoles);
  });
}

/**
 * Tope de puestos de la persona: `max_target_roles` del perfil si lo tiene; si no, el del entorno
 * (`TARGET_ROLES_FREE_LIMIT`, 2 por defecto). La regla vive en el pipeline.
 */
export async function getTargetRolesLimit(userId: string): Promise<number> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ max: s.profiles.maxTargetRoles })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    return targetRolesLimit(process.env, row?.max ?? null);
  });
}

/** Valores del formulario del perfil como strings, tal como los llenan los campos. */
export type ProfileFormValues = {
  country: string;
  city: string;
  acceptedModalities: string[];
  jobLanguage: "es" | "en" | "both";
  workAuthUs: boolean;
  workAuthEu: boolean;
  workAuthOther: string[];
  englishCefr: string;
  yearsTotal: string;
  summary: string;
};

/** Perfil guardado, listo para precargar «Tu perfil». `null` si la persona no tiene fila de perfil. */
export async function getProfileForEdit(userId: string): Promise<ProfileFormValues | null> {
  return withUser(userId, async (tx) => {
    const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.userId, userId)).limit(1);
    if (!p) return null;
    const languages = p.jobLanguages ?? [];
    const es = languages.includes("es");
    const en = languages.includes("en");
    return {
      // `XX` es el marcador del alta por invitación: no es un país elegido
      country: p.locationCountry === "XX" ? "" : p.locationCountry,
      city: p.locationCity ?? "",
      acceptedModalities: p.acceptedModalities ?? [],
      jobLanguage: es && !en ? "es" : en && !es ? "en" : "both",
      workAuthUs: p.workAuth?.us === true,
      workAuthEu: p.workAuth?.eu === true,
      workAuthOther: p.workAuth?.other ?? [],
      englishCefr: p.englishCefr ?? "",
      yearsTotal: p.yearsTotal == null ? "" : String(p.yearsTotal),
      summary: p.profileSummary ?? "",
    };
  });
}

export type SaveProfileResult =
  | { ok: true; roleChanged: boolean; wasComplete: boolean }
  | { ok: false; field: string; reason?: "min" | "max" | "injection" };

/**
 * Núcleo de guardado del perfil, común al onboarding y a Ajustes: FormData → `parseOnboarding` →
 * `completeOnboarding`. Con `keepStored` (Ajustes) los puestos, el piso salarial y las horas no
 * vienen en el formulario: se usan los guardados, sin pisarlos. Si el resumen trae frases dirigidas
 * al modelo no se guarda y solo se loguean los nombres de las señales, nunca el texto.
 */
export async function saveProfileFromForm(
  userId: string,
  formData: FormData,
  options: { keepStored?: boolean } = {},
): Promise<SaveProfileResult> {
  const raw: Record<string, string | string[]> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
  // Los puestos llegan como una casilla por puesto; el tope sale del perfil (o del plan gratis).
  // Modalidades y países de autorización también llegan como un valor por opción.
  for (const k of ["targetRoles", "acceptedModalities", "workAuthOther"]) {
    raw[k] = formData.getAll(k).filter((v): v is string => typeof v === "string");
  }
  let limit = await getTargetRolesLimit(userId);
  if (options.keepStored) {
    const stored = await withUser(userId, async (tx) => {
      const [row] = await tx
        .select({
          targetRoles: s.profiles.targetRoles,
          salaryFloorUsd: s.profiles.salaryFloorUsd,
          maxWeeklyHours: s.profiles.maxWeeklyHours,
        })
        .from(s.profiles)
        .where(eq(s.profiles.userId, userId))
        .limit(1);
      return row ?? null;
    });
    if (!stored) return { ok: false, field: "perfil" };
    const roles = knownRoles(stored.targetRoles);
    raw.targetRoles = roles;
    // Los puestos ya guardados no se rechazan si el tope bajó después
    limit = Math.max(limit, roles.length);
    raw.salaryFloorUsd = stored.salaryFloorUsd == null ? "" : String(stored.salaryFloorUsd);
    raw.maxWeeklyHours = stored.maxWeeklyHours == null ? "" : String(stored.maxWeeklyHours);
  }
  const parsed = parseOnboarding(raw, limit);
  if (!parsed.ok) {
    if (parsed.reason === "injection") {
      createLogger({ user_id: userId, task: "profile_summary" }).warn(
        { signals: parsed.signals ?? [] },
        "resumen del perfil con frases dirigidas al modelo: no se guardó",
      );
    }
    return {
      ok: false,
      field: parsed.field,
      ...(parsed.reason ? { reason: parsed.reason } : {}),
    };
  }
  // Solo la primera vez dispara la ingesta: un POST repetido a la acción no la repite
  const wasComplete = await isOnboardingComplete(userId);
  const { saved, roleChanged } = await completeOnboarding(userId, parsed.value);
  if (!saved) return { ok: false, field: "perfil" };
  return { ok: true, roleChanged, wasComplete };
}

/** ¿La persona ya recibió algún email (`inbound_emails`)? Con RLS: cuenta solo los suyos. */
export async function hasReceivedEmail(userId: string): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.userId, userId))
      .limit(1);
    return Boolean(row);
  });
}

/**
 * Cambia los puestos (Ajustes). Guarda la lista y el principal (`target_role` = el primero) en la
 * misma escritura. Exige al menos una clave y solo claves conocidas, sin repetir; el tope por plan
 * lo valida quien llama con `parseTargetRoles`. `changed` es verdadero si el conjunto anterior era
 * distinto; se lee en la misma transacción que el cambio.
 */
export async function setTargetRoles(
  userId: string,
  roles: unknown,
): Promise<{ saved: boolean; changed: boolean }> {
  if (!Array.isArray(roles) || roles.length === 0) return { saved: false, changed: false };
  const next = knownRoles(roles);
  if (next.length !== new Set(roles).size) return { saved: false, changed: false };
  return withUser(userId, async (tx) => {
    const [before] = await tx
      .select({ targetRoles: s.profiles.targetRoles })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    if (!before) return { saved: false, changed: false };
    const previous = knownRoles(before.targetRoles);
    await tx
      .update(s.profiles)
      .set({ targetRoles: next, targetRole: next[0], updatedAt: new Date() })
      .where(eq(s.profiles.userId, userId));
    return { saved: true, changed: !sameRoleSet(previous, next) };
  });
}

/**
 * Guarda el formulario: actualiza el perfil y, si el usuario no tiene criterios activos, crea
 * la versión siguiente (1 si no tenía ninguna) con las reglas por defecto. Todo en una transacción.
 * Devuelve `saved: false` si el usuario no tiene fila de perfil (no se inventa una); `roleChanged`
 * dice si el puesto es distinto del que había (un reenvío del paso 1 con otro puesto).
 */
export async function completeOnboarding(
  userId: string,
  input: OnboardingInput,
): Promise<{ saved: boolean; roleChanged: boolean }> {
  return withUser(userId, async (tx) => {
    const [before] = await tx
      .select({ targetRoles: s.profiles.targetRoles })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    const previousRoles = knownRoles(before?.targetRoles);
    const updated = await tx
      .update(s.profiles)
      .set({
        targetRoles: input.targetRoles,
        // El principal es el primero de la lista y se escribe siempre junto con ella
        targetRole: input.targetRoles[0] ?? null,
        locationCountry: input.locationCountry,
        locationCity: input.locationCity,
        // remote_only se mantiene en sincronía: lo leen el MCP, los borradores y el prompt
        remoteOnly: input.remoteOnly,
        acceptedModalities: input.acceptedModalities,
        jobLanguages: input.jobLanguages,
        workAuth: input.workAuth,
        englishCefr: input.englishCefr,
        yearsTotal: input.yearsTotal,
        salaryFloorUsd: input.salaryFloorUsd,
        maxWeeklyHours: input.maxWeeklyHours ?? 40,
        profileSummary: input.profileSummary,
        updatedAt: new Date(),
      })
      .where(eq(s.profiles.userId, userId))
      .returning({ userId: s.profiles.userId });
    if (updated.length === 0) return { saved: false, roleChanged: false };

    const [crit] = await tx
      .select({
        active: sql<number>`count(*) filter (where ${s.evaluationCriteria.active})::int`,
        maxVersion: sql<number>`coalesce(max(${s.evaluationCriteria.version}), 0)::int`,
      })
      .from(s.evaluationCriteria)
      .where(eq(s.evaluationCriteria.userId, userId));
    if ((crit?.active ?? 0) === 0) {
      // Doble submit: el unique (user_id, version) deja pasar una sola fila; la otra no hace nada
      await tx
        .insert(s.evaluationCriteria)
        .values({
          userId,
          version: (crit?.maxVersion ?? 0) + 1,
          active: true,
          rules: criteriaFromOnboarding(input),
        })
        .onConflictDoNothing();
    }
    return { saved: true, roleChanged: !sameRoleSet(previousRoles, input.targetRoles) };
  });
}
