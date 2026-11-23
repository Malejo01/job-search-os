import {
  ACCESO_ORIGIN_LABELS,
  buildAccesoFunnel,
  isRoleKey,
  type AccesoOrigin,
} from "@job-search-os/pipeline";
import type { AccesoFunnelResult } from "@/lib/acceso-funnel";
import { careerLabel } from "@/lib/career-market";

const HOUR = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Argentina/Buenos_Aires",
});
const PCT = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });

/** Horas que se listan: las últimas con actividad (el pico del evento entra de sobra). */
const MAX_HOURS = 24;

const th = "pb-1 font-normal";
const thNum = "pb-1 text-right font-normal";
const td = "py-1 text-right tabular-nums";

function originLabel(origin: string): string {
  return ACCESO_ORIGIN_LABELS[origin as AccesoOrigin] ?? origin;
}

/**
 * Embudo de /acceso (C8-2): visitas, formularios empezados y enviados por origen, conversión por
 * carrera elegida y por hora. Solo contadores agregados (sin emails ni personas). Los nombres de quien
 * se anotó están en Invitaciones → lista de espera.
 */
export function AccesoFunnelPanel({ result }: { result: AccesoFunnelResult }) {
  if (!result.ok) {
    const text =
      result.reason === "apagado"
        ? "Embudo de /acceso apagado. Se prende con ACCESO_FUNNEL_ENABLED=1, después de aplicar la migración 0057."
        : result.reason === "no_habilitado"
          ? "Embudo de /acceso: tu cuenta todavía no está habilitada en la base (app_admins)."
          : "Embudo de /acceso: no se pudieron leer los contadores (¿falta aplicar la migración 0057?).";
    return (
      <p role="status" className="rounded-card bg-surface p-4 text-sm">
        {text}
      </p>
    );
  }
  const funnel = buildAccesoFunnel(result.rows);
  const hours = funnel.byHour.slice(-MAX_HOURS);
  return (
    <section
      aria-labelledby="embudo-acceso"
      className="flex flex-col gap-4 rounded-card bg-surface p-4"
      data-testid="embudo-acceso"
    >
      <div className="flex flex-col gap-1">
        <h2 id="embudo-acceso" className="font-medium">
          Embudo de /acceso (30 días)
        </h2>
        <p className="text-xs text-fg-subtle">
          Visitas (una por pestaña), formularios empezados y enviados según el <code>?origen=</code>{" "}
          del link. Sin emails ni personas: solo contadores por hora.
          {funnel.peakHour ? ` Hora pico: ${HOUR.format(new Date(funnel.peakHour))}.` : ""}
        </p>
      </div>

      {funnel.byOrigin.length === 0 ? (
        <p className="text-sm text-fg-muted">Todavía no hay visitas registradas.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <caption className="mb-2 text-left font-medium">Por origen</caption>
            <thead>
              <tr className="text-left text-xs text-fg-subtle">
                <th scope="col" className={th}>
                  Origen
                </th>
                <th scope="col" className={thNum}>
                  Visitas
                </th>
                <th scope="col" className={thNum}>
                  Empezaron
                </th>
                <th scope="col" className={thNum}>
                  Enviaron
                </th>
                <th scope="col" className={thNum}>
                  Conversión
                </th>
                <th scope="col" className={thNum}>
                  Topes
                </th>
              </tr>
            </thead>
            <tbody>
              {funnel.byOrigin.map((o) => (
                <tr key={o.origin} className="border-t border-line">
                  <th scope="row" className="py-1 pr-3 text-left font-normal text-fg-muted">
                    {originLabel(o.origin)}
                  </th>
                  <td className={td}>{o.visita}</td>
                  <td className={td}>{o.empezado}</td>
                  <td className={td}>{o.enviado}</td>
                  <td className={td}>{o.visita > 0 ? PCT.format(o.conversion) : "—"}</td>
                  <td className={td}>{o.tope}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="w-full text-sm">
            <caption className="mb-2 text-left font-medium">Por carrera elegida</caption>
            <thead>
              <tr className="text-left text-xs text-fg-subtle">
                <th scope="col" className={th}>
                  Carrera
                </th>
                <th scope="col" className={thNum}>
                  La eligieron
                </th>
                <th scope="col" className={thNum}>
                  Enviaron
                </th>
                <th scope="col" className={thNum}>
                  Conversión
                </th>
              </tr>
            </thead>
            <tbody>
              {funnel.byRole.map((r) => (
                <tr key={r.role} className="border-t border-line">
                  <th scope="row" className="py-1 pr-3 text-left font-normal text-fg-muted">
                    {isRoleKey(r.role) ? careerLabel(r.role) : r.role}
                  </th>
                  <td className={td}>{r.carrera}</td>
                  <td className={td}>{r.enviado}</td>
                  <td className={td}>{r.conversion === null ? "—" : PCT.format(r.conversion)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="w-full text-sm">
            <caption className="mb-2 text-left font-medium">
              Por hora (las últimas {MAX_HOURS} con actividad)
            </caption>
            <thead>
              <tr className="text-left text-xs text-fg-subtle">
                <th scope="col" className={th}>
                  Hora
                </th>
                <th scope="col" className={thNum}>
                  Visitas
                </th>
                <th scope="col" className={thNum}>
                  Empezaron
                </th>
                <th scope="col" className={thNum}>
                  Enviaron
                </th>
                <th scope="col" className={thNum}>
                  Topes
                </th>
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr
                  key={h.hour}
                  className={`border-t border-line ${h.hour === funnel.peakHour ? "font-semibold" : ""}`}
                >
                  <th scope="row" className="py-1 pr-3 text-left font-normal text-fg-muted">
                    {HOUR.format(new Date(h.hour))}
                    {h.hour === funnel.peakHour ? " (pico)" : ""}
                  </th>
                  <td className={td}>{h.visita}</td>
                  <td className={td}>{h.empezado}</td>
                  <td className={td}>{h.enviado}</td>
                  <td className={td}>{h.tope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
