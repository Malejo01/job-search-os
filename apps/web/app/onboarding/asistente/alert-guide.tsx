import {
  ALERT_PORTALS,
  alertKeywordsFor,
  searchUrlFor,
  type AlertLanguage,
  type PortalStatus,
} from "@job-search-os/pipeline";
import Link from "next/link";
import type { PortalCoverage } from "@/lib/portal-coverage";
import { CopyButton } from "./copy-button";

export const PORTAL_STATUS_VIEW: Record<
  PortalStatus,
  { icon: string; text: string; className: string }
> = {
  activo: {
    icon: "✅",
    text: "Activo: te llegó un aviso en los últimos 14 días",
    className: "text-green-800",
  },
  sin_novedad: {
    icon: "⚠️",
    text: "Sin novedad: hubo avisos, pero ninguno en los últimos 14 días",
    className: "text-amber-900",
  },
  nunca: { icon: "⬜", text: "Nunca llegó un aviso de este portal", className: "text-zinc-600" },
};

export type AlertGuideProps = {
  roles: readonly string[];
  language: AlertLanguage;
  coverage: PortalCoverage;
};

/**
 * «Qué alertas crear»: por portal, el estado según los mails que llegaron, las palabras sugeridas
 * para las carreras y el idioma de la persona, y un link de búsqueda cuando el portal tiene una URL
 * estable. Es texto y links que abre el navegador de la persona (ADR-004). No bloquea nada ni
 * cuenta en el % de perfil.
 */
export function AlertGuide({ roles, language, coverage }: AlertGuideProps) {
  const keywords = alertKeywordsFor(roles, language);
  return (
    <section
      data-testid="alert-guide"
      aria-labelledby="alert-guide-title"
      className="flex flex-col gap-3 rounded-md border border-zinc-200 px-3 py-3"
    >
      <h2 id="alert-guide-title" className="text-base font-semibold text-zinc-900">
        Qué alertas crear
      </h2>
      {roles.length === 0 ? (
        <p data-testid="alert-guide-generic" className="text-sm text-zinc-700">
          Todavía no elegiste carrera, así que son palabras generales de tecnología.{" "}
          <Link href="/settings#puesto" className="underline">
            Elegí tu carrera
          </Link>{" "}
          para ver las tuyas. Creá una alerta por cada palabra en cada portal.
        </p>
      ) : (
        <p className="text-sm text-zinc-700">
          Palabras para tus carreras. Creá una alerta por cada palabra en cada portal.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2" data-testid="alert-guide-keywords">
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {keywords.map((word) => (
            <li key={word} className="flex items-center gap-2 rounded-md bg-zinc-100 pl-3 text-sm">
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
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {ALERT_PORTALS.map((portal) => {
          const status = PORTAL_STATUS_VIEW[coverage[portal.id].status];
          const url = searchUrlFor(portal.id, keywords);
          return (
            <li
              key={portal.id}
              data-testid={`alert-portal-${portal.id}`}
              data-status={coverage[portal.id].status}
              className="flex flex-col gap-1 text-sm"
            >
              <h3 className="font-medium text-zinc-900">{portal.name}</h3>
              <p className={status.className}>
                <span aria-hidden="true">{status.icon} </span>
                <span data-testid={`alert-portal-${portal.id}-status`}>{status.text}</span>
              </p>
              <p className="text-zinc-700">{portal.howTo}</p>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`alert-portal-${portal.id}-link`}
                  className="inline-flex min-h-11 w-fit items-center underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
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
      <p className="text-sm text-zinc-600">
        El estado se arma con los avisos que ya leemos: si un portal todavía no tiene lector, puede
        decir “nunca” aunque sus emails lleguen a tu bandeja.
      </p>
    </section>
  );
}
