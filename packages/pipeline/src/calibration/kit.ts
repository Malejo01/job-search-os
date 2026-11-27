/**
 * Kit para calibrar la evaluación nueva (R31-10). Puro: sin I/O ni fecha implícita.
 *
 * - `selectCalibrationSet` elige entre 20 y 30 ofertas variadas (carreras, idiomas, modalidades, con y sin
 *   condición excluyente) de las que una persona ya tiene evaluadas con `evaluate_job@v1.5+`.
 * - `calibrationSummary` y `calibrationCsv` resumen y exportan lo que marcaron los testers («¿Te sirve esta
 *   evaluación?» y «Proponer otro puntaje»). La exportación NO lleva email, nombre, id de persona ni datos del
 *   perfil: la persona sale con su identificador seudónimo y la oferta con una referencia corta. El título y la
 *   empresa solo van si el aviso es del pool (público); una oferta que la persona cargó sale sin ellos.
 * - Las marcas no cambian ningún puntaje ni ninguna decisión: solo informan la calibración.
 */

/** Lo mínimo que hace falta de una oferta para elegirla. */
export type CalibrationItem = {
  id: string;
  discipline: string;
  modality: string;
  /** Idioma del aviso según la ficha (es, en, pt, otro); null si no hay ficha. */
  language?: string | null;
  /** ¿Tiene alguna condición excluyente (bloqueador)? */
  hasBlocking: boolean;
  score: number;
};

export const CALIBRATION_MIN = 20;
export const CALIBRATION_MAX = 30;
export const CALIBRATION_DEFAULT = 24;

/** `evaluate_job@v1.5.0` en adelante: la evaluación que se calibra. */
export function isCalibrationPrompt(promptVersion: string): boolean {
  const m = /^evaluate_job@v(\d+)(?:\.(\d+))?/.exec(promptVersion);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2] ?? 0);
  return major > 1 || (major === 1 && minor >= 5);
}

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

type Seen = { blocking: Set<boolean>; language: Set<string>; modality: Set<string> };
const newSeen = (): Seen => ({ blocking: new Set(), language: new Set(), modality: new Set() });

/**
 * Cuánto suma una oferta a lo ya elegido: con y sin condición excluyente dentro de la carrera (lo que más pesa),
 * y un idioma o una modalidad que todavía no entró en el conjunto (más que si solo es nueva en su carrera).
 */
function novelty(it: CalibrationItem, mine: Seen, all: Seen): number {
  const lang = it.language ?? "-";
  return (
    (mine.blocking.has(it.hasBlocking) ? 0 : 4) +
    (all.language.has(lang) ? 0 : 3) +
    (all.modality.has(it.modality) ? 0 : 2) +
    (mine.language.has(lang) ? 0 : 1) +
    (mine.modality.has(it.modality) ? 0 : 1)
  );
}

/**
 * Elige entre 20 y 30 ofertas (24 por defecto) repartidas entre todas las carreras que haya, de a una por
 * vuelta; en cada carrera va primero la oferta que más suma al conjunto (ver `novelty`). Estable: el mismo
 * conjunto siempre, sin importar el orden de entrada ni lo que la persona ya haya marcado (así la lista no se
 * mueve mientras trabaja). Con menos ofertas que el objetivo devuelve las que hay.
 */
export function selectCalibrationSet(
  items: readonly CalibrationItem[],
  target: number = CALIBRATION_DEFAULT,
): CalibrationItem[] {
  const goal = Math.min(
    CALIBRATION_MAX,
    Math.max(CALIBRATION_MIN, Math.trunc(target) || CALIBRATION_DEFAULT),
  );
  const groups = new Map<string, CalibrationItem[]>();
  for (const it of [...items].sort(byId))
    groups.set(it.discipline, [...(groups.get(it.discipline) ?? []), it]);
  const careers = [...groups.keys()].sort().map((d) => ({ left: groups.get(d)!, seen: newSeen() }));
  const all = newSeen();
  const out: CalibrationItem[] = [];
  while (out.length < goal) {
    let took = false;
    for (const c of careers) {
      if (!c.left.length || out.length >= goal) continue;
      let best = 0;
      let bestScore = -1;
      c.left.forEach((it, i) => {
        const s = novelty(it, c.seen, all);
        if (s > bestScore) {
          best = i;
          bestScore = s;
        }
      });
      const [pick] = c.left.splice(best, 1);
      for (const s of [c.seen, all]) {
        s.blocking.add(pick!.hasBlocking);
        s.language.add(pick!.language ?? "-");
        s.modality.add(pick!.modality);
      }
      out.push(pick!);
      took = true;
    }
    if (!took) break;
  }
  return out;
}

