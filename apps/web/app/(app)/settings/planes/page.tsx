import { BETA_OPENS_AT, betaPeriodDays, BETA_PLAN, planAccess } from "@job-search-os/pipeline";
import { canCreateInvitations } from "@/lib/invitations";
import { listPlans, PlanAdminNotEnabledInDbError, type AdminPlanRow } from "@/lib/plan-admin";
import { requireUserId } from "@/lib/session";
import { grantPlanAction, revokePlanAction } from "./actions";

export const metadata = { title: "Planes de la beta" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "long",
  timeZone: "America/Argentina/Buenos_Aires",
});

const OK_MESSAGE: Record<string, string> = {
  pago: "Listo: quedó activo con el pago.",
  beca: "Listo: quedó activo como becado.",
  quitado: "Listo: pasó al plan gratis. No se borró nada de lo suyo.",
};
const ERROR_MESSAGE: Record<string, string> = {
  email_invalido: "Ese email no es válido.",
  no_existe: "No encontramos a esa persona, o todavía no terminó el onboarding.",
  plan_viejo:
    "Esa persona tiene un plan viejo (fundador o pase de 3 meses). Cambialo a mano; ver docs/OPERACION.md.",
  origen: "Elegí si pagó o es becado.",
  no_admin: "Tu cuenta no puede administrar planes.",
  sin_base: "Tu cuenta es admin en la app pero falta habilitarla en la base (app_admins).",
};

const FIELD =
  "min-h-11 w-full rounded-control border border-line-control bg-surface px-3 text-base text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-4 text-base font-medium text-brand-contrast hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function stateText(row: AdminPlanRow, now: Date): string {
  const access = planAccess({
    plan: row.plan,
    planUntil: row.planUntil,
    planSource: row.planSource,
    now,
  });
  if (access.status === "vencido" && access.until) return `Venció el ${DATE.format(access.until)}`;
  if (access.status === "sin_vencimiento") return "Sin vencimiento";
  if (access.until && access.daysLeft !== null) {
    const faltan = access.daysLeft === 1 ? "falta 1 día" : `faltan ${access.daysLeft} días`;
    return `Hasta el ${DATE.format(access.until)} (${faltan})`;
  }
  return "—";
}

/**
 * Planes de la beta (C3-1), solo admins: activa 30 días como pago o como beca, lista quién tiene acceso y
 * hasta cuándo, y pasa a alguien al plan gratis. Server Component y formularios nativos: sin JavaScript.
 */
export default async function PlanesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const userId = await requireUserId();
  const { ok, error } = await searchParams;
  const isAdmin = await canCreateInvitations(userId);
  const rows = isAdmin
    ? await listPlans(userId).catch((e: unknown) => {
        if (e instanceof PlanAdminNotEnabledInDbError) return null;
        throw e;
      })
    : [];
  const now = new Date();
  const days = betaPeriodDays(BETA_PLAN);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-title font-semibold">Planes de la beta</h1>

      {!isAdmin ? (
        <p className="text-sm text-fg-muted">
          Tu cuenta no puede administrar planes: es una función de administración.
        </p>
      ) : rows === null ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          {ERROR_MESSAGE.sin_base}
        </p>
      ) : (
        <>
          {ok && OK_MESSAGE[ok] ? (
            <p
              role="status"
              data-testid="planes-ok"
              className="rounded-control bg-success-soft px-3 py-2 text-sm text-success"
            >
              {OK_MESSAGE[ok]}
            </p>
          ) : null}
          {error && ERROR_MESSAGE[error] ? (
            <p
              role="alert"
              data-testid="planes-error"
              className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              {ERROR_MESSAGE[error]}
            </p>
          ) : null}

          <section
            aria-labelledby="activar"
            className="flex flex-col gap-3 rounded-card border border-line p-4"
          >
            <h2 id="activar" className="text-heading font-medium">
              Activar {days} días
            </h2>
            <p className="text-sm text-fg-muted">
              Cuenta {days} días desde hoy, o desde el {DATE.format(BETA_OPENS_AT)} si la beta
              todavía no abrió. Si la persona ya tenía días, se suman. Solo para personas que ya
              terminaron el onboarding.
            </p>
            <form action={grantPlanAction} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="plan-email">
                Email de la persona
                <input
                  id="plan-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="off"
                  maxLength={254}
                  className={FIELD}
                />
              </label>
              <fieldset className="flex flex-col gap-1">
                <legend className="text-sm font-medium">Cómo llegó</legend>
                <label className="flex min-h-11 items-center gap-2 text-base">
                  <input type="radio" name="source" value="pago" defaultChecked />
                  Pagó (link de Mercado Pago o transferencia)
                </label>
                <label className="flex min-h-11 items-center gap-2 text-base">
                  <input type="radio" name="source" value="beca" />
                  Becado (primer mes gratis)
                </label>
              </fieldset>
              <button type="submit" className={BUTTON}>
                Activar {days} días
              </button>
            </form>
          </section>

          <section aria-labelledby="quienes" className="flex flex-col gap-2">
            <h2 id="quienes" className="text-heading font-medium">
              Quién tiene acceso
            </h2>
            {rows.length === 0 ? (
              <p className="text-sm text-fg-subtle">Todavía no activaste a nadie.</p>
            ) : (
              <ul
                data-testid="planes-lista"
                className="flex flex-col divide-y divide-line rounded-card border border-line"
              >
                {rows.map((row) => (
                  <li key={row.email} className="flex flex-col gap-2 p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="break-all font-medium text-fg">{row.email}</span>
                      <span className="rounded-badge bg-surface-muted px-1.5 py-0.5 text-xs text-fg-muted">
                        {row.planSource === "beca"
                          ? "Becado"
                          : row.planSource === "pago"
                            ? "Pagó"
                            : "Sin dato"}
                      </span>
                    </div>
                    <span className="text-fg-muted">{stateText(row, now)}</span>
                    <details>
                      <summary className="flex min-h-11 w-fit cursor-pointer items-center text-fg-muted underline underline-offset-2">
                        Quitar el plan
                      </summary>
                      <form action={revokePlanAction} className="flex flex-col gap-2 pb-2">
                        <p className="text-fg-muted">
                          Pasa al plan gratis y pierde los días que le quedaban. No se borra nada de
                          lo suyo.
                        </p>
                        <input type="hidden" name="email" value={row.email} />
                        <button
                          type="submit"
                          className="inline-flex min-h-11 w-fit items-center rounded-control border border-line-strong px-4 text-fg"
                        >
                          Sí, quitar el plan
                        </button>
                      </form>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
