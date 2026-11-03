import {
  scoreAriaLabel,
  scoreSentence,
  scoreState,
  type ScoreState,
} from "@job-search-os/pipeline";
import { formatScoreNumber } from "@/lib/labels";
import { cx } from "./cx";

/**
 * Score de 0 a 10 (C7-4, manual M8). Una sola caja para /jobs, el detalle, /hoy y la demo.
 *
 * La lógica (estado, `aria-label` y frase) vive en `@job-search-os/pipeline` (score-display.ts),
 * con tests. Estados:
 * - `alto` (7 o más), `medio` (5 a 6,9) y `bajo`: relleno suave del estado con un borde interior;
 * - `estimacion`: la estimación previa por reglas, con borde punteado y «estim.»;
 * - `pendiente`: en cola para evaluar, con «…» y borde celeste;
 * - `sin`: sin evaluar ni estimar, «–».
 *
 * Es una imagen con nombre para el lector de pantalla: «puntaje 8.5», «estimación previa 6», «en
 * cola», «sin evaluar». Los e2e leen ese formato (`[aria-label^="puntaje "]`): no cambiarlo.
 */
export type ScoreSize = "sm" | "md" | "lg";

const STATES: Record<ScoreState, string> = {
  alto: "bg-success-muted text-success shadow-[inset_0_0_0_2px_var(--jso-success-line)]",
  medio: "bg-warning-muted text-warning shadow-[inset_0_0_0_2px_var(--jso-warning-line)]",
  bajo: "bg-surface-muted text-fg-muted shadow-[inset_0_0_0_2px_var(--jso-line-strong)]",
  estimacion: "border-2 border-dashed border-line-control text-fg-muted",
  pendiente: "border-2 border-info-line text-info",
  sin: "bg-surface-subtle text-fg-subtle shadow-[inset_0_0_0_1px_var(--jso-line)]",
};

const SIZES: Record<ScoreSize, { box: string; number: string }> = {
  sm: { box: "h-10 w-10", number: "text-base" },
  md: { box: "h-[52px] w-[52px]", number: "text-xl" },
  lg: { box: "h-16 w-16", number: "text-2xl" },
};

export function ScoreBadge({
  score,
  preScore = null,
  pending = false,
  size = "md",
  title,
  as = "img",
  className,
  ...props
}: {
  score: number | null;
  preScore?: number | null;
  pending?: boolean;
  size?: ScoreSize;
  /** Ayuda al pasar el mouse (p. ej. qué es una estimación previa). */
  title?: string;
  /**
   * `img` (por defecto): una imagen con `aria-label` («puntaje 8.5»). `text`: la caja es decorativa
   * y al lado va la frase oculta («Puntaje 8.5 de 10»), que también ven los e2e como texto (/hoy).
   */
  as?: "img" | "text";
  className?: string;
} & { [key: `data-${string}`]: string | undefined }) {
  const state = scoreState({ score, preScore, pending });
  const value = state === "estimacion" ? preScore : score;
  const main =
    state === "pendiente"
      ? "…"
      : state === "sin" || value === null
        ? "–"
        : formatScoreNumber(value);
  const unit =
    state === "estimacion" ? "estim." : state === "pendiente" || state === "sin" ? "score" : "/10";
  return (
    <span
      {...(as === "img" ? { role: "img", "aria-label": scoreAriaLabel(state, value) } : {})}
      title={title}
      data-score-state={state}
      className={cx(
        "flex shrink-0 flex-col items-center justify-center rounded-control",
        SIZES[size].box,
        STATES[state],
        className,
      )}
      {...props}
    >
      {as === "text" ? <span className="sr-only">{scoreSentence(state, value)}</span> : null}
      <span
        aria-hidden={as === "text" ? true : undefined}
        className={cx(
          "font-display leading-none font-bold",
          SIZES[size].number,
          state === "pendiente" && "motion-safe:animate-pulse",
        )}
      >
        {main}
      </span>
      {size === "sm" ? null : (
        <span aria-hidden={as === "text" ? true : undefined} className="text-[10px] font-semibold">
          {unit}
        </span>
      )}
    </span>
  );
}
