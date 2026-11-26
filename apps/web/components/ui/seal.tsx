import { formatAffinityScore, sealState, type SealState } from "@job-search-os/pipeline";
import { SELLOS_TEXTOS, sealAriaLabel, sealSentence, sealWord } from "@/lib/textos-rediseno";
import { cx } from "./cx";

/**
 * El sello de afinidad (C9-5, rehecho en R30-02 y R30-12; medidas de C10-2): un círculo con el número (Bricolage
 * 800, un decimal y coma: «7,4») y, debajo del círculo, la palabra del nivel a 12 px (Figtree 800). La palabra salió
 * del círculo en R30-12: dentro de un círculo de 56 px no entra a 12 px y nada puede ir debajo de 12 px. Cuatro
 * sellos (plan R30 a R34 §4), cortados sobre el número ya redondeado:
 *
 * - «Afinidad alta» (7 o más): círculo lima con anillo índigo de 2 px, inclinado −8°. Es el único inclinado.
 * - «Afinidad media» (5 a 6,9): círculo blanco con anillo índigo.
 * - «Afinidad baja» (menos de 5): círculo blanco con anillo gris.
 * - «Sin evaluar»: círculo punteado con «?», sin número. Aunque la oferta tenga una estimación provisoria, el sello
 *   nunca la muestra como puntaje: nunca hay dos puntajes a la vista.
 * - `pendiente` (C2, decisión 10): un anillo punteado que gira despacio dentro del círculo; «Leyendo…» va debajo y
 *   la frase completa («Leyendo la oferta contra tu perfil…») la pone quien lo usa al lado. Con «reducir
 *   movimiento» el anillo queda quieto. Es la única animación en loop de la app.
 * - Las palabras largas van en dos líneas («Afinidad / alta») para no ensanchar el sello.
 *
 * Tamaños del círculo (en el celular / desde `sm`): `list` 56 / 62 (las tarjetas de las listas), `featured` 60 / 72
 * (la destacada de Hoy, la elegida de Ofertas, la portada) y `detail` 78 / 88 (el detalle).
 *
 * Es una imagen con nombre para el lector de pantalla: «puntaje 8.5, afinidad alta», «en cola», «sin evaluar». Los
 * e2e leen ese formato (`[aria-label^="puntaje "]`): no cambiarlo. Las palabras salen de `textos-rediseno.ts`.
 * El círculo lleva `data-seal-circle`. Server Component: el estampado (C9-14) lo envuelve un client component chico.
 */
export type SealSize = "list" | "featured" | "detail";

const SIZES: Record<SealSize, { box: string; width: string; number: string }> = {
  list: {
    box: "size-14 sm:size-[62px]",
    width: "w-14 sm:w-[62px]",
    number: "text-[17px] sm:text-[19px]",
  },
  featured: {
    box: "size-[60px] sm:size-[72px]",
    width: "w-[60px] sm:w-[72px]",
    number: "text-[18px] sm:text-[22px]",
  },
  detail: {
    box: "size-[78px] sm:size-[88px]",
    width: "w-[78px] sm:w-[88px]",
    number: "text-[24px] sm:text-[27px]",
  },
};

// Anillo de 2 px por dentro (`inset`, como `.muy` y `.bas` del tablero). Clases escritas enteras:
// Tailwind solo genera las que lee tal cual en el código
const STATES: Record<SealState, string> = {
  alta: "-rotate-[8deg] bg-brand text-brand-contrast shadow-[inset_0_0_0_2px_var(--jso-brand-contrast)]",
  media: "bg-seal text-seal-line shadow-[inset_0_0_0_2px_var(--jso-seal-line)]",
  baja: "bg-seal text-fg-muted shadow-[inset_0_0_0_2px_var(--jso-seal-line-muted)]",
  sin_evaluar: "border-2 border-dashed border-seal-line-muted bg-seal text-fg-muted",
  pendiente: "bg-seal text-fg-muted",
};

/** Color de la palabra de debajo: la jerarquía de texto, sin transparencias. */
const WORD_COLOR: Record<SealState, string> = {
  alta: "text-fg",
  media: "text-fg",
  baja: "text-fg-muted",
  sin_evaluar: "text-fg-muted",
  pendiente: "text-fg-muted",
};

/** Las palabras que no entran en una línea, cortadas en dos. */
const LINES: Partial<Record<SealState, readonly [string, string]>> = {
  alta: ["Afinidad", "alta"],
  media: ["Afinidad", "media"],
  baja: ["Afinidad", "baja"],
  sin_evaluar: ["Sin", "evaluar"],
};

export function Seal({
  score,
  preScore,
  pending = false,
  size = "list",
  title,
  as = "img",
  className,
  ...props
}: {
  score: number | null;
  /**
   * Ya no se usa: la estimación previa nunca es un sello (R30-02). Se acepta para no tocar a quienes todavía la
   * pasan; se puede sacar de cada llamada.
   */
  preScore?: number | null;
  pending?: boolean;
  size?: SealSize;
  /** Ayuda al pasar el mouse. */
  title?: string;
  /**
   * `img` (por defecto): una imagen con `aria-label` («puntaje 8.5, afinidad alta»). `text`: el sello es
   * decorativo y adentro va la frase oculta («Puntaje 8,5 de 10, afinidad alta»), que también leen los e2e como
   * texto (/hoy).
   */
  as?: "img" | "text";
  className?: string;
} & { [key: `data-${string}`]: string | undefined }) {
  // `preScore` se deja de lado a propósito: ver su comentario en el tipo
  void preScore;
  const state = sealState({ score, pending });
  const value = state === "sin_evaluar" || state === "pendiente" ? null : score;
  const s = SIZES[size];
  const hidden = as === "text" ? true : undefined;
  const lines = LINES[state];
  return (
    <span
      {...(as === "img" ? { role: "img", "aria-label": sealAriaLabel(state, value) } : {})}
      title={title}
      data-score-state={state}
      data-seal={state}
      className={cx(
        "relative flex shrink-0 flex-col items-center gap-1 text-center",
        s.width,
        className,
      )}
      {...props}
    >
      {as === "text" ? <span className="sr-only">{sealSentence(state, value)}</span> : null}
      <span
        data-seal-circle=""
        aria-hidden={hidden}
        className={cx(
          "relative flex shrink-0 items-center justify-center rounded-pill",
          s.box,
          STATES[state],
        )}
      >
        {state === "pendiente" ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-pill border-2 border-dashed border-seal-line motion-safe:animate-[spin_8s_linear_infinite]"
          />
        ) : null}
        {value !== null ? (
          <span className={cx("font-display leading-none font-extrabold tracking-tight", s.number)}>
            {formatAffinityScore(value)}
          </span>
        ) : state === "sin_evaluar" ? (
          <span className={cx("font-display leading-none font-extrabold", s.number)}>?</span>
        ) : null}
      </span>
      <span
        aria-hidden={hidden}
        className={cx("font-sans text-xs leading-[1.1] font-extrabold", WORD_COLOR[state])}
      >
        {lines ? (
          <>
            {/* El espacio deja la palabra entera en el texto (e2e, copiar y pegar) */}
            {`${lines[0]} `}
            <br />
            {lines[1]}
          </>
        ) : state === "pendiente" ? (
          SELLOS_TEXTOS.pendienteCorto
        ) : (
          sealWord(state)
        )}
      </span>
    </span>
  );
}
