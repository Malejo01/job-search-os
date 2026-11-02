import {
  ALERT_PORTALS,
  firstName,
  greeting,
  VISIT_COOKIE,
  visitWindow,
  type ReviewProgress,
} from "@job-search-os/pipeline";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { PORTAL_STATUS_VIEW } from "@/app/onboarding/asistente/alert-guide";
import { careerLabel } from "@/lib/career-market";
import { getDisplayName } from "@/lib/display-name";
import { getHoyData, type HoyData } from "@/lib/hoy";
import { parseJobFilters, reviewProgressFor } from "@/lib/jobs";
import { listPendingJd, type PendingJdRow } from "@/lib/pending-jd";
import { Card as UiCard, EmptyState, textLinkClasses } from "@/components/ui";
import { requireActiveUserId } from "@/lib/session";
import { MarkVisit } from "./mark-visit";
import { NewJobRow } from "./new-job-row";
import { StaggerCard } from "./stagger-cards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hoy" };

const VISIT_MAX_AGE = 60 * 60 * 24 * 365;
const SHOWN = 5;
const FOLLOW_UPS_SHOWN = 3;
const PENDING_SHOWN = 3;

const LINK = textLinkClasses({ block: true });
const LINK_INLINE = textLinkClasses();

/**
 * Guarda la marca de visita. No recibe nada del cliente: lee la cookie actual y recalcula la marca
 * con el usuario de la sesión; si no hay que reescribirla (stamp null), no hace nada.
 */
async function markVisitAction(): Promise<void> {
  "use server";
  const userId = await requireActiveUserId();
  const jar = await cookies();
  const { stamp } = visitWindow(jar.get(VISIT_COOKIE)?.value, userId, new Date());
  if (stamp === null) return;
  jar.set(VISIT_COOKIE, stamp, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VISIT_MAX_AGE,
  });
}

function formatDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone }).format(d);
}

/**
 * «Hoy» (ronda 119, rediseño P2 en C7-7): lo que pasó desde tu última visita, en una pantalla.
 * Todo con RLS, sin LLM y con datos que la app ya calcula: las mejores ofertas evaluadas, las que
 * esperan descripción, el seguimiento de postulaciones y los próximos pasos que salen de eso.
 */
