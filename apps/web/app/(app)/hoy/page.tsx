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
import { listPendingJd } from "@/lib/pending-jd";
import { Card as UiCard, cardClasses, EmptyState, textLinkClasses } from "@/components/ui";
import { requireActiveUserId } from "@/lib/session";
import { Illustration } from "@/components/brand/illustration";
import { MarkVisit } from "./mark-visit";
import { NewJobRow } from "./new-job-row";
import { StartHere } from "./start-here";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hoy" };

const VISIT_MAX_AGE = 60 * 60 * 24 * 365;
/** «También para vos»: hasta dos más, como la referencia. */
const ALSO_SHOWN = 2;
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

/**
 * «Hoy» (ronda 119; C10-6, copia de hoy-pc.png y hoy-cel.png con las medidas de
 * `S2-hoy-ofertas.html`). La cabecera índigo curva sigue a la barra (es una sola pieza) con el
 * saludo y la ilustración apoyada en el borde de abajo. Debajo, en la computadora, dos columnas:
 * «Para hacer hoy» (400 px) y «La mejor de hoy» con «También para vos»; en el celular, una sola
 * columna con la mejor. El resto de lo que calculaba Hoy (resumen, seguimiento, encaje, alertas,
 * mercado y la semana) sigue en «Más de tu semana», cerrado, debajo de la primera pantalla. Todo
 * con RLS y sin LLM.
 *
 * `data-ancho="completo"`: el layout le saca al `main` su ancho y su margen (la cabecera va de
 * borde a borde, como en la referencia).
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
    <div data-ancho="completo" className="flex flex-col pb-10">
      {/* Cabecera índigo curva (decisión 6): continúa la barra de arriba, sin costura. La onda va
          acá, en el saludo: es un momento tranquilo (decisión 14) */}
      {/* La primera pantalla es la de la referencia: «Más de tu semana» y el pie empiezan debajo
          (en el celular, descontando la barra de arriba y las pestañas) */}
      <div className="flex min-h-[calc(100svh-9rem)] flex-col sm:min-h-[calc(100svh-4rem)]">
        <section
          data-testid="hoy-cabecera"
          aria-labelledby="hoy-saludo"
          className="rounded-b-[40px] bg-ink text-on-ink sm:rounded-b-[56px]"
        >
          <div className="mx-auto mt-2.5 flex max-w-[1280px] items-end gap-1.5 px-5 sm:mt-0 sm:gap-6 sm:px-12">
            <div className="min-w-0 flex-[1_1_55%] pb-[26px] sm:flex-auto sm:pb-14">
              <h1
                id="hoy-saludo"
                className="text-[28px] leading-[1.06] font-extrabold text-on-ink sm:text-5xl sm:leading-[1.05] sm:tracking-[-1.4px]"
              >
                ¡{greeting(now, data.timeZone)}
                {name ? `, ${name}` : ""}!
              </h1>
              <p
                data-testid="hoy-titular"
                className="mt-1.5 text-sm leading-[1.45] font-medium text-on-ink-muted sm:mt-3 sm:text-[19px] sm:leading-[1.5]"
              >
                {highScore > 0
                  ? `Hoy hay ${highScore === 1 ? "1 oferta que te puede quedar pintada" : `${highScore} ofertas que te pueden quedar pintadas`}.`
                  : data.jobs.length > 0
                    ? "Hay ofertas nuevas evaluadas, ninguna con puntaje alto."
                    : "No hay ofertas nuevas evaluadas para mirar."}
              </p>
            </div>
            {/* Ilustración de Hoy (C9-12): sobre el índigo, sin recuadro, apoyada en el borde */}
            <Illustration escena="hoy" priority className="w-40 sm:w-[400px]" />
          </div>
        </section>

        <div className="mx-auto grid w-full max-w-[1280px] items-start gap-3 px-3.5 pt-4 sm:gap-7 sm:px-12 sm:pt-7 lg:grid-cols-[400px_1fr]">
          {/* «Para hacer hoy» (C8-5 y C10-6): los pasos de quien empieza y lo pendiente de sus datos */}
          <StartHere userId={userId} pendingJd={pending.length} followUps={data.followUps.length} />
          <NewCard data={data} />
        </div>
      </div>
      <details
        data-testid="hoy-mas"
        className="group mx-auto mt-8 w-full max-w-[1280px] px-3.5 sm:mt-10 sm:px-12"
      >
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-bold text-brand-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
          Más de tu semana
        </summary>
        <div className="mt-3 flex flex-col gap-5">
          <p data-testid="hoy-visita" className="text-sm text-fg-subtle">
            {data.since
              ? `Tu última visita: ${formatDate(data.since, data.timeZone)}`
              : "Primera vez por acá"}
          </p>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FollowUpCard data={data} />
            {data.fit ? (
              <Card id="hoy-encaje-titulo" testId="hoy-encaje" title="Tu encaje">
                <p className="text-sm text-fg-muted">{data.fit.headline}</p>
                <Link href="/encaje" className={LINK}>
                  Ver tu encaje
                </Link>
              </Card>
            ) : null}
            <AlertsCard data={data} />
            <MarketCard data={data} />
            <WeekCard newCount={data.jobs.length} week={week} />
          </div>
          <p className="text-xs text-fg-subtle">
            Vos decidís. La postulación la hacés vos en el sitio del aviso: nunca postulamos por
            vos.
          </p>
        </div>
      </details>
      {data.stamp ? <MarkVisit action={markVisitAction} /> : null}
    </div>
  );
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
      className={cardClasses({ level: "list", padding: "md", className: "flex flex-col gap-3" })}
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
              className={`h-full rounded-pill ${week.revisadas === week.total ? "bg-success-strong" : "bg-brand-text"}`}
              style={{ width: `${Math.round((week.revisadas / week.total) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Tarjeta de sección de Hoy: blanca sobre el lavanda, sin animación de entrada (C9-10: nada entra
 * escalonado). `bare` deja la sección sin fondo, para la lista de ofertas que trae sus tarjetas.
 * `index` queda por compatibilidad con quien lo pasa; ya no hace nada.
 */
function Card({
  id,
  testId,
  title,
  wide,
  bare = false,
  children,
}: {
  id: string;
  testId: string;
  title: string;
  wide?: boolean;
  bare?: boolean;
  index?: number;
  children: ReactNode;
}) {
  return (
    <UiCard
      as="section"
      level={bare ? "flat" : "list"}
      padding={bare ? "none" : "md"}
      surface={bare ? "none" : "surface"}
      data-testid={testId}
      aria-labelledby={id}
      className={`flex min-w-0 flex-col gap-3 ${bare ? "border-0" : ""} ${wide ? "sm:col-span-2" : ""}`}
    >
      <h2
        id={id}
        className={bare ? "text-heading font-bold text-fg" : "text-base font-bold text-fg"}
      >
        {title}
      </h2>
      {children}
    </UiCard>
  );
}

/**
 * Las ofertas de Hoy (C10-6): «La mejor de hoy» en la tarjeta destacada y, debajo, «También para
 * vos» con las otras que te pueden quedar pintadas (7 o más, hasta dos; solo en la computadora,
 * como la referencia). Sin ofertas, el vacío que corresponde y el paso que sigue.
 */
function NewCard({ data }: { data: HoyData }) {
  const { jobs, since, empty, roles } = data;
  const [best, ...rest] = jobs;
  const also = rest.filter((j) => j.score !== null && j.score >= 7).slice(0, ALSO_SHOWN);
  if (best) {
    return (
      <section
        data-testid="hoy-nuevo"
        aria-labelledby="hoy-nuevo-titulo"
        className="flex min-w-0 flex-col gap-3 sm:gap-3.5"
      >
        <h2
          id="hoy-nuevo-titulo"
          className="pl-1 font-sans text-xs font-extrabold text-brand-text sm:pl-0 sm:text-[13px]"
        >
          La mejor de hoy
        </h2>
        <ul className="m-0 list-none p-0">
          <NewJobRow job={best} featured now={new Date()} />
        </ul>
        {also.length ? (
          <div className="hidden flex-col gap-3.5 sm:flex">
            <h3 className="mt-1.5 font-sans text-[13px] font-extrabold text-brand-text">
              También para vos
            </h3>
            <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
              {also.map((job) => (
                <NewJobRow key={job.id} job={job} now={new Date()} />
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    );
  }
  const title = since ? "Lo nuevo para vos" : "Tus mejores ofertas de la semana";
  return (
    <Card id="hoy-nuevo-titulo" testId="hoy-nuevo" title={title}>
      {empty && empty.counts.total === 0 ? (
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
