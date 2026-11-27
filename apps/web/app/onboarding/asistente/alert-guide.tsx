import {
  alertGuideForRoles,
  alertKeywordsFor,
  isAutomaticPortal,
  isRecommendedPortal,
  PORTAL_ALERT_STEPS,
  portalsForRoles,
  searchUrlFor,
  type AlertLanguage,
  type AlertPortalId,
  type PortalStatus,
} from "@job-search-os/pipeline";
import Link from "next/link";
import type { ReactNode } from "react";
import type { PortalCoverage } from "@/lib/portal-coverage";
import { catalogLabel } from "@/lib/career-names";
import { ALTA_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { cardClasses, textLinkClasses } from "@/components/ui";
import { Icon } from "@/components/ui/icons";
import { CopyButton } from "./copy-button";

const G = ALTA_TEXTOS.guia;

function careerName(key: string): string {
  try {
    return catalogLabel(key as Parameters<typeof catalogLabel>[0]);
  } catch {
    return key.replace(/_/g, " ");
  }
}

export const PORTAL_STATUS_VIEW: Record<
  PortalStatus,
  { icon: ReactNode; text: string; className: string }
> = {
  activo: {
    icon: "✅",
    text: "Activo: te llegó un aviso en los últimos 14 días",
    className: "text-success",
  },
  sin_novedad: {
    icon: "⚠️",
    text: "Sin novedad: hubo avisos, pero ninguno en los últimos 14 días",
    className: "text-warning",
  },
  nunca: {
    icon: <Icon name="pregunta" size={16} className="inline-block align-text-bottom" />,
    text: "Nunca llegó un aviso de este portal",
    className: "text-fg-subtle",
  },
};

export type AlertGuideProps = {
  roles: readonly string[];
  language: AlertLanguage;
  coverage: PortalCoverage;
  /**
   * Ofertas que le llegaron por cada portal en los últimos 30 días (R32-04). Sin esto (el onboarding no lee las
   * estadísticas) la guía no dice cuántas llegaron.
   */
  counts?: Partial<Record<AlertPortalId, number>> | undefined;
};

/**
 * «Qué alertas crear»: por portal, el estado según los mails que llegaron, las palabras sugeridas
 * para las carreras y el idioma de la persona, y un link de búsqueda cuando el portal tiene una URL
 * estable. Es texto y links que abre el navegador de la persona (ADR-004). No bloquea nada ni
 * cuenta en el % de perfil.
 */
export function AlertGuide({ roles, language, coverage, counts }: AlertGuideProps) {
  const keywords = alertKeywordsFor(roles, language);
  // R32-04: con más de una carrera, las palabras van agrupadas por carrera; con una sola queda como siempre
  const byCareer = alertGuideForRoles(roles, language);
  return (
    <section
      data-testid="alert-guide"
      aria-labelledby="alert-guide-title"
      className={cardClasses({ padding: "md", className: "flex flex-col gap-4" })}
    >
      <h2 id="alert-guide-title" className="text-base font-bold text-fg">
        Qué alertas crear
      </h2>
      {roles.length === 0 ? (
        <p data-testid="alert-guide-generic" className="text-sm text-fg-muted">
          Todavía no elegiste carrera.{" "}
          <Link href="/settings#puesto" className={textLinkClasses()}>
            Elegí tu carrera
          </Link>{" "}
          y te sugerimos las palabras para crear las alertas en cada portal.
        </p>
      ) : (
        <p className="text-sm text-fg-muted">
          Palabras para tus carreras. Creá una alerta por cada palabra en cada portal.
        </p>
      )}
      <p className="text-sm text-fg-muted" data-testid="alert-guide-aclaracion">
        {G.aclaracion}
      </p>
      {byCareer.length > 1 ? (
        <div className="flex flex-col gap-3" data-testid="alert-guide-keywords">
          {byCareer.map((guide) => (
            <section
              key={guide.career}
              data-testid={`alert-career-${guide.career}`}
              aria-label={llenarTexto(G.carrera, { carrera: careerName(guide.career) })}
              className="flex flex-col gap-1.5"
            >
              <h3 className="text-sm font-bold text-fg">
                {llenarTexto(G.carrera, { carrera: careerName(guide.career) })}
              </h3>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {guide.keywords.map((word) => (
                  <li
                    key={word}
                    className="flex items-center gap-2 rounded-pill bg-surface-muted pl-4 text-sm font-semibold"
                  >
                    <span data-testid="alert-keyword">{word}</span>
                    <CopyButton text={word} ariaLabel={`Copiar “${word}”`} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div>
            <CopyButton
              text={keywords.join(", ")}
              label="Copiar todas"
              ariaLabel="Copiar todas las palabras"
            />
          </div>
        </div>
      ) : keywords.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="alert-guide-keywords">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {keywords.map((word) => (
              <li
                key={word}
                className="flex items-center gap-2 rounded-pill bg-surface-muted pl-4 text-sm font-semibold"
              >
                <span data-testid="alert-keyword">{word}</span>
                <CopyButton text={word} ariaLabel={`Copiar “${word}”`} />
              </li>
            ))}
          </ul>
          <CopyButton
            text={keywords.join(", ")}
            label="Copiar todas"
            ariaLabel="Copiar todas las palabras"
          />
        </div>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {portalsForRoles(roles).map((portal) => {
          const automatic = isAutomaticPortal(portal.id);
          const status = PORTAL_STATUS_VIEW[coverage[portal.id].status];
          const url = searchUrlFor(portal.id, keywords);
          return (
            <li
              key={portal.id}
              data-testid={`alert-portal-${portal.id}`}
              data-status={automatic ? coverage[portal.id].status : "manual"}
              className="flex flex-col gap-1 text-sm"
            >
              <h3 className="font-bold text-fg">{portal.name}</h3>
              {automatic ? (
                <>
                  <p className={status.className}>
                    <span aria-hidden="true">{status.icon} </span>
                    <span data-testid={`alert-portal-${portal.id}-status`}>{status.text}</span>
                  </p>
                  <p className="text-fg-muted">
                    <strong className="font-semibold text-fg">Automático:</strong> reenviá cada mail
                    a tu dirección y lo leemos solo.
                  </p>
                </>
              ) : (
                <p className="text-fg-muted" data-testid={`alert-portal-${portal.id}-manual`}>
                  <strong className="font-semibold text-fg">Pegá el aviso:</strong> todavía no
                  leemos los mails de {portal.name}. Cuando veas una oferta que te interese,{" "}
                  <Link href="/jobs/new" className={textLinkClasses()}>
                    pegala acá
                  </Link>
                  .
                </p>
              )}
              <p className="text-fg-muted">{portal.howTo}</p>
              {counts && (automatic || (counts[portal.id] ?? 0) > 0) ? (
                <p className="text-fg-muted" data-testid={`alert-portal-${portal.id}-count`}>
                  {llenarTexto(
                    (counts[portal.id] ?? 0) === 0
                      ? G.llegadaNinguna
                      : counts[portal.id] === 1
                        ? G.llegadaUna
                        : G.llegadas,
                    { n: counts[portal.id] ?? 0, portal: portal.name },
                  )}
                </p>
              ) : null}
              <details
                data-testid={`alert-steps-${portal.id}`}
                className="rounded-control bg-surface-subtle px-3 py-1"
              >
                <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
                  {llenarTexto(G.pasoAPaso, { portal: portal.name })}
                </summary>
                <ol className="m-0 flex list-decimal flex-col gap-1.5 py-2 pl-5 text-fg-muted">
                  {PORTAL_ALERT_STEPS[portal.id].steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="pb-2 text-fg-subtle">
                  {G.recibir[PORTAL_ALERT_STEPS[portal.id].delivery]}
                </p>
              </details>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`alert-portal-${portal.id}-link`}
                  className={textLinkClasses({ block: true })}
                >
                  Abrir una búsqueda de ejemplo en {portal.name}
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                  <span aria-hidden="true">&nbsp;↗</span>
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
      {isRecommendedPortal("computrabajo") ? null : (
        <p data-testid="alert-computrabajo-nota" className="text-sm text-fg-muted">
          Computrabajo: todavía no lo recomendamos, porque aún no leemos sus mails. Si encontrás una
          oferta ahí, pegala.
        </p>
      )}
      <p className="text-sm text-fg-subtle">
        El estado se arma con los avisos que ya leemos solos. De los portales donde hay que pegar el
        aviso no podemos decir si te llegaron mails.
      </p>
      {counts ? <p className="text-sm text-fg-subtle">{G.cuales}</p> : null}
    </section>
  );
}