export default async function HoyPage() {
  const userId = await requireActiveUserId();
  const jar = await cookies();
  const now = new Date();
  const [data, displayName, pending, week] = await Promise.all([
    getHoyData(userId, now, jar.get(VISIT_COOKIE)?.value),
    // Lo que no es central no rompe la pantalla: sin nombre, sin pendientes o sin semana, se omite
    getDisplayName(userId).catch(() => null),
    listPendingJd(userId).catch(() => []),
    reviewProgressFor(userId, parseJobFilters({ periodo: "semana" })).catch(() => null),
  ]);
  const name = firstName(displayName);
  const highScore = data.jobs.filter((j) => j.score !== null && j.score >= 7).length;
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-sans text-sm font-bold tracking-wide text-brand-text uppercase">
            Hoy
          </h1>
          <p className="text-xs font-semibold text-fg-subtle">
            {capitalize(formatWeekday(now, data.timeZone))}
          </p>
          <p className="font-display text-[28px] leading-tight font-extrabold tracking-tight text-fg">
            {greeting(now, data.timeZone)}
            {name ? `, ${name}` : ""}.
          </p>
          <p data-testid="hoy-titular" className="text-[15px] text-fg-muted">
            {highScore > 0 ? (
              <>
                Hay{" "}
                <span className="font-bold text-brand-text">
                  {highScore === 1 ? "1 oferta" : `${highScore} ofertas`}
                </span>{" "}
                con puntaje alto para mirar.
              </>
            ) : data.jobs.length > 0 ? (
              "Hay ofertas nuevas evaluadas, ninguna con puntaje alto."
            ) : (
              "No hay ofertas nuevas evaluadas para mirar."
            )}
          </p>
          <p data-testid="hoy-visita" className="text-xs text-fg-subtle">
            {data.since
              ? `Tu última visita: ${formatDate(data.since, data.timeZone)}`
              : "Primera vez por acá"}
          </p>
        </div>
        {data.digest ? (
          <section
            data-testid="hoy-resumen"
            aria-labelledby="hoy-resumen-titulo"
            className="rounded-card bg-surface-subtle px-4 py-3"
          >
            <h2 id="hoy-resumen-titulo" className="text-base font-bold text-fg">
              En resumen
            </h2>
            <p className="text-sm text-fg-muted">{data.digest}</p>
          </section>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <NewCard data={data} index={0} />
          {pending.length > 0 ? <PendingCard rows={pending} index={1} /> : null}
          <FollowUpCard data={data} index={2} />
          {data.fit ? (
            <Card id="hoy-encaje-titulo" testId="hoy-encaje" title="Tu encaje" index={3}>
              <p className="text-sm text-fg-muted">{data.fit.headline}</p>
              <Link href="/encaje" className={LINK}>
                Ver tu encaje
              </Link>
            </Card>
          ) : null}
          <AlertsCard data={data} index={4} />
          <MarketCard data={data} index={5} />
        </div>
      </div>
      <aside aria-label="Tu semana y próximos pasos" className="flex w-full flex-col gap-3 lg:w-80">
        <WeekCard newCount={data.jobs.length} week={week} />
        <NextSteps data={data} highScore={highScore} pending={pending.length} />
        <p className="text-xs text-fg-subtle">
          Vos decidís. La postulación la hacés vos en el sitio del aviso: nunca postulamos por vos.
        </p>
      </aside>
      {data.stamp ? <MarkVisit action={markVisitAction} /> : null}
    </div>
  );
}

function formatWeekday(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone,
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(d);
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("es-AR") + text.slice(1);
}

/**
 * «Tu semana» (P2): solo lo que la app calcula. Nuevas evaluadas en la ventana de «Hoy» y las
 * verdes revisadas de esta semana (el mismo conteo que /jobs). P2 muestra también «aplicadas»: no
 * hay un conteo semanal de postulaciones y queda afuera.
 */
function WeekCard({ newCount, week }: { newCount: number; week: ReviewProgress | null }) {
  return (
    <section
      aria-labelledby="hoy-semana-titulo"
      data-testid="hoy-semana"
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
    >
      <h2 id="hoy-semana-titulo" className="text-base font-bold text-fg">
        Tu semana
      </h2>
      <p className="flex items-baseline gap-2">
        <span className="font-display text-[28px] leading-none font-extrabold text-brand-text">
          {newCount}
        </span>
        <span className="text-sm font-semibold text-fg-muted">
          {newCount === 1 ? "oferta nueva evaluada" : "ofertas nuevas evaluadas"}
        </span>
      </p>
      {week && week.total > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold text-fg-muted">
            Verdes revisadas: {week.revisadas} de {week.total}
          </p>
          <div
            role="progressbar"
            aria-label="Ofertas verdes revisadas esta semana"
            aria-valuemin={0}
            aria-valuemax={week.total}
            aria-valuenow={week.revisadas}
            className="h-1.5 overflow-hidden rounded-pill bg-line"
          >
            <div
              className={`h-full rounded-pill ${week.revisadas === week.total ? "bg-success-strong" : "bg-brand"}`}
              style={{ width: `${Math.round((week.revisadas / week.total) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** «Próximos pasos» (P2): salen de los datos de la pantalla, nunca de una lista fija. */
function NextSteps({
  data,
  highScore,
  pending,
}: {
  data: HoyData;
  highScore: number;
  pending: number;
}) {
  const steps: Array<{ text: string; href: string }> = [];
  if (data.roles.length === 0) steps.push({ text: "Elegí tu carrera", href: "/settings#puesto" });
  if (highScore > 0)
    steps.push({
      text:
        highScore === 1
          ? "Revisar la oferta con puntaje alto"
          : `Revisar las ${highScore} ofertas con puntaje alto`,
      href: "/jobs",
    });
  if (pending > 0)
    steps.push({
      text:
        pending === 1
          ? "Completar 1 descripción pendiente"
          : `Completar ${pending} descripciones pendientes`,
      href: "/jobs/pending-jd",
    });
  if (data.followUps.length > 0)
    steps.push({
      text:
        data.followUps.length === 1
          ? "Hacer el seguimiento de 1 postulación"
          : `Hacer el seguimiento de ${data.followUps.length} postulaciones`,
      href: "/applications#seguimiento",
    });
  if (ALERT_PORTALS.every((p) => data.coverage[p.id].status === "nunca"))
    steps.push({ text: "Sumar tus alertas de empleo por email", href: "/settings/asistente" });
  steps.push({ text: "Cargar una oferta que viste", href: "/jobs/new" });
  return (
    <section
      aria-labelledby="hoy-pasos-titulo"
      data-testid="hoy-pasos"
      className="flex flex-col gap-2 rounded-card bg-ink p-4 text-on-ink"
    >
      <h2 id="hoy-pasos-titulo" className="text-base font-bold">
        Próximos pasos
      </h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {steps.slice(0, 4).map((step) => (
          <li key={step.href}>
            <Link
              href={step.href}
              className="flex min-h-11 items-center gap-2 rounded-control text-sm font-semibold text-on-ink-muted hover:text-on-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill bg-brand" />
              {step.text}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** «Para completar» (P2): las primeras ofertas que esperan la descripción, con su link. */
function PendingCard({ rows, index = 0 }: { rows: PendingJdRow[]; index?: number }) {
  return (
    <Card id="hoy-completar-titulo" testId="hoy-completar" title="Para completar" index={index}>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.slice(0, PENDING_SHOWN).map((row) => (
          <li key={row.id} className="min-w-0 text-sm">
            <p className="truncate font-bold text-fg">{row.title}</p>
            <p className="truncate text-xs text-fg-subtle">
              {[row.company, row.locationRaw, "sin descripción"].filter(Boolean).join(" · ")}
            </p>
          </li>
        ))}
      </ul>
      <Link href="/jobs/pending-jd" className={LINK}>
        {rows.length === 1 ? "Pegar la descripción" : "Pegar las descripciones"}
      </Link>
    </Card>
  );
}

function Card({
  id,
  testId,
  title,
  wide,
  index = 0,
  children,
}: {
  id: string;
  testId: string;
  title: string;
  wide?: boolean;
  index?: number;
  children: ReactNode;
}) {
  return (
    // C7-7: tarjetas blancas sobre el fondo de la página, como en P2
    <StaggerCard wide={wide} index={index}>
      <UiCard
        as="section"
        padding="md"
        data-testid={testId}
        aria-labelledby={id}
        className="flex min-w-0 flex-col gap-2"
      >
        <h2 id={id} className="text-base font-bold text-fg">
          {title}
        </h2>
        {children}
      </UiCard>
    </StaggerCard>
  );
}

function NewCard({ data, index = 0 }: { data: HoyData; index?: number }) {
  const { jobs, since, empty, roles } = data;
  const title = since ? "Lo nuevo para vos" : "Tus mejores ofertas de la semana";
  return (
    <Card id="hoy-nuevo-titulo" testId="hoy-nuevo" title={title} wide index={index}>
      {jobs.length > 0 ? (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {jobs.slice(0, SHOWN).map((job) => (
              <NewJobRow key={job.id} job={job} />
            ))}
          </ul>
          <Link href="/jobs" className={LINK}>
            {jobs.length === 1 ? "Ver la oferta" : "Ver todas mis ofertas"}
          </Link>
        </>
      ) : empty && empty.counts.total === 0 ? (
        <EmptyState
          variant="inline"
          data-testid="hoy-vacio-sin-ofertas"
          action={
            roles.length === 0 ? (
              <Link href="/settings#puesto" className={LINK}>
                Elegí tu carrera
              </Link>
            ) : !empty.hasReceivedEmail ? (
              <Link href="/settings/asistente" className={LINK}>
                Sumá tus alertas de empleo por email
              </Link>
            ) : (
              <Link href="/jobs/new" className={LINK}>
                Pegá una oferta
              </Link>
            )
          }
        >
          Todavía no llegaron ofertas para vos: las buscamos todos los días.
        </EmptyState>
      ) : empty && empty.counts.porEvaluar > 0 ? (
        <EmptyState
          variant="inline"
          data-testid="hoy-vacio-en-cola"
          action={
            <Link href="/jobs?estado=prefiltrada" className={LINK}>
              Ver las que esperan
            </Link>
          }
        >
          {empty.counts.porEvaluar === 1
            ? "Estamos evaluando 1 oferta: volvé en un rato."
            : `Estamos evaluando ${empty.counts.porEvaluar} ofertas: volvé en un rato.`}
        </EmptyState>
      ) : (
        <EmptyState
          variant="inline"
          data-testid="hoy-vacio-nada-nuevo"
          action={
            <Link href="/jobs?estado=todas" className={LINK}>
              Ver todas las ofertas
            </Link>
          }
        >
          {since
            ? `Nada nuevo desde tu última visita (${formatDate(since, data.timeZone)}).`
            : "Nada nuevo en la última semana."}
        </EmptyState>
      )}
    </Card>
  );
}

/**
 * «Para hacer seguimiento» (C-9, diseño de la 119 §2): las tres primeras y el link a la lista. Sin
 * botones: las acciones viven en /applications.
 */
function FollowUpCard({ data, index = 0 }: { data: HoyData; index?: number }) {
  const { followUps } = data;
  return (
    <Card
      id="hoy-seguimiento-titulo"
      testId="hoy-seguimiento"
      title="Para hacer seguimiento"
      index={index}
    >
      {followUps.length === 0 ? (
        <EmptyState
          variant="inline"
          data-testid="hoy-vacio-seguimiento"
          action={
            <Link href="/applications" className={LINK}>
              Ver mis postulaciones
            </Link>
          }
        >
          Nada pendiente. Te lo mostramos acá a los 7 días sin respuesta (5 después de una
          entrevista).
        </EmptyState>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {followUps.slice(0, FOLLOW_UPS_SHOWN).map((f) => (
              <li key={f.jobId} className="min-w-0 text-sm">
                <Link
                  href={`/jobs/${f.jobId}`}
                  title={f.title}
                  className={`${LINK_INLINE} flex min-h-11 min-w-0 items-center`}
                >
                  <span className="truncate">{f.title}</span>
                </Link>
                <p className="truncate text-xs text-fg-subtle">
                  {f.company} · hace {f.daysSince} {f.daysSince === 1 ? "día" : "días"}
                </p>
              </li>
            ))}
          </ul>
          <Link href="/applications#seguimiento" className={LINK}>
            {followUps.length === 1 ? "Ver la postulación" : `Ver las ${followUps.length}`}
          </Link>
        </>
      )}
    </Card>
  );
}

function AlertsCard({ data, index = 0 }: { data: HoyData; index?: number }) {
  const { coverage } = data;
  const none = ALERT_PORTALS.every((p) => coverage[p.id].status === "nunca");
  return (
    <Card id="hoy-alertas-titulo" testId="hoy-alertas" title="Tus alertas" index={index}>
      {none ? (
        <p data-testid="hoy-vacio-alertas" className="text-sm text-fg-muted">
          Todavía no recibimos ninguna alerta de empleo por email. Configurarlas te lleva 5 minutos.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {ALERT_PORTALS.map((portal) => {
            const status = PORTAL_STATUS_VIEW[coverage[portal.id].status];
            return (
              <li
                key={portal.id}
                data-testid={`hoy-alerta-${portal.id}`}
                data-status={coverage[portal.id].status}
                className="text-sm"
              >
                <span className="font-medium text-fg">{portal.name}</span>
                <p className={status.className}>
                  <span aria-hidden="true">{status.icon} </span>
                  {status.text}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/settings/asistente" className={LINK}>
        {none ? "Configurar mis alertas" : "Ver la guía"}
      </Link>
    </Card>
  );
}

function MarketCard({ data, index = 0 }: { data: HoyData; index?: number }) {
  const { careers, roles, onlySpanish } = data;
  return (
    <Card id="hoy-mercado-titulo" testId="hoy-mercado" title="Tu mercado esta semana" index={index}>
      {roles.length === 0 ? (
        <EmptyState
          variant="inline"
          data-testid="hoy-vacio-mercado"
          action={
            <Link href="/settings#puesto" className={LINK}>
              Elegí tu carrera
            </Link>
          }
        >
          Todavía no elegiste carrera.
        </EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {careers.map(({ role, market }) => {
            const label = careerLabel(role);
            const { total, writtenInSpanish } = market.volume.last7d;
            return (
              <li key={role} data-testid={`hoy-mercado-${role}`} className="text-sm">
                {total === 0 ? (
                  <p className="text-fg-muted">
                    Todavía no hay ofertas públicas de {label} en los últimos 7 días.
                  </p>
                ) : (
                  <p className="text-fg-muted">
                    <span className="font-medium text-fg">{label}:</span>{" "}
                    {total === 1 ? "1 oferta nueva" : `${total} ofertas nuevas`} en 7 días,{" "}
                    {writtenInSpanish} en español{market.english.estimated ? " (estimado)" : ""}.
                  </p>
                )}
                {onlySpanish && writtenInSpanish < 5 ? (
                  <p data-testid={`hoy-puente-idioma-${role}`} className="text-fg-muted">
                    Casi todo está en inglés. Si aceptás ofertas en los dos idiomas{" "}
                    <Link href="/settings/perfil" className={LINK_INLINE}>
                      vas a ver más
                    </Link>
                    .
                  </p>
                ) : null}
                <Link href={`/market?carrera=${role}`} className={LINK}>
                  Ver el mercado de {label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