// --- Marcas y exportación ----------------------------------------------------------------------------

export type CalibrationVerdict = "de_acuerdo" | "en_desacuerdo";

/** Una fila de la exportación: una evaluación nueva con lo que marcó quien la revisó. */
export type CalibrationMark = {
  /** Identificador seudónimo de 6 caracteres. Nunca email ni nombre. */
  person: string;
  /** Referencia corta y no reversible de la oferta (para volver a mirarla con quien la marcó). */
  jobRef: string;
  promptVersion: string;
  discipline: string;
  modality: string;
  english: string;
  hadFullJd: boolean;
  score: number;
  accion: string;
  /** Cantidad de condiciones excluyentes de la evaluación. */
  blockers: number;
  verdict: CalibrationVerdict | null;
  /** Motivo corto que escribió la persona (hasta 140 caracteres). */
  note: string | null;
  humanScore: number | null;
  /** Día en que marcó (AAAA-MM-DD). */
  markedAt: string | null;
  /** Solo de avisos del pool; null en una oferta que la persona cargó. */
  title: string | null;
  company: string | null;
};

export type CalibrationSummary = {
  total: number;
  marked: number;
  agree: number;
  disagree: number;
  /** De acuerdo sobre lo marcado; null si no hay nada marcado. */
  agreementRate: number | null;
  byDiscipline: Record<string, { marked: number; agree: number; disagree: number }>;
  /** Diferencia media entre el puntaje propuesto y el de la evaluación, solo donde hay propuesta. */
  scoreDiff: { n: number; mean: number } | null;
};

export function calibrationSummary(rows: readonly CalibrationMark[]): CalibrationSummary {
  const mine = rows.filter((r) => isCalibrationPrompt(r.promptVersion));
  const byDiscipline: CalibrationSummary["byDiscipline"] = {};
  let agree = 0;
  let disagree = 0;
  for (const r of mine) {
    const d = (byDiscipline[r.discipline] ??= { marked: 0, agree: 0, disagree: 0 });
    if (r.verdict === "de_acuerdo") {
      agree++;
      d.marked++;
      d.agree++;
    } else if (r.verdict === "en_desacuerdo") {
      disagree++;
      d.marked++;
      d.disagree++;
    }
  }
  const marked = agree + disagree;
  const proposals = mine.filter((r) => r.humanScore !== null);
  const diffs = proposals.map((r) => r.humanScore! - r.score);
  return {
    total: mine.length,
    marked,
    agree,
    disagree,
    agreementRate: marked ? agree / marked : null,
    byDiscipline,
    scoreDiff: diffs.length
      ? { n: diffs.length, mean: diffs.reduce((a, b) => a + b, 0) / diffs.length }
      : null,
  };
}

export const CALIBRATION_CSV_HEADER =
  "fecha,persona,oferta,titulo,empresa,version,carrera,modalidad,ingles,aviso_completo,puntaje,accion,condiciones,veredicto,motivo,puntaje_propuesto";

const BOM = String.fromCharCode(0xfeff);

/** Una celda de CSV: sin fórmulas de planilla (=, +, -, @, tab, CR) y entrecomillada. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Enmascara en un texto libre lo que identifica a alguien: URLs, emails y teléfonos (7 dígitos o más, con
 * separadores). No toca números cortos como un puntaje o los años. Un nombre propio no se puede detectar:
 * por eso la pantalla pide no escribirlos.
 */
export function maskPersonalData(text: string): string {
  return text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[enlace]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\+?\d(?:[\s().-]?\d){6,}/g, "[teléfono]");
}

const VERDICT_LABEL: Record<CalibrationVerdict, string> = {
  de_acuerdo: "de acuerdo",
  en_desacuerdo: "en desacuerdo",
};

/** CSV de lo marcado sobre la evaluación nueva. Sin datos personales (ver el comentario del archivo). */
export function calibrationCsv(rows: readonly CalibrationMark[]): string {
  const lines = rows
    .filter((r) => isCalibrationPrompt(r.promptVersion))
    .map((r) =>
      [
        r.markedAt ?? "",
        r.person,
        r.jobRef,
        r.title ?? "",
        r.company ?? "",
        r.promptVersion,
        r.discipline,
        r.modality,
        r.english,
        r.hadFullJd ? "sí" : "no",
        String(r.score),
        r.accion,
        String(r.blockers),
        r.verdict ? VERDICT_LABEL[r.verdict] : "",
        maskPersonalData(r.note ?? ""),
        r.humanScore === null ? "" : String(r.humanScore),
      ]
        .map(cell)
        .join(","),
    );
  return `${BOM}${[CALIBRATION_CSV_HEADER, ...lines].join("\r\n")}\r\n`;
}
