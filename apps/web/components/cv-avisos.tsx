import type { CvDocument } from "@job-search-os/pipeline";
import { cardClasses } from "@/components/ui";
import { CV_DOCUMENTO_TEXTOS } from "@/lib/textos-rediseno";

const C = CV_DOCUMENTO_TEXTOS.calidad;

/**
 * Avisos suaves de calidad del CV (R33-09, C-56 a C-61 y C-67): sin titular, habilidades que ninguna viñeta
 * respalda y viñetas que cuentan tareas, con preguntas guía que citan las palabras de la persona. Solo
 * orientan: no cambian el CV, no sacan ninguna habilidad y no proponen datos. Server Component; todo el
 * texto sale del modelo y React lo escapa.
 */
export function CvAvisos({ doc }: { doc: CvDocument }) {
  const notices = doc.notices ?? [];
  if (notices.length === 0) return null;
  return (
    <section
      aria-labelledby="cv-avisos"
      data-testid="cv-avisos"
      className={cardClasses({ padding: "md", className: "no-print flex flex-col gap-3" })}
    >
      <h2 id="cv-avisos" className="text-base font-bold text-fg">
        {C.titulo}
      </h2>
      <ul className="flex flex-col gap-3 text-sm text-fg">
        {notices.map((n) => {
          if (n.id === "no_headline") return <li key={n.id}>{C.sinTitular}</li>;
          if (n.id === "skills_without_evidence") {
            return (
              <li key={n.id} data-testid="cv-aviso-sin-respaldo">
                {C.sinRespaldo.replace("{lista}", n.skills.join(", "))}
              </li>
            );
          }
          return (
            <li key={n.id} data-testid="cv-aviso-tareas" className="flex flex-col gap-2">
              <span>{C.tareas}</span>
              {n.items.map((item, i) => (
                <details key={i} className="rounded-card border border-line p-3">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                    «{item.text}»
                  </summary>
                  <p className="mt-2 font-semibold">{C.preguntas}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {item.questions.map((q, j) => (
                      <li key={j}>{q}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-fg-muted">{C.soloVerdad}</p>
                </details>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
