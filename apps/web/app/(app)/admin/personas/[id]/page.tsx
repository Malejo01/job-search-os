import {
  historyLabel,
  personActionMessage,
  personBadges,
  planAccess,
  planDef,
  type PersonAction,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SubmitButton } from "@/app/components/submit-button";
import { Alert, Badge, buttonClasses, cardClasses, textLinkClasses } from "@/components/ui";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { getPerson, getPersonHistory, type PersonDetail } from "@/lib/people-admin";
import { requireUserId } from "@/lib/session";
import { personAction } from "./actions";

/**
 * Ficha de una persona (ADM-1): sus datos de cuenta y conteos de uso (sin contenido), el plan, y las
 * acciones del panel: rol tester, cuenta de prueba y bloqueo. El plan se cambia en Planes, que ya tiene
 * la activación, la renovación y el historial.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = "America/Argentina/Buenos_Aires";
const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("es-AR", { timeZone: TZ, dateStyle: "medium" }) : "—";
const fmtDateTime = (d: Date) =>
  d.toLocaleString("es-AR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });

const ACTION_KEYS: readonly PersonAction[] = [
  "tester_si",
  "tester_no",
  "bloquear",
  "desbloquear",
  "prueba_si",
  "prueba_no",
];

function ActionForm({
  id,
  action,
  label,
  pending,
  variant = "secondary",
}: {
  id: string;
  action: PersonAction;
  label: string;
  pending: string;
  variant?: "secondary" | "danger" | "primary";
}) {
  return (
    <form action={personAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="accion" value={action} />
      <SubmitButton pendingLabel={pending} className={buttonClasses({ variant, size: "mid" })}>
        {label}
      </SubmitButton>
    </form>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-fg-muted sm:w-48 sm:shrink-0">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function planText(p: PersonDetail, now: Date): string {
  const access = planAccess({
    plan: p.plan,
    planUntil: p.planUntil,
    planSource: p.planSource,
    now,
  });
  const name = planDef(access.plan).name;
  switch (access.status) {
    case "gratis":
      return "Sin plan pago";
    case "vencido":
      return `Vencido el ${fmtDate(access.until)}`;
    case "sin_vencimiento":
      return `${name}, sin vencimiento${access.becado ? " (beca)" : ""}`;
    default:
      return `${name} hasta el ${fmtDate(access.until)}${access.becado ? " (beca)" : ""}`;
  }
}

export default async function PersonaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;

  let person: PersonDetail | null;
  try {
    person = await getPerson(userId, id);
  } catch {
    return (
      <Alert tone="danger" role="alert">
        No se pudo leer la ficha. Si es la primera vez, falta aplicar la migración del panel
        (rls/0064).
      </Alert>
    );
  }
  if (!person) notFound();
  const history = await getPersonHistory(userId, id).catch(() => null);

  const a = typeof sp.a === "string" ? sp.a : null;
  const r = typeof sp.r === "string" ? sp.r : null;
  const outcome =
    a && r && (ACTION_KEYS as readonly string[]).includes(a)
      ? personActionMessage(a as PersonAction, r)
      : r === "invalida"
        ? { ok: false, message: "Esa acción no existe." }
        : null;

  const now = new Date();
  const badges = personBadges(person, now);
  const self = person.id === userId;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Link href="/admin/personas" className={textLinkClasses({ block: true })}>
        ← Personas
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-title font-bold break-words">{person.name || "Sin nombre"}</h1>
        <p className="break-all text-fg-muted">{person.email}</p>
        <p className="flex flex-wrap gap-1">
          {badges.map((b) => (
            <Badge key={b.key} tone={b.tone}>
              {b.label}
            </Badge>
          ))}
        </p>
      </header>

      {outcome ? (
        <Alert tone={outcome.ok ? "success" : "danger"} role={outcome.ok ? "status" : "alert"}>
          {outcome.message}
        </Alert>
      ) : null}

      <section
        aria-labelledby="cuenta"
        className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}
      >
        <h2 id="cuenta" className="text-heading font-medium">
          Cuenta
        </h2>
        <dl className="flex flex-col gap-2">
          <Row label="Alta">{fmtDate(person.createdAt)}</Row>
          <Row label="Inicio (onboarding)">{person.onboarded ? "Terminado" : "Sin terminar"}</Row>
          <Row label="Términos aceptados">{person.termsVersion ?? "—"}</Row>
          <Row label="Último uso con IA">{fmtDate(person.lastAiAt)}</Row>
          <Row label="Uso">
            {person.jobs} ofertas · {person.applications} postulaciones · {person.interviews}{" "}
            simulaciones · {person.feedback} comentarios
          </Row>
        </dl>
      </section>

      <section
        aria-labelledby="plan"
        className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}
      >
        <h2 id="plan" className="text-heading font-medium">
          Plan
        </h2>
        <p>{planText(person, now)}</p>
        <Link
          href={`/admin/planes?q=${encodeURIComponent(person.email)}`}
          className={buttonClasses({ variant: "secondary", size: "mid", className: "self-start" })}
        >
          Activar, renovar o quitar el plan
        </Link>
      </section>

      <section
        aria-labelledby="acceso"
        className={cardClasses({ padding: "md", className: "flex flex-col gap-4" })}
      >
        <h2 id="acceso" className="text-heading font-medium">
          Acceso y roles
        </h2>

        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Tester</h3>
          <p className="text-sm text-fg-muted">
            Ve las funciones que están en prueba (las que tienen la etapa «testers» encendida). No
            le da permisos de admin.
          </p>
          {person.isTester ? (
            <ActionForm
              id={person.id}
              action="tester_no"
              label="Sacar el rol de tester"
              pending="Guardando…"
            />
          ) : (
            <ActionForm
              id={person.id}
              action="tester_si"
              label="Hacer tester"
              pending="Guardando…"
              variant="primary"
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Cuenta de prueba</h3>
          <p className="text-sm text-fg-muted">
            No cuenta en las métricas ni recibe avisos de vencimiento del plan.
          </p>
          {person.isTest ? (
            <ActionForm
              id={person.id}
              action="prueba_no"
              label="Ya no es de prueba"
              pending="Guardando…"
            />
          ) : (
            <ActionForm
              id={person.id}
              action="prueba_si"
              label="Marcar como de prueba"
              pending="Guardando…"
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Admin</h3>
          <p className="text-sm text-fg-muted">
            {person.isAdmin
              ? "Es admin. Los admins se cambian en ADMIN_EMAILS (Vercel) y app_admins, fuera del panel."
              : "No es admin. Los admins se cambian en ADMIN_EMAILS (Vercel) y app_admins, fuera del panel."}
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="font-semibold">Acceso a la app</h3>
          {person.blockedAt ? (
            <>
              <p className="text-sm text-fg-muted">
                Bloqueada desde el {fmtDate(person.blockedAt)}. No puede iniciar sesión. Sus datos
                siguen guardados.
              </p>
              <ActionForm
                id={person.id}
                action="desbloquear"
                label="Desbloquear"
                pending="Guardando…"
                variant="primary"
              />
            </>
          ) : self || person.isAdmin ? (
            <p className="text-sm text-fg-muted">
              {self
                ? "Es tu cuenta: no se puede bloquear desde acá."
                : "Es admin: para bloquearla, primero sacala de los admins."}
            </p>
          ) : (
            <details className="group flex flex-col gap-2">
              <summary
                className={buttonClasses({
                  variant: "secondary",
                  size: "mid",
                  className: "w-fit cursor-pointer list-none",
                })}
              >
                Bloquear el acceso…
              </summary>
              <div className="mt-3 flex flex-col gap-2 rounded-control bg-danger-muted p-3">
                <p className="text-sm">
                  Se cierran sus sesiones abiertas y no puede volver a entrar hasta que la
                  desbloquees. No se borra nada: su plan, sus ofertas y su CV quedan como están.
                </p>
                <ActionForm
                  id={person.id}
                  action="bloquear"
                  label="Sí, bloquear"
                  pending="Bloqueando…"
                  variant="danger"
                />
              </div>
            </details>
          )}
        </div>
      </section>

      <section
        aria-labelledby="historial"
        className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}
      >
        <h2 id="historial" className="text-heading font-medium">
          Historial
        </h2>
        {history === null ? (
          <p className="text-sm text-fg-muted">No se pudo leer el historial.</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-fg-muted">Sin cambios desde el panel ni de plan.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {history.map((h, i) => (
              <li
                key={`${h.createdAt.toISOString()}-${i}`}
                className="flex flex-col text-sm sm:flex-row sm:gap-3"
              >
                <span className="text-fg-muted tabular-nums sm:w-36 sm:shrink-0">
                  {fmtDateTime(h.createdAt)}
                </span>
                <span>
                  {historyLabel(h.action, h.source)}
                  {h.adminEmail ? <span className="text-fg-muted"> · {h.adminEmail}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
