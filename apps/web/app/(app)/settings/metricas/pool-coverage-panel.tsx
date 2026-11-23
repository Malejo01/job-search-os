import {
  createLogger,
  readPoolMailboxActivity,
  safeDbError,
  type PoolMailboxActivity,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  BETA_LAUNCH_ROLE_KEYS,
  POOL_COVERAGE_LONG_DAYS,
  POOL_COVERAGE_LOW_ACTIVE_30D,
  POOL_COVERAGE_SHORT_DAYS,
  isRoleKey,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { careerLabel } from "@/lib/career-market";
import { SOURCE_LABELS } from "@/lib/labels";
import type { PoolCoverageResult } from "@/lib/pool-coverage";

const th = "pb-1 font-normal";
const thNum = "pb-1 text-right font-normal";
const td = "py-1 text-right tabular-nums";

/** `computrabajo_alerts` no está en `SOURCE_LABELS`: las ofertas que entran por las casillas del pool. */
const sourceLabel = (kind: string) =>
  kind === "computrabajo_alerts" ? "Computrabajo (alertas)" : (SOURCE_LABELS[kind] ?? kind);

const WHEN = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});
const when = (d: Date | null) => (d ? WHEN.format(d) : "Nunca");

/**
 * Casillas del pool (R19-04): estado del interruptor del lector y fecha del último email por carrera. Solo
 * fechas y conteos, sin remitentes ni textos. Se lee con la conexión de servicio (la cola del pool no tiene
 * dueño: la política por persona no la muestra), con `statement_timeout` de 3 s. Solo se renderiza para admins:
 * la página la monta únicamente cuando `getPoolCoverage` dio `ok`.
 */
