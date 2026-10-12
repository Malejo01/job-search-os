import { safeHttpUrl } from "@/lib/labels";
import { attributionFor } from "@job-search-os/pipeline";

/**
 * Atribución de las fuentes públicas (Get on Board, Remote OK, Jobicy, Himalayas): mención de la
 * fuente y enlace al aviso original. El enlace no lleva `nofollow` (Remote OK lo exige) y no hay
 * logos. Las fuentes propias (email, manual) no muestran nada. Server Component.
 */
export function SourceAttribution({
  sources,
}: {
  sources: readonly { kind: string; url: string | null }[];
}) {
  const seen = new Set<string>();
  const items = sources.flatMap((src) => {
    const attribution = attributionFor(src.kind);
    if (!attribution) return [];
    const url = safeHttpUrl(src.url);
    const key = `${src.kind}|${url ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, attribution, url }];
  });
  if (items.length === 0) return null;

  return (
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
  );
}
