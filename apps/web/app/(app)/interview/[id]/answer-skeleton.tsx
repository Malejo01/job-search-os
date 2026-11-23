import { INTERVIEW_CLIENTE as INTERVIEW_TEXTOS } from "@/lib/textos-interview";

const BARS = ["w-11/12", "w-4/5", "w-3/5"] as const;

/**
 * Mientras se evalúa una respuesta (R23-08): tres barras que pulsan y «Analizando tu respuesta…». El
 * pulso es CSS (`animate-pulse`), sin Framer: así esta ruta no carga la librería (R23-09). Con
 * movimiento reducido las barras quedan quietas (`motion-reduce:animate-none`); el texto va siempre.
 * Reserva la altura de la devolución para que no salte el diseño al llegar.
 */
export function AnswerSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid="interview-skeleton"
      className="flex min-h-40 flex-col gap-3 rounded-control bg-surface-muted p-4"
    >
      <p className="text-sm font-bold text-fg">{INTERVIEW_TEXTOS.analizando}</p>
      {BARS.map((width) => (
        <span
          key={width}
          aria-hidden="true"
          className={`block h-4 animate-pulse rounded-pill bg-line motion-reduce:animate-none ${width}`}
        />
      ))}
    </div>
  );
}
