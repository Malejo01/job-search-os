/**
 * Glosario único de la interfaz (R30-01, plan R30 a R34 §2 y §3). Lógica pura: los términos que se dicen y los que
 * no, el buscador de frases prohibidas que usan los tests, y las dos reglas de datos que dejan de mezclar
 * «sin confirmar» con «no coincide» y de mostrar «muchos candidatos» sin un número detrás.
 *
 * Los textos que ve la persona viven en `apps/web/lib/textos-rediseno.ts`; acá solo hay códigos y reglas.
 */

/** Una fila del glosario: lo que se dice, lo que no se dice y dónde. */
export type GlosarioTermino = {
  /** Lo que se dice. */
  decir: string;
  /** Lo que no se dice (puede quedar vacío). */
  noDecir: readonly string[];
  dondeSeUsa: string;
};

export const GLOSARIO: readonly GlosarioTermino[] = [
  { decir: "oferta", noDecir: [], dondeSeUsa: "lo que la persona ve en la app" },
  {
    decir: "aviso",
    noDecir: ["publicación", "anuncio"],
    dondeSeUsa: "el original, en el sitio de donde salió",
  },
  {
    decir: "afinidad",
    noDecir: ["match", "compatibilidad", "encaje", "puntaje de encaje"],
    dondeSeUsa: "sello, detalle y emails",
  },
  {
    decir: "Coincide · Sin confirmar · No coincide",
    noDecir: ["cumple", "te falta", "falta confirmar", "no cumple"],
    dondeSeUsa: "estado de cada requisito",
  },
  { decir: "habilidades", noDecir: ["skills", "aptitudes"], dondeSeUsa: "toda la interfaz" },
  {
    decir: "Ya me postulé",
    noDecir: ["Aplicada"],
    dondeSeUsa: "pestañas, estados y emails",
  },
  { decir: "Guardada", noDecir: ["favorita"], dondeSeUsa: "marca de la oferta" },
  {
    decir: "Sin evaluar",
    noDecir: ["Estimado", "Por confirmar"],
    dondeSeUsa: "cuarto sello",
  },
  {
    decir: "No especificado",
    noDecir: ["Sin datos", "N/D"],
    dondeSeUsa: "lo que el aviso no dice",
  },
];

/** Código de una regla de texto prohibido. */
export type ReglaTextoCodigo =
  | "predice_mejores"
  | "descartarian"
  | "alta_cantidad_candidatos"
  | "impide_postular"
  | "aplicada_estado"
  | "skills"
  | "match"
  | "compatibilidad"
  | "te_falta"
  | "no_cumple"
  // Solo en los bloques nuevos (modo estricto)
  | "aptitudes"
  | "encaje"
  | "publicacion"
  | "anuncio"
  | "cumple"
  | "falta_confirmar"
  | "favorita"
  | "estimado"
  | "por_confirmar"
  | "sin_datos"
  | "nd";

type Regla = { codigo: ReglaTextoCodigo; patron: RegExp };

/** Quita tildes y pasa a minúsculas: los patrones se escriben sin tildes. */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Lo que ninguna pantalla ni email puede decir (regla 2 del plan, «Aplicada» como estado, términos del glosario y
 * «te falta» / «no cumple»: un requisito sin dato del perfil es «Sin confirmar», nunca «te falta»).
 */
export const REGLAS_PROHIBIDAS: readonly Regla[] = [
  { codigo: "predice_mejores", patron: /\bentre las mejores\b/ },
  { codigo: "descartarian", patron: /lo primero por lo que te descartarian/ },
  { codigo: "alta_cantidad_candidatos", patron: /posible alta cantidad de candidatos/ },
  { codigo: "impide_postular", patron: /\bimpide postular\b/ },
  { codigo: "aplicada_estado", patron: /\baplicadas?\b/ },
  { codigo: "skills", patron: /\bskills?\b/ },
  { codigo: "match", patron: /\bmatch(es)?\b/ },
  { codigo: "compatibilidad", patron: /\bcompatibilidad\b/ },
  { codigo: "te_falta", patron: /\bte (falta|faltan)\b/ },
  { codigo: "no_cumple", patron: /\bno cumpl(e|en|is)\b/ },
];

