import { ALERT_PORTALS, VISIT_COOKIE, visitWindow } from "@job-search-os/pipeline";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { PORTAL_STATUS_VIEW } from "@/app/onboarding/asistente/alert-guide";
import { careerLabel } from "@/lib/career-market";
import { getHoyData, type HoyData } from "@/lib/hoy";
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

/** «Hoy» (ronda 119): lo que pasó desde tu última visita, en una pantalla. Todo con RLS, sin LLM. */
export default async function HoyPage() {
  const userId = await requireActiveUserId();
  const jar = await cookies();
  const data = await getHoyData(userId, new Date(), jar.get(VISIT_COOKIE)?.value);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-title font-semibold">Hoy</h1>
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
          className="rounded-card bg-surface-subtle px-3 py-3"
        >
          <h2 id="hoy-resumen-titulo" className="text-base font-semibold text-fg">
            En resumen
          </h2>
          <p className="text-sm text-fg-muted">{data.digest}</p>
        </section>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <NewCard data={data} index={0} />
        <FollowUpCard data={data} index={1} />
        {data.fit ? (
          <Card id="hoy-encaje-titulo" testId="hoy-encaje" title="Tu encaje" index={2}>
            <p className="text-sm text-fg-muted">{data.fit.headline}</p>
            <Link href="/encaje" className={LINK}>
              Ver tu encaje
            </Link>
          </Card>
        ) : null}
        <AlertsCard data={data} index={3} />
        <MarketCard data={data} index={4} />
      </div>
      {data.stamp ? <MarkVisit action={markVisitAction} /> : null}
    </div>
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
    // Sin fondo: las tarjetas de «Hoy» siempre dejaron ver el de la página
    <StaggerCard wide={wide} index={index}>
      <UiCard
        as="section"
        surface="none"
        data-testid={testId}
        aria-labelledby={id}
        className="flex min-w-0 flex-col gap-2"
      >
        <h2 id={id} className="text-base font-semibold text-fg">
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
