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
 * El sello de afinidad (C9-5; medidas de C10-2, `.sello`, `.muy`, `.bas` y `.gris` del tablero
 * aprobado el 4/11): reemplaza a ScoreBadge en toda la app. Un círculo con el número (Bricolage
 * 800) y la palabra del nivel abajo (Figtree 800), a la derecha de cada oferta.
 *
 * - «Muy afín» (8,5 a 10): lima con anillo índigo de 2 px, inclinado −8°. Es el único inclinado y
 *   uno de los tres lugares de la lima.
 * - «Bastante afín» y «Afín a medias»: blanco con anillo índigo.
 * - «Poco afín» y «Lejos de tu perfil»: blanco con anillo gris (#A1A1AA) y texto gris.
 * - Las palabras largas van en dos líneas («Bastante / afín», «Afín a / medias», «Lejos de / tu
 *   perfil»): el sello sigue siendo un círculo en todos los niveles.
 * - `estimacion`: borde punteado, número y «Estimado». `sin`: vacío punteado con «Sin evaluar».
 * - `pendiente` (C2, decisión 10): un anillo punteado que gira despacio con «Leyendo…» quieto
 *   adentro; la frase completa («Leyendo la oferta contra tu perfil…») la pone quien lo usa al lado.
 *   Con «reducir movimiento» el anillo queda quieto. Es la única animación en loop de la app.
 *
 * Tamaños (en el celular / desde `sm`): `list` 56 / 62 (las tarjetas de las listas), `featured`
 * 60 / 72 (la destacada de Hoy, la elegida de Ofertas, la portada) y `detail` 78 / 88 (el detalle).
 *
 * Es una imagen con nombre para el lector de pantalla: «puntaje 8.5», «estimación previa 6», «en
 * cola», «sin evaluar». Los e2e leen ese formato (`[aria-label^="puntaje "]`): no cambiarlo.
 * Server Component: el estampado (C9-14) lo envuelve un client component chico.
 */
export type SealSize = "list" | "featured" | "detail";

const SIZES: Record<SealSize, { box: string; number: string; word: string }> = {
  list: {
    box: "size-14 sm:size-[62px]",
    number: "text-[17px] sm:text-[19px]",
    word: "text-[8px] sm:text-[9px]",
  },
  featured: {
    box: "size-[60px] sm:size-[72px]",
    number: "text-[18px] sm:text-[22px]",
    word: "text-[9px] sm:text-[10px]",
  },
  detail: {
    box: "size-[78px] sm:size-[88px]",
    number: "text-[24px] sm:text-[27px]",
    word: "text-[10px] sm:text-[11px]",
  },
};

// Anillo de 2 px por dentro (`inset`, como `.muy` y `.bas` del tablero). Clases escritas enteras:
// Tailwind solo genera las que lee tal cual en el código
const STATES: Record<SealState, string> = {
  muy: "-rotate-[8deg] bg-brand text-brand-contrast shadow-[inset_0_0_0_2px_var(--jso-brand-contrast)]",
  bastante: "bg-seal text-seal-line shadow-[inset_0_0_0_2px_var(--jso-seal-line)]",
  medias: "bg-seal text-seal-line shadow-[inset_0_0_0_2px_var(--jso-seal-line)]",
  poco: "bg-seal text-fg-subtle shadow-[inset_0_0_0_2px_var(--jso-seal-line-muted)]",
  lejos: "bg-seal text-fg-subtle shadow-[inset_0_0_0_2px_var(--jso-seal-line-muted)]",
  estimacion: "border-2 border-dashed border-seal-line-muted bg-seal text-fg-subtle",
  sin: "border-2 border-dashed border-seal-line-muted bg-seal text-fg-subtle",
  pendiente: "bg-seal text-fg-subtle",
};

/** Las palabras que no entran en una línea, cortadas como en la referencia. */
const LINES: Partial<Record<SealState, readonly [string, string]>> = {
  bastante: ["Bastante", "afín"],
  medias: ["Afín a", "medias"],
  lejos: ["Lejos de", "tu perfil"],
  sin: ["Sin", "evaluar"],
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
        s.box,
        STATES[state],
        className,
      )}
      {...props}
    >
      {as === "text" ? <span className="sr-only">{scoreSentence(state, value)}</span> : null}
      {state === "pendiente" ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-pill border-2 border-dashed border-seal-line motion-safe:animate-[spin_8s_linear_infinite]"
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
          "max-w-[88%] font-sans leading-[1.05] font-extrabold",
          s.word,
          showNumber && "mt-0.5",
        )}
      >
        {LINES[state] ? (
          <>
            {/* El espacio deja «Lejos de tu perfil» entero en el texto (e2e, copiar y pegar) */}
            {`${LINES[state][0]} `}
            <br />
            {LINES[state][1]}
          </>
        ) : (
          word
        )}
      </span>
    </span>
  );
}