export async function PoolMailboxPanel({ userId }: { userId: string }) {
  let activity: PoolMailboxActivity | null = null;
  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  try {
    activity = await db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '3s'`);
      return readPoolMailboxActivity(tx as unknown as typeof db, BETA_LAUNCH_ROLE_KEYS);
    });
  } catch (e) {
    createLogger({ user_id: userId, task: "pool_mailbox_panel" }).error(
      { err: safeDbError(e) },
      "casillas del pool: no se pudo leer",
    );
  } finally {
    await close();
  }
  if (!activity) {
    return (
      <p role="status" className="rounded-card bg-surface p-4 text-sm">
        Casillas del pool: no se pudieron leer los datos.
      </p>
    );
  }
  return (
    <section
      aria-labelledby="casillas-pool"
      className="flex flex-col gap-3 rounded-card bg-surface p-4"
      data-testid="casillas-pool"
    >
      <h2 id="casillas-pool" className="font-medium">
        Casillas del pool
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fg-muted">Casillas</dt>
        <dd data-testid="casillas-estado" className="font-semibold text-fg">
          {activity.mailboxesOn ? "Prendidas" : "Apagadas"}
        </dd>
        <dt className="text-fg-muted">Lector de Computrabajo</dt>
        <dd
          data-testid="casillas-lector"
          data-on={activity.readerOn ? "true" : "false"}
          className="font-semibold text-fg"
        >
          {activity.readerOn ? "Prendido" : "Apagado"}
        </dd>
        <dt className="text-fg-muted">Último email en la cola</dt>
        <dd data-testid="casillas-ultimo-cola" className="text-fg tabular-nums">
          {when(activity.lastQueueEmailAt)}
        </dd>
      </dl>
      <table className="w-full text-sm">
        <caption className="sr-only">Último aviso recibido por email, por carrera</caption>
        <thead>
          <tr className="text-left text-xs text-fg-subtle">
            <th scope="col" className={th}>
              Carrera
            </th>
            <th scope="col" className={thNum}>
              Avisos
            </th>
            <th scope="col" className={thNum}>
              Último
            </th>
            <th scope="col" className={thNum}>
              Gmail
            </th>
          </tr>
        </thead>
        <tbody>
          {activity.lastAlertByRole.map((r) => (
            <tr key={r.role} data-testid="casillas-carrera" className="border-t border-line">
              <th scope="row" className="py-1 pr-3 text-left font-normal text-fg-muted">
                {isRoleKey(r.role) ? careerLabel(r.role) : r.role}
              </th>
              <td className={td}>{r.offers}</td>
              <td className={td}>{when(r.lastAt)}</td>
              <td className={td}>
                {/* Descarga: no es una página, no se precarga ni se navega con el router */}
                <a
                  href={`/settings/metricas/filtros-pool?carrera=${encodeURIComponent(r.role)}`}
                  download
                  className="font-semibold text-link underline"
                >
                  Filtro
                  <span className="sr-only">
                    {" "}
                    de Gmail de {isRoleKey(r.role) ? careerLabel(r.role) : r.role}
                  </span>
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-fg-subtle break-words">
        El email no guarda a qué casilla llegó: la fecha por carrera es la última vez que un email
        listó un aviso de esa carrera (la carrera es la de la casilla). «Último email en la cola» es
        el más reciente que quedó sin leer en la cola manual, de todas las casillas. «Filtro»
        descarga el XML de Gmail de esa carrera (<code>from:computrabajo.com</code>, nunca todo el
        correo): se le pasa a la persona de esa carrera, un archivo por persona. Pasos en{" "}
        <code>docs/beta/guia-alertas-amigos.md</code>.
      </p>
    </section>
  );
}

/**
 * Cobertura del pool por carrera (R16-4): ofertas activas por carrera y fuente en 7 y 30 días, y cuántas están
 * en español, para ver qué carrera tiene poco pool antes de invitar gente. Solo agregados del pool global: ningún
 * aviso ni dato de personas. Server Component sin estado; pensado para 390 px (una tarjeta por carrera, tablas de
 * tres columnas, sin scroll horizontal).
 */
export function PoolCoveragePanel({ result }: { result: PoolCoverageResult }) {
  if (!result.ok) {
    return (
      <p role="status" className="rounded-card bg-surface p-4 text-sm">
        Cobertura del pool: no se pudieron leer las ofertas.
      </p>
    );
  }
  return (
    <section
      aria-labelledby="cobertura-pool"
      className="flex flex-col gap-3 rounded-card bg-surface p-4"
      data-testid="cobertura-pool"
    >
      <div className="flex flex-col gap-1">
        <h2 id="cobertura-pool" className="font-medium">
          Cobertura del pool por carrera
        </h2>
        <p className="text-xs text-fg-subtle break-words">
          <strong>Activa</strong> = oferta del pool, sin copias, que alguna fuente seguía listando
          en los últimos {POOL_COVERAGE_SHORT_DAYS} o {POOL_COVERAGE_LONG_DAYS} días (la última vez
          que se vio, no cuándo se publicó). Una oferta con varias carreras cuenta una vez en cada
          una: las carreras no se pueden sumar entre sí. <strong>En español</strong> usa el idioma
          del aviso (calculado, o el de la fuente si falta); sin dato no cuenta, así que es un piso.
          «Poco pool» = menos de {POOL_COVERAGE_LOW_ACTIVE_30D} activas en {POOL_COVERAGE_LONG_DAYS}{" "}
          días.
        </p>
      </div>
      <ul className="flex flex-col gap-4">
        {result.rows.map((r) => (
          <li
            key={r.role}
            data-testid="cobertura-carrera"
            data-role={r.role}
            data-low={r.low ? "true" : "false"}
            className="border-t border-line pt-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-fg">
                {isRoleKey(r.role) ? careerLabel(r.role) : r.role}
              </h3>
              {r.low ? (
                <span className="rounded-badge border border-line px-2 py-0.5 text-xs font-medium text-fg">
                  Poco pool
                </span>
              ) : null}
            </div>
            <table className="mt-2 w-full text-sm">
              <caption className="sr-only">
                {isRoleKey(r.role) ? careerLabel(r.role) : r.role}: ofertas activas por fuente
              </caption>
              <thead>
                <tr className="text-left text-xs text-fg-subtle">
                  <th scope="col" className={th}>
                    Fuente
                  </th>
                  <th scope="col" className={thNum}>
                    {POOL_COVERAGE_SHORT_DAYS} días
                  </th>
                  <th scope="col" className={thNum}>
                    {POOL_COVERAGE_LONG_DAYS} días
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.sources.length === 0 ? (
                  <tr className="border-t border-line">
                    <td colSpan={3} className="py-1 text-fg-muted">
                      Sin ofertas activas.
                    </td>
                  </tr>
                ) : (
                  r.sources.map((s) => (
                    <tr key={s.source} className="border-t border-line">
                      <th
                        scope="row"
                        className="py-1 pr-3 text-left font-normal break-words text-fg-muted"
                      >
                        {sourceLabel(s.source)}
                      </th>
                      <td className={td}>{s.active7}</td>
                      <td className={td}>{s.active30}</td>
                    </tr>
                  ))
                )}
                <tr className="border-t border-line font-semibold">
                  <th scope="row" className="py-1 pr-3 text-left font-semibold text-fg">
                    Total
                  </th>
                  <td className={td} data-testid="cobertura-total-7">
                    {r.active7}
                  </td>
                  <td className={td} data-testid="cobertura-total-30">
                    {r.active30}
                  </td>
                </tr>
                <tr className="border-t border-line">
                  <th scope="row" className="py-1 pr-3 text-left font-normal text-fg-muted">
                    En español
                  </th>
                  <td className={td} data-testid="cobertura-es-7">
                    {r.spanish7}
                  </td>
                  <td className={td} data-testid="cobertura-es-30">
                    {r.spanish30}
                  </td>
                </tr>
              </tbody>
            </table>
          </li>
        ))}
      </ul>
    </section>
  );
}
