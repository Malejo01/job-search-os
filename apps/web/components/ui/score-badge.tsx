import { formatScoreNumber } from "@/lib/labels";
import { cx } from "./cx";

/**
 * Score de 0 a 10 (C7-4, manual M8). Una sola caja para /jobs, el detalle, /hoy y la demo.
 *
 * Estados:
 * - `alto` (7 o más), `medio` (5 a 6,9) y `bajo`: relleno suave del estado con un borde interior;
 * - `estimacion`: la estimación previa por reglas, con borde punteado y «estim.»;
 * - `pendiente`: en cola para evaluar, con «…» y borde celeste;
 * - `sin`: sin evaluar ni estimar, «–».
 *
 * Es una imagen con nombre para el lector de pantalla: «puntaje 8.5», «estimación previa 6», «en
 * cola», «sin evaluar». Los e2e leen ese formato (`[aria-label^="puntaje "]`): no cambiarlo.
 */
export type ScoreState = "alto" | "medio" | "bajo" | "estimacion" | "pendiente" | "sin";
export type ScoreSize = "sm" | "md" | "lg";

export function scoreState({
  score,
  preScore = null,
  pending = false,
}: {
  score: number | null;
  preScore?: number | null;
  pending?: boolean;
}): ScoreState {
  if (pending) return "pendiente";
  if (score === null) return preScore === null ? "sin" : "estimacion";
  if (score >= 7) return "alto";
  if (score >= 5) return "medio";
  return "bajo";
}

const STATES: Record<ScoreState, string> = {
  alto: "bg-success-muted text-success shadow-[inset_0_0_0_2px_var(--color-success-line)]",
  medio: "bg-warning-muted text-warning shadow-[inset_0_0_0_2px_var(--color-warning-line)]",
  bajo: "bg-surface-muted text-fg-muted shadow-[inset_0_0_0_2px_var(--color-line-strong)]",
  estimacion: "border-2 border-dashed border-line-control text-fg-muted",
  pendiente: "border-2 border-info-line text-info",
  sin: "bg-surface-subtle text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]",
};

const SIZES: Record<ScoreSize, { box: string; number: string }> = {
  sm: { box: "h-10 w-10", number: "text-base" },
  md: { box: "h-[52px] w-[52px]", number: "text-xl" },
  lg: { box: "h-16 w-16", number: "text-2xl" },
};

function label(state: ScoreState, value: number | null): string {
  if (state === "pendiente") return "en cola";
  if (state === "sin") return "sin evaluar";
  if (state === "estimacion") return `estimación previa ${value}`;
  return `puntaje ${value}`;
}

export function ScoreBadge({
  score,
  preScore = null,
  pending = false,
  size = "md",
  title,
  className,
  ...props
}: {
  score: number | null;
  preScore?: number | null;
  pending?: boolean;
  size?: ScoreSize;
  /** Ayuda al pasar el mouse (p. ej. qué es una estimación previa). */
  title?: string;
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
      role="img"
      aria-label={label(state, value)}
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
      <span
        className={cx(
          "font-display leading-none font-bold",
          SIZES[size].number,
          state === "pendiente" && "motion-safe:animate-pulse",
        )}
      >
        {main}
      </span>
      {size === "sm" ? null : <span className="text-[10px] font-semibold">{unit}</span>}
    </span>
  );
}
