import { safeHttpUrl } from "@/lib/labels";
import { attributionFor, findAtsLinks, WWR_PAYWALL_NOTICE } from "@job-search-os/pipeline";

const ATS_NAMES = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
  teamtailor: "Teamtailor",
} as const;

/**
 * Atribución de las fuentes públicas (Get on Board, Remote OK, Jobicy, Himalayas, We Work Remotely
 * y los sitios de empleos de las empresas): mención de la fuente y enlace al aviso original. El
 * enlace no lleva `nofollow` (Remote OK lo exige) y no hay logos. Las fuentes propias (email,
 * manual) no muestran nada. `company` es la empresa del aviso: los ATS la nombran. Server Component.
 */
export function SourceAttribution({
  sources,
  company,
  jdText,
}: {
  sources: readonly { kind: string; url: string | null }[];
  company?: string | null;
  /** La JD, para buscar el link al sitio de empleos de la empresa en los avisos de WWR. */
  jdText?: string | null;
}) {
  const seen = new Set<string>();
  const items = sources.flatMap((src) => {
    const attribution = attributionFor(src.kind, { company });
    if (!attribution) return [];
    const url = safeHttpUrl(src.url);
    const key = `${src.kind}|${url ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, attribution, url }];
  });
  if (items.length === 0) return null;

  const isWwr = sources.some((src) => src.kind === "wwr");
  const atsLinks = isWwr
    ? findAtsLinks(jdText ?? null).flatMap((l) => {
        const href = safeHttpUrl(l.url);
        return href ? [{ provider: l.provider, href }] : [];
      })
    : [];

  return (
    <div className="flex flex-col gap-1">
      <ul aria-label="Origen del aviso" className="flex flex-col gap-0.5 text-xs text-zinc-700">
        {items.map(({ key, attribution, url }) => {
          const home = safeHttpUrl(attribution.homeUrl);
          return (
            <li key={key}>
              {home ? (
                <a href={home} target="_blank" rel="noopener" className="underline">
                  {attribution.text}
                </a>
              ) : (
                attribution.text
              )}
              {url ? (
                <>
                  {" · "}
                  <a href={url} target="_blank" rel="noopener" className="text-sky-700 underline">
                    Ver el aviso original ↗
                  </a>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      {isWwr ? (
        <div className="flex flex-col gap-0.5 text-xs">
          <p className="text-amber-800">{WWR_PAYWALL_NOTICE}</p>
          {atsLinks.map(({ provider, href }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 underline"
            >
              Postular en el sitio de la empresa ({ATS_NAMES[provider]}) ↗
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
