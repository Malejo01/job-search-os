import {
  scoreAriaLabel,
  scoreSentence,
  sealState,
  sealWord,
  type SealState,
} from "@job-search-os/pipeline";
import { formatScoreNumber } from "@/lib/labels";
import { cx } from "./cx";

/**
 * El sello de afinidad (C9-5, decisión 7 de C9): reemplaza a ScoreBadge en toda la app. Un
 * círculo con el número (Bricolage 800) y la palabra del nivel abajo, a la derecha de cada oferta.
 *
 * - «Muy afín» (8,5 a 10): lima con borde índigo, inclinado −8°. Es el único inclinado y uno de los
 *   tres lugares de la lima.
 * - «Bastante afín» y «Afín a medias»: blanco con borde índigo.
 * - «Poco afín» y «Lejos de tu perfil»: blanco con borde gris. «Lejos de tu perfil» no entra en
 *   dos líneas dentro de un círculo de 60 px sin bajar de 10 px: ese nivel es una píldora vertical
 *   (el mismo ancho, un poco más alta).
 * - `estimacion`: borde punteado, número y «Estimado». `sin`: vacío punteado con «Sin evaluar».
 * - `pendiente` (C2, decisión 10): un anillo punteado que gira despacio con «Leyendo…» quieto
 *   adentro; la frase completa («Leyendo la oferta contra tu perfil…») la pone quien lo usa al lado.
 *   Con «reducir movimiento» el anillo queda quieto. Es la única animación en loop de la app.
 *
 * Es una imagen con nombre para el lector de pantalla: «puntaje 8.5», «estimación previa 6», «en
 * cola», «sin evaluar». Los e2e leen ese formato (`[aria-label^="puntaje "]`): no cambiarlo.
 * Server Component: el estampado (C9-14) lo envuelve un client component chico.
 */
export type SealSize = "list" | "detail";

const SIZES: Record<SealSize, { box: string; tall: string; number: string; word: string }> = {
  list: {
    box: "size-[60px]",
    tall: "w-[60px] min-h-[76px] py-2",
    number: "text-[22px]",
    word: "text-[10px]",
  },
  detail: {
    box: "size-[78px]",
    tall: "w-[78px] min-h-[94px] py-2.5",
    number: "text-[30px]",
    word: "text-[11px]",
  },
};

const STATES: Record<SealState, string> = {
  muy: "-rotate-[8deg] border-[3px] border-brand-contrast bg-brand text-brand-contrast",
  bastante: "border-[3px] border-seal-line bg-seal text-fg",
  medias: "border-[3px] border-seal-line bg-seal text-fg",
  poco: "border-[3px] border-seal-line-muted bg-seal text-fg-muted",
  lejos: "border-[3px] border-seal-line-muted bg-seal text-fg-muted",
  estimacion: "border-[3px] border-dashed border-seal-line-muted bg-seal text-fg-muted",
  sin: "border-[3px] border-dashed border-seal-line-muted bg-seal text-fg-subtle",
  pendiente: "bg-seal text-fg-muted",
};

/** Palabra corta dentro del sello en cola: la frase entera va al lado. */
const PENDING_WORD = "Leyendo…";

export function Seal({
  score,
  preScore = null,
  pending = false,
  size = "list",
  title,
  as = "img",
  className,
  ...props
}: {
  score: number | null;
  preScore?: number | null;
  pending?: boolean;
  size?: SealSize;
  /** Ayuda al pasar el mouse (p. ej. qué es una estimación). */
  title?: string;
  /**
   * `img` (por defecto): una imagen con `aria-label` («puntaje 8.5»). `text`: el sello es
   * decorativo y adentro va la frase oculta («Puntaje 8.5 de 10, muy afín»), que también leen los
   * e2e como texto (/hoy).
   */
  as?: "img" | "text";
  className?: string;
} & { [key: `data-${string}`]: string | undefined }) {
  const state = sealState({ score, preScore, pending });
  const value = state === "estimacion" ? preScore : score;
  const showNumber = state !== "sin" && state !== "pendiente" && value !== null;
  const word = state === "pendiente" ? PENDING_WORD : sealWord(state);
  const s = SIZES[size];
  const hidden = as === "text" ? true : undefined;
  return (
    <span
      {...(as === "img" ? { role: "img", "aria-label": scoreAriaLabel(state, value) } : {})}
      title={title}
      data-score-state={state}
      data-seal={state}
      className={cx(
        "relative flex shrink-0 flex-col items-center justify-center rounded-pill text-center",
        state === "lejos" ? s.tall : s.box,
        STATES[state],
        className,
      )}
      {...props}
    >
      {as === "text" ? <span className="sr-only">{scoreSentence(state, value)}</span> : null}
      {state === "pendiente" ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-pill border-[3px] border-dashed border-seal-line motion-safe:animate-[spin_8s_linear_infinite]"
        />
      ) : null}
      {showNumber ? (
        <span
          aria-hidden={hidden}
          className={cx("font-display leading-none font-extrabold tracking-tight", s.number)}
        >
          {formatScoreNumber(value)}
        </span>
      ) : null}
      <span
        aria-hidden={hidden}
        className={cx(
          "max-w-[85%] leading-[1.05] font-bold text-balance",
          s.word,
          showNumber && "mt-0.5",
        )}
      >
        {word}
      </span>
    </span>
  );
}
