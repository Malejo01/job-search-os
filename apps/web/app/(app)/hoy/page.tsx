import { ALERT_PORTALS, VISIT_COOKIE, visitWindow } from "@job-search-os/pipeline";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { PORTAL_STATUS_VIEW } from "@/app/onboarding/asistente/alert-guide";
import { careerLabel } from "@/lib/career-market";
import { getHoyData, type HoyData } from "@/lib/hoy";
import { requireActiveUserId } from "@/lib/session";
import { MarkVisit } from "./mark-visit";
import { NewJobRow } from "./new-job-row";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hoy" };

const VISIT_MAX_AGE = 60 * 60 * 24 * 365;
const SHOWN = 5;
const FOLLOW_UPS_SHOWN = 3;

const CARD = "flex min-w-0 flex-col gap-2 rounded-md border border-zinc-200 px-3 py-3";
const LINK =
  "inline-flex min-h-11 w-fit items-center font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900";
const LINK_INLINE =
  "font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900";

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
        <h1 className="text-xl font-semibold">Hoy</h1>
        <p data-testid="hoy-visita" className="text-xs text-zinc-600">
          {data.since
            ? `Tu última visita: ${formatDate(data.since, data.timeZone)}`
            : "Primera vez por acá"}
        </p>
      </div>
      {data.digest ? (
        <section
          data-testid="hoy-resumen"
          aria-labelledby="hoy-resumen-titulo"
          className="rounded-md bg-zinc-50 px-3 py-3"
        >
          <h2 id="hoy-resumen-titulo" className="text-base font-semibold text-zinc-900">
            En resumen
          </h2>
          <p className="text-sm text-zinc-700">{data.digest}</p>
        </section>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <NewCard data={data} />
        <FollowUpCard data={data} />
        {data.fit ? (
          <Card id="hoy-encaje-titulo" testId="hoy-encaje" title="Tu encaje">
            <p className="text-sm text-zinc-700">{data.fit.headline}</p>
            <Link href="/encaje" className={LINK}>
              Ver tu encaje
            </Link>
          </Card>
        ) : null}
        <AlertsCard data={data} />
        <MarketCard data={data} />
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
  children,
}: {
  id: string;
  testId: string;
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      aria-labelledby={id}
      className={`${CARD} ${wide ? "sm:col-span-2" : ""}`}
    >
      <h2 id={id} className="text-base font-semibold text-zinc-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

function NewCard({ data }: { data: HoyData }) {
  const { jobs, since, empty, roles } = data;
  const title = since ? "Lo nuevo para vos" : "Tus mejores ofertas de la semana";
  return (
    <Card id="hoy-nuevo-titulo" testId="hoy-nuevo" title={title} wide>
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
        <div data-testid="hoy-vacio-sin-ofertas" className="flex flex-col gap-1 text-sm">
          <p className="text-zinc-700">Todavía estamos leyendo ofertas para vos.</p>
          {roles.length === 0 ? (
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
          )}
        </div>
      ) : empty && empty.counts.porEvaluar > 0 ? (
        <div data-testid="hoy-vacio-en-cola" className="flex flex-col gap-1 text-sm">
          <p className="text-zinc-700">
            {empty.counts.porEvaluar === 1
              ? "1 oferta en cola, volvé en un rato."
              : `${empty.counts.porEvaluar} ofertas en cola, volvé en un rato.`}
          </p>
          <Link href="/jobs?estado=prefiltrada" className={LINK}>
            Ver las que esperan
          </Link>
        </div>
      ) : (
        <div data-testid="hoy-vacio-nada-nuevo" className="flex flex-col gap-1 text-sm">
          <p className="text-zinc-700">
            {since
              ? `Nada nuevo desde tu última visita (${formatDate(since, data.timeZone)}).`
              : "Nada nuevo en la última semana."}
          </p>
          <Link href="/jobs?estado=todas" className={LINK}>
            Ver todas las ofertas
          </Link>
        </div>
      )}
    </Card>
  );
}

/**
 * «Para hacer seguimiento» (C-9, diseño de la 119 §2): las tres primeras y el link a la lista. Sin
 * botones: las acciones viven en /applications.
 */
function FollowUpCard({ data }: { data: HoyData }) {
  const { followUps } = data;
  return (
    <Card id="hoy-seguimiento-titulo" testId="hoy-seguimiento" title="Para hacer seguimiento">
      {followUps.length === 0 ? (
        <p data-testid="hoy-vacio-seguimiento" className="text-sm text-zinc-700">
          Nada pendiente. Te avisamos a los 7 días sin respuesta (5 después de una entrevista).
        </p>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {followUps.slice(0, FOLLOW_UPS_SHOWN).map((f) => (
              <li key={f.jobId} className="min-w-0 text-sm">
                <Link href={`/jobs/${f.jobId}`} className={`${LINK_INLINE} block truncate`}>
                  {f.title}
                </Link>
                <p className="truncate text-xs text-zinc-600">
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

function AlertsCard({ data }: { data: HoyData }) {
  const { coverage } = data;
  const none = ALERT_PORTALS.every((p) => coverage[p.id].status === "nunca");
  return (
    <Card id="hoy-alertas-titulo" testId="hoy-alertas" title="Tus alertas">
      {none ? (
        <p data-testid="hoy-vacio-alertas" className="text-sm text-zinc-700">
          Todavía no llega ningún aviso. Configurá tus alertas: te lleva 5 minutos.
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
                <span className="font-medium text-zinc-900">{portal.name}</span>
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

function MarketCard({ data }: { data: HoyData }) {
  const { careers, roles, onlySpanish } = data;
  return (
    <Card id="hoy-mercado-titulo" testId="hoy-mercado" title="Tu mercado esta semana">
      {roles.length === 0 ? (
        <div data-testid="hoy-vacio-mercado" className="flex flex-col gap-1 text-sm">
          <p className="text-zinc-700">Todavía no elegiste carrera.</p>
          <Link href="/settings#puesto" className={LINK}>
            Elegí tu carrera
          </Link>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {careers.map(({ role, market }) => {
            const label = careerLabel(role);
            const { total, writtenInSpanish } = market.volume.last7d;
            return (
              <li key={role} data-testid={`hoy-mercado-${role}`} className="text-sm">
                {total === 0 ? (
                  <p className="text-zinc-700">Todavía no hay ofertas públicas de {label}.</p>
                ) : (
                  <p className="text-zinc-700">
                    <span className="font-medium text-zinc-900">{label}:</span>{" "}
                    {total === 1 ? "1 oferta nueva" : `${total} ofertas nuevas`} en 7 días,{" "}
                    {writtenInSpanish} en español{market.english.estimated ? " (estimado)" : ""}.
                  </p>
                )}
                {onlySpanish && writtenInSpanish < 5 ? (
                  <p data-testid={`hoy-puente-idioma-${role}`} className="text-zinc-700">
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
