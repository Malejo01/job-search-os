import {
  BETA_OPENS_AT,
  betaPeriodDays,
  BETA_PLAN,
  filterPlanRows,
  parsePlanFilter,
  planAccess,
  planDef,
  PLAN_OVERRIDES,
  PLAN_OVERRIDE_LABELS,
  REJECT_REASON_MAX_LENGTH,
  TESTER_50_LINK_ENV,
} from "@job-search-os/pipeline";
import { requireAdminOr404 } from "@/lib/admin-guard";
import {
  listPendingNotices,
  listPlanEvents,
  listPlanOverrides,
  listPlans,
  PlanAdminNotEnabledInDbError,
  type AdminPlanRow,
  type PlanEventAction,
} from "@/lib/plan-admin";
import { requireUserId } from "@/lib/session";
import { SubmitButton } from "@/app/components/submit-button";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";
import {
  activateNoticeAction,
  grantPlanAction,
  rejectNoticeAction,
  revokePlanAction,
  setPlanOverrideAction,
} from "./actions";

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
  aviso_activado: "Listo: el aviso quedó activado con el pago.",
  aviso_rechazado: "Listo: el aviso quedó rechazado.",
};
const ERROR_MESSAGE: Record<string, string> = {
  email_invalido: "Ese email no es válido.",
  no_existe: "No encontramos a esa persona, o todavía no terminó el onboarding.",
  plan_viejo:
    "Esa persona tiene un plan viejo (fundador o pase de 3 meses). Cambialo a mano; ver docs/OPERACION.md.",
  origen: "Elegí si pagó o es becado.",
  marca: "Elegí una marca de la lista.",
  marca_no_existe: "No encontramos a esa persona (el email tiene que ser el de su cuenta).",
  aviso: "No se pudo leer el aviso.",
  aviso_ya_resuelto: "Ese aviso ya estaba resuelto: no se cambió nada.",
  aviso_no_existe: "No se pudo: la persona todavía no terminó el onboarding, o el aviso no existe.",
  aviso_plan_viejo:
    "Esa persona tiene un plan viejo (fundador o pase de 3 meses). Cambialo a mano; ver docs/OPERACION.md.",
  aviso_motivo_invalido: "Escribí un motivo corto (hasta 200 caracteres).",
  no_admin: "Tu cuenta no puede administrar planes.",
  sin_base: "Tu cuenta es admin en la app pero falta habilitarla en la base (app_admins).",
};

