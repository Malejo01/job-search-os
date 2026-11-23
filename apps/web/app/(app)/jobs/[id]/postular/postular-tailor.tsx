"use client";

import { lazy, Suspense, useState } from "react";
import type { CvTailorOutput } from "@job-search-os/pipeline";
import { buttonClasses } from "@/components/ui";

// R24-04: el panel va en un chunk aparte; solo lo baja quien tiene prendido el flag.
const CvTailorPanel = lazy(() =>
  import("@/components/cv-tailor/cv-tailor-panel").then((m) => ({ default: m.CvTailorPanel })),
);

/**
 * Versión adaptada con IA dentro de «Preparar mi postulación» (R20-04b). Se monta solo si el flag está
 * prendido (lo decide la página, en el servidor). Cuando hay una propuesta ya verificada, ofrece bajar el
 * .docx: un formulario POST normal manda la propuesta a la ruta de descarga, que la vuelve a verificar
 * contra el CV de hoy y, si no sirve, cae en la versión sin IA. El navegador no guarda nada.
 */
export function PostularTailor({ jobId }: { jobId: string }) {
  const [proposal, setProposal] = useState<CvTailorOutput | null>(null);
  return (
    <div className="flex flex-col gap-3" data-testid="postular-tailor">
      <Suspense fallback={null}>
        <CvTailorPanel jobId={jobId} onResult={setProposal} />
      </Suspense>
      {proposal ? (
        <form
          method="post"
          action={`/jobs/${jobId}/postular/descargar`}
          className="flex flex-col gap-1"
        >
          <input type="hidden" name="proposal" value={JSON.stringify(proposal)} />
          <button
            type="submit"
            data-testid="descargar-cv-adaptado"
            className={`${buttonClasses({ size: "sm" })} w-fit`}
          >
            Descargar la versión adaptada (.docx)
          </button>
          <p className="text-xs text-fg-subtle">
            Se vuelve a verificar contra tu CV al descargar. Si algo no coincide, baja la versión
            sin IA.
          </p>
        </form>
      ) : null}
    </div>
  );
}
