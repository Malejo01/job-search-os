"use client";

import { CvTailorPanel } from "@/components/cv-tailor/cv-tailor-panel";

/**
 * Cuerpo de «Adaptar a esta oferta» dentro de «Preparar mi postulación» (R20-04b, R34-02). Vive aparte de
 * `PostularTailor` para que todo esto viaje en un chunk lazy (R24-04b). Las sugerencias se deciden de a una y
 * se guardan como otra versión; la descarga (PDF o DOCX, base o adaptada) está en su propia sección, que se
 * arma en el servidor. El navegador no guarda nada.
 */
export default function PostularTailorCuerpo({ jobId }: { jobId: string }) {
  return (
    <div className="flex flex-col gap-3" data-testid="postular-tailor">
      <CvTailorPanel jobId={jobId} />
    </div>
  );
}