const PLAN_FILTERS = [
  ["vencen_7", "Vencen en 7 días"],
  ["vencidos", "Vencidos"],
  ["pendientes", "Pendientes"],
] as const;
const EVENT_LABEL: Record<PlanEventAction, string> = {
  activar: "Activado",
  renovar: "Renovado",
  quitar: "Plan quitado",
  rechazar_aviso: "Aviso rechazado",
  marca: "Marca de precio cambiada",
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
  searchParams: Promise<{ ok?: string; error?: string; q?: string; filtro?: string }>;
}) {
  const userId = await requireUserId();
  const { ok, error, q: rawQ, filtro } = await searchParams;
  const q = (rawQ ?? "").slice(0, 100);
  const filter = parsePlanFilter(filtro);
  // Como las demás pantallas de admin: 404 para una cuenta común
  await requireAdminOr404(userId);
  const rows = await listPlans(userId).catch((e: unknown) => {
    if (e instanceof PlanAdminNotEnabledInDbError) return null;
    throw e;
  });
  // ADR-040: si la migración de `plan_overrides` todavía no está aplicada, la sección lo dice y el resto sigue
  const overrides = rows === null ? null : await listPlanOverrides(userId).catch(() => null);
  // R22-02: la cola y el historial se leen con funciones nuevas; si la migración todavía no está, el resto sigue
  const [notices, events] =
    rows === null
      ? [null, null]
      : await Promise.all([
          listPendingNotices(userId).catch(() => null),
          listPlanEvents(userId, 15).catch(() => null),
        ]);
  const now = new Date();
  const days = betaPeriodDays(BETA_PLAN);
  // La lista es chica (tope de 200 en la base): se filtra en memoria, sin otra consulta
  const visibleRows: AdminPlanRow[] =
    rows === null
      ? []
      : filterPlanRows(rows, {
          q,
          filter,
          now,
          pendingEmails: new Set((notices ?? []).map((n) => n.email)),
        });

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
            aria-labelledby="cola"
            data-testid="cola-avisos"
            className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}
          >
            <h2 id="cola" className="text-heading font-medium">
              Avisos de pago pendientes
            </h2>
            {notices === null ? (
              <Alert tone="warning" role="status">
                No se pudo leer la cola (¿falta aplicar la migración de los avisos?).
              </Alert>
            ) : notices.length === 0 ? (
              <p className="text-sm text-fg-subtle">No hay avisos pendientes.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-card bg-surface-subtle">
                {notices.map((n) => (
                  <li
                    key={n.id}
                    data-testid="aviso-pendiente"
                    className="flex flex-col gap-2 p-3 text-sm"
                  >
                    <span className="break-all font-medium text-fg">{n.email}</span>
                    <span className="text-fg-muted">
                      {DATE.format(n.createdAt)} · plan{" "}
                      {n.plan === BETA_PLAN ? planDef(BETA_PLAN).name : n.plan} ·{" "}
                      {n.operationNumber
                        ? `operación ${n.operationNumber}`
                        : "sin número de operación"}
                    </span>
                    <div className="flex flex-wrap items-start gap-3">
                      <form action={activateNoticeAction}>
                        <input type="hidden" name="noticeId" value={n.id} />
                        <SubmitButton
                          className={buttonClasses({ size: "sm" })}
                          pendingLabel="Activando…"
                        >
                          Activar {days} días
                        </SubmitButton>
                      </form>
                      <details>
                        <summary className="flex min-h-11 w-fit cursor-pointer items-center text-fg-muted underline underline-offset-2">
                          Rechazar
                        </summary>
                        <form action={rejectNoticeAction} className="flex flex-col gap-2 pb-2">
                          <input type="hidden" name="noticeId" value={n.id} />
                          <label
                            className="flex flex-col gap-1 text-sm font-medium"
                            htmlFor={`motivo-${n.id}`}
                          >
                            Motivo (corto)
                            <input
                              id={`motivo-${n.id}`}
                              name="reason"
                              required
                              maxLength={REJECT_REASON_MAX_LENGTH}
                              autoComplete="off"
                              className={FIELD}
                            />
                          </label>
                          <SubmitButton
                            className={buttonClasses({
                              variant: "secondary",
                              size: "sm",
                              className: "w-fit",
                            })}
                            pendingLabel="Rechazando…"
                          >
                            Rechazar aviso
                          </SubmitButton>
                        </form>
                      </details>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

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
                    Email de la persona con precio especial
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
            <form
              method="get"
              action="/admin/planes"
              role="search"
              className="flex flex-col gap-2 rounded-card bg-surface p-3"
            >
              <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="plan-buscar">
                Buscar por email
                <input
                  id="plan-buscar"
                  name="q"
                  type="search"
                  defaultValue={q}
                  maxLength={100}
                  autoComplete="off"
                  className={FIELD}
                />
              </label>
              <div
                className="flex flex-wrap items-center gap-3 text-sm"
                data-testid="planes-filtros"
              >
                <label className="flex min-h-11 items-center gap-2">
                  <input type="radio" name="filtro" value="" defaultChecked={filter === null} />
                  Todos
                </label>
                {PLAN_FILTERS.map(([value, label]) => (
                  <label key={value} className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="filtro"
                      value={value}
                      defaultChecked={filter === value}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <button
                type="submit"
                className={buttonClasses({ variant: "secondary", size: "sm", className: "w-fit" })}
              >
                Buscar
              </button>
              <p className="text-xs text-fg-subtle">
                «Pendientes» muestra a quienes ya tienen un plan y un aviso sin resolver; quien no
                tiene plan aparece solo en la cola de arriba.
              </p>
            </form>
            {rows.length === 0 ? (
              <p className="text-sm text-fg-subtle">Todavía no activaste a nadie.</p>
            ) : visibleRows.length === 0 ? (
              <p data-testid="planes-sin-resultados" className="text-sm text-fg-subtle">
                No hay nadie que coincida con la búsqueda.
              </p>
            ) : (
              <ul
                data-testid="planes-lista"
                className="flex flex-col divide-y divide-line rounded-card bg-surface"
              >
                {visibleRows.map((row) => (
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
                    {/* R22-02: renovar en un clic, con la misma acción de alta (como pago) */}
                    <form action={grantPlanAction}>
                      <input type="hidden" name="email" value={row.email} />
                      <input type="hidden" name="source" value="pago" />
                      <SubmitButton
                        className={buttonClasses({
                          variant: "secondary",
                          size: "sm",
                          className: "w-fit",
                        })}
                        pendingLabel="Renovando…"
                      >
                        Renovar +{days} días
                      </SubmitButton>
                    </form>
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

          <section
            aria-labelledby="historial"
            data-testid="historial-plan"
            className="flex flex-col gap-2"
          >
            <h2 id="historial" className="text-heading font-medium">
              Últimos cambios
            </h2>
            {events === null ? (
              <p className="text-sm text-fg-subtle">
                No se pudo leer el historial (¿falta aplicar la migración?).
              </p>
            ) : events.length === 0 ? (
              <p className="text-sm text-fg-subtle">Todavía no hay cambios registrados.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-card bg-surface">
                {events.map((e, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-baseline justify-between gap-2 p-3 text-sm"
                  >
                    <span className="break-all text-fg">{e.email}</span>
                    <span className="text-fg-muted">
                      {EVENT_LABEL[e.action]}
                      {e.source === "beca"
                        ? " (beca)"
                        : e.source === "pago"
                          ? " (pago)"
                          : ""} · {DATE.format(e.createdAt)}
                    </span>
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
