import { ALERT_PORTALS, VISIT_COOKIE } from "@job-search-os/pipeline";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { PORTAL_STATUS_VIEW } from "@/app/onboarding/asistente/alert-guide";
import { careerLabel } from "@/lib/career-market";
import { getHoyData, type HoyData } from "@/lib/hoy";
import { requireUserId } from "@/lib/session";
import { MarkVisit } from "./mark-visit";
import { NewJobRow } from "./new-job-row";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hoy" };

const VISIT_MAX_AGE = 60 * 60 * 24 * 365;
/** Formato exacto del valor de la cookie: `${uuid}.${anterior}.${actual}` (epoch en segundos). */
const STAMP_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\d{1,12}\.\d{1,12}$/;
const SHOWN = 5;

const CARD = "flex min-w-0 flex-col gap-2 rounded-md border border-zinc-200 px-3 py-3";
const LINK =
  "inline-flex min-h-11 w-fit items-center font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900";

/** Guarda la marca de visita. Valida el formato y que el usuario del valor sea el de la sesión. */
async function markVisitAction(stamp: string): Promise<void> {
  "use server";
  const userId = await requireUserId();
  if (typeof stamp !== "string" || !STAMP_FORMAT.test(stamp)) return;
  if (!stamp.startsWith(`${userId}.`)) return;
  const jar = await cookies();
  jar.set(VISIT_COOKIE, stamp, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VISIT_MAX_AGE,
  });
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "long",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(d);
}

/** «Hoy» (ronda 119): lo que pasó desde tu última visita, en una pantalla. Todo con RLS, sin LLM. */
export default async function HoyPage() {
  const userId = await requireUserId();
  const jar = await cookies();
  const data = await getHoyData(userId, new Date(), jar.get(VISIT_COOKIE)?.value);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold">Hoy</h1>
        <p data-testid="hoy-visita" className="text-xs text-zinc-600">
          {data.since ? `Tu última visita: ${formatDate(data.since)}` : "Primera vez por acá"}
        </p>
      </div>
      {/* Las tarjetas van en este grid; la de seguimiento se suma entre «Lo nuevo» y «Alertas» */}
      <div className="grid gap-3 sm:grid-cols-2">
        <NewCard data={data} />
        <AlertsCard data={data} />
        <MarketCard data={data} />
      </div>
      {data.stamp ? <MarkVisit stamp={data.stamp} action={markVisitAction} /> : null}
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
            {jobs.length === 1 ? "Ver la oferta" : `Ver las ${jobs.length}`}
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
              ? `Nada nuevo desde tu última visita (${formatDate(since)}).`
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
  const { careers, roles } = data;
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
