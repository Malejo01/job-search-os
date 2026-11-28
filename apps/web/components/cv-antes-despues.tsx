"use client";

import { cvBeforeAfter } from "@job-search-os/pipeline";
import { useId, useState } from "react";
import { buttonClasses } from "@/components/ui";
import { CV_DOCUMENTO_TEXTOS } from "@/lib/textos-rediseno";

const R = CV_DOCUMENTO_TEXTOS.reescritura;

/**
 * «Antes» y «después» de una viñeta reescrita (R33-09, C-68). Muestra las dos y deja elegir; nada se aplica
 * hasta que la persona toca un botón, y por defecto queda la suya. Dice cuáles de sus palabras se conservan
 * y, si la reescritura sacó la mayoría, lo avisa. Si no cambió nada, no muestra nada que elegir. Lo usa
 * cualquier pantalla que proponga una reescritura: el texto de la propuesta ya viene verificado por
 * `verifyCvText`; acá solo se compara y se elige.
 */
export function CvAntesDespues({
  before,
  after,
  onChoose,
}: {
  before: string;
  after: string;
  /** Recibe el texto elegido: el de la persona o la reescritura. */
  onChoose: (text: string, which: "before" | "after") => void;
}) {
  const id = useId();
  const [picked, setPicked] = useState<"before" | "after" | null>(null);
  const cmp = cvBeforeAfter(before, after);
  if (!cmp.changed) return null;
  const choose = (which: "before" | "after") => {
    setPicked(which);
    onChoose(which === "before" ? cmp.before : cmp.after, which);
  };
  return (
    <div data-testid="cv-antes-despues" className="flex flex-col gap-2 text-sm text-fg">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p id={`${id}-antes`} className="font-bold text-fg-muted">
            {R.antes}
          </p>
          <p aria-labelledby={`${id}-antes`}>{cmp.before}</p>
        </div>
        <div>
          <p id={`${id}-despues`} className="font-bold text-fg-muted">
            {R.despues}
          </p>
          <p aria-labelledby={`${id}-despues`}>{cmp.after}</p>
        </div>
      </div>
      {cmp.keptWords.length > 0 ? (
        <p className="text-fg-muted">{R.conserva.replace("{lista}", cmp.keptWords.join(", "))}</p>
      ) : null}
      {!cmp.keepsOwnWords ? (
        <p role="note" className="text-warning">
          {R.pierde.replace("{lista}", cmp.droppedWords.join(", "))}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => choose("before")}
          aria-pressed={picked === "before"}
          className={buttonClasses({ variant: "secondary" })}
        >
          {R.dejarMio}
        </button>
        <button
          type="button"
          onClick={() => choose("after")}
          aria-pressed={picked === "after"}
          className={buttonClasses()}
        >
          {R.usarNueva}
        </button>
      </div>
    </div>
  );
}
