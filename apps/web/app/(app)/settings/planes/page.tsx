import {
  BETA_OPENS_AT,
  betaPeriodDays,
  BETA_PLAN,
  planAccess,
  PLAN_OVERRIDES,
  PLAN_OVERRIDE_LABELS,
  TESTER_50_LINK_ENV,
} from "@job-search-os/pipeline";
import { requireAdminOr404 } from "@/lib/admin-guard";
import {
  listPlanOverrides,
  listPlans,
  PlanAdminNotEnabledInDbError,
  type AdminPlanRow,
} from "@/lib/plan-admin";
import { requireUserId } from "@/lib/session";
import { SubmitButton } from "@/app/components/submit-button";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";
import { grantPlanAction, revokePlanAction, setPlanOverrideAction } from "./actions";

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
  marca_puesta: "Listo: quedó guardada la marca de precio especial.",
  marca_quitada: "Listo: volvió al precio normal.",
};
const ERROR_MESSAGE: Record<string, string> = {
  email_invalido: "Ese email no es válido.",
  no_existe: "No encontramos a esa persona, o todavía no terminó el onboarding.",
  plan_viejo:
    "Esa persona tiene un plan viejo (fundador o pase de 3 meses). Cambialo a mano; ver docs/OPERACION.md.",
  origen: "Elegí si pagó o es becado.",
  marca: "Elegí una marca de la lista.",
  marca_no_existe: "No encontramos a esa persona (el email tiene que ser el de su cuenta).",
  no_admin: "Tu cuenta no puede administrar planes.",
  sin_base: "Tu cuenta es admin en la app pero falta habilitarla en la base (app_admins).",
};

const FIELD = inputClasses();
const BUTTON = buttonClasses({ className: "self-start" });

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
  // Como las demás pantallas de admin: 404 para una cuenta común
  await requireAdminOr404(userId);
  const rows = await listPlans(userId).catch((e: unknown) => {
    if (e instanceof PlanAdminNotEnabledInDbError) return null;
    throw e;
  });
  // ADR-040: si la migración de `plan_overrides` todavía no está aplicada, la sección lo dice y el resto sigue
  const overrides = rows === null ? null : await listPlanOverrides(userId).catch(() => null);
  const now = new Date();
  const days = betaPeriodDays(BETA_PLAN);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-title font-bold">Planes de la beta</h1>

      {rows === null ? (
        <Alert tone="danger" role="alert">
          {ERROR_MESSAGE.sin_base}
        </Alert>
      ) : (
        <>
          {ok && OK_MESSAGE[ok] ? (
            <Alert tone="success" role="status" data-testid="planes-ok">
              {OK_MESSAGE[ok]}
            </Alert>
          ) : null}
          {error && ERROR_MESSAGE[error] ? (
            <Alert tone="danger" role="alert" data-testid="planes-error">
              {ERROR_MESSAGE[error]}
            </Alert>
          ) : null}

          <section
            aria-labelledby="activar"
            className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}
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
              {/* C8-14: deshabilitado mientras activa, así un doble clic no manda dos bienvenidas */}
              <SubmitButton className={BUTTON} pendingLabel="Activando…">
                Activar {days} días
              </SubmitButton>
            </form>
          </section>

          <section
            aria-labelledby="precio-especial"
            data-testid="precio-especial"
            className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}
          >
            <h2 id="precio-especial" className="text-heading font-medium">
              Precio especial
            </h2>
            <p className="text-sm text-fg-muted">
              «Becado» deja el plan bonificado: en «Tu plan» se le dice que no paga y no ve ningún
              link. «Tester» le muestra el link de Mercado Pago del 50 % (variable{" "}
              <code>{TESTER_50_LINK_ENV}</code>); si esa variable falta, se le pide que escriba al
              equipo y nunca ve el precio completo. No cambia la fecha de su plan: eso sigue en
              «Activar». Solo vos podés poner o sacar la marca.
            </p>
            {overrides === null ? (
              <Alert tone="warning" role="status">
                No se pudo leer la lista (¿falta aplicar la migración del precio especial?).
              </Alert>
            ) : (
              <>
                <form action={setPlanOverrideAction} className="flex flex-col gap-3">
                  <label
                    className="flex flex-col gap-1 text-sm font-medium"
                    htmlFor="override-email"
                  >
                    Email de la persona
                    <input
                      id="override-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="off"
                      maxLength={254}
                      className={FIELD}
                    />
                  </label>
                  <label
                    className="flex flex-col gap-1 text-sm font-medium"
                    htmlFor="override-valor"
                  >
                    Marca
                    <select
                      id="override-valor"
                      name="override"
                      required
                      className={FIELD}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Elegí una opción
                      </option>
                      {PLAN_OVERRIDES.map((o) => (
                        <option key={o} value={o}>
                          {PLAN_OVERRIDE_LABELS[o]}
                        </option>
                      ))}
                      <option value="ninguna">Sin marca (volver al precio normal)</option>
                    </select>
                  </label>
                  <SubmitButton className={BUTTON} pendingLabel="Guardando…">
                    Guardar marca
                  </SubmitButton>
                </form>
                {overrides.length === 0 ? (
                  <p className="text-sm text-fg-subtle">Todavía no hay marcas.</p>
                ) : (
                  <ul
                    data-testid="precio-especial-lista"
                    className="flex flex-col divide-y divide-line rounded-card bg-surface-subtle"
                  >
                    {overrides.map((o) => (
                      <li
                        key={o.email}
                        className="flex flex-wrap items-baseline justify-between gap-2 p-3 text-sm"
                      >
                        <span className="break-all font-medium text-fg">{o.email}</span>
                        <span className="rounded-badge bg-surface-muted px-1.5 py-0.5 text-xs text-fg-muted">
                          {PLAN_OVERRIDE_LABELS[o.override]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
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
                className="flex flex-col divide-y divide-line rounded-card bg-surface"
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
                          className={buttonClasses({
                            variant: "secondary",
                            size: "sm",
                            className: "w-fit",
                          })}
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