/** Términos del glosario que se prohíben solo en los textos nuevos de la tanda (los viejos los limpian R33 y R34). */
export const REGLAS_ESTRICTAS: readonly Regla[] = [
  { codigo: "aptitudes", patron: /\baptitudes?\b/ },
  { codigo: "encaje", patron: /\bencaje\b/ },
  { codigo: "publicacion", patron: /\bpublicacion(es)?\b/ },
  { codigo: "anuncio", patron: /\banuncios?\b/ },
  { codigo: "cumple", patron: /\bcumpl(e|en|is)\b/ },
  { codigo: "falta_confirmar", patron: /\bfalta confirmar\b/ },
  { codigo: "favorita", patron: /\bfavoritas?\b/ },
  { codigo: "estimado", patron: /\bestimado\b/ },
  { codigo: "por_confirmar", patron: /\bpor confirmar\b/ },
  { codigo: "sin_datos", patron: /\bsin datos\b/ },
  { codigo: "nd", patron: /\bn\/d\b/ },
];

export type HallazgoTexto = { codigo: ReglaTextoCodigo; fragmento: string };

/**
 * Lo prohibido que aparece en un texto, con el fragmento. `estricto` suma los términos del glosario que solo
 * rigen para los textos nuevos. Insensible a mayúsculas y a tildes.
 */
export function buscarTextoProhibido(
  texto: string,
  opciones: { estricto?: boolean } = {},
): HallazgoTexto[] {
  const normal = normalizar(texto);
  const reglas = opciones.estricto
    ? [...REGLAS_PROHIBIDAS, ...REGLAS_ESTRICTAS]
    : REGLAS_PROHIBIDAS;
  const out: HallazgoTexto[] = [];
  for (const { codigo, patron } of reglas) {
    const m = patron.exec(normal);
    if (m) out.push({ codigo, fragmento: m[0] });
  }
  return out;
}

/** Los tres estados que ve la persona en cada requisito. */
export type EstadoRequisitoVisible = "coincide" | "sin_confirmar" | "no_coincide";

/**
 * Estado visible de una fila de la tabla de requisitos (`cumple`, `no_cumple`, `no_se_sabe`). «No coincide» solo
 * cuando el perfil tiene un dato explícito distinto: si la tabla dice `no_cumple` pero el perfil no tiene el dato,
 * es «Sin confirmar» (regla 1 del plan). Ante una fila que no se entiende, falla cerrado a «Sin confirmar».
 */
export function estadoRequisitoVisible(
  estado: string,
  perfilTieneElDato: boolean,
): EstadoRequisitoVisible {
  if (estado === "cumple") return "coincide";
  if (estado === "no_cumple" && perfilTieneElDato) return "no_coincide";
  return "sin_confirmar";
}

const RIESGO_CANDIDATOS = /candidatos|postulantes/i;

/**
 * Riesgos de una evaluación guardada tal como se muestran. «Muchos candidatos» solo tiene un dato detrás cuando el
 * aviso trae `candidatesCount`: sin él se saca; con él se escribe con el número del aviso (no el que haya puesto el
 * modelo). Lo demás pasa igual y en el mismo orden. La evaluación guardada no se toca: solo cambia lo que se ve.
 */
export function riesgosVisibles(
  riesgos: readonly string[],
  candidatesCount: number | null | undefined,
): string[] {
  const hayNumero =
    typeof candidatesCount === "number" && Number.isFinite(candidatesCount) && candidatesCount > 0;
  const out: string[] = [];
  let candidatosYaPuesto = false;
  for (const r of riesgos) {
    if (!RIESGO_CANDIDATOS.test(r)) {
      out.push(r);
      continue;
    }
    if (!hayNumero || candidatosYaPuesto) continue;
    candidatosYaPuesto = true;
    out.push(`Muchos candidatos: ${candidatesCount}`);
  }
  return out;
}
