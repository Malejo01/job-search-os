import type { Checklist, ChecklistItem } from "../evaluator/checklist";
import { foldText } from "../normalize/text";

/**
 * Valores internos → texto para la persona (R11-11). Un solo lugar: los nombres de disciplina y
 * carrera, «*» como «cualquier país» y las marcas «(must)». Lo usan `buildChecklist` (evaluaciones
 * nuevas), `parseChecklist` en la web (las ya guardadas, que traen el valor interno escrito) y las
 * etiquetas de la pantalla. Puro.
 */

/** Disciplina de la evaluación y carrera de la plataforma → nombre en castellano. */
export const DISCIPLINE_NAMES: Readonly<Record<string, string>> = {
  ai_engineer: "Ingeniería de IA",
  ml_engineer: "Ingeniería de ML",
  ai_evaluation: "Evaluación de IA",
  creative_production: "Producción creativa con IA",
  fullstack: "Fullstack",
  frontend: "Frontend",
  backend: "Backend",
  devops: "DevOps",
  data: "Datos",
  ciberseguridad: "Ciberseguridad",
  negocio: "Negocio",
  project_management: "Gestión de proyectos",
  administracion_plataformas: "Administración de plataformas",
  arquitectura: "Arquitectura",
  otra: "Otra",
  marketing_digital: "Marketing digital",
  producto: "Producto",
  recursos_humanos: "Recursos humanos / recruiting",
  customer_success: "Customer success",
  abogacia: "Abogacía",
  finanzas_contabilidad: "Finanzas y contabilidad",
  comunicacion: "Comunicación",
  relaciones_internacionales: "Relaciones internacionales",
  relaciones_publicas: "Relaciones públicas",
  administracion_empresas: "Administración de empresas",
  asistencia_operaciones: "Asistencia y operaciones",
  data_analyst: "Análisis de datos",
  data_engineer: "Ingeniería de datos",
  soporte_it: "Soporte IT",
  ux_ui: "UX / UI",
  qa: "QA",
  rrhh_it: "Recursos humanos",
  product_manager: "Product management",
  product_owner: "Product owner",
  project_manager: "Gestión de proyectos",
  product_marketing: "Product marketing",
  solutions_engineer: "Ingeniería de soluciones",
  ventas_b2b: "Ventas B2B",
  atencion_cliente: "Atención al cliente",
};

/** Nombre de una disciplina o carrera; un valor desconocido se muestra sin guiones bajos. */
export function disciplineName(slug: string): string {
  return DISCIPLINE_NAMES[slug] ?? slug.replace(/_/g, " ");
}

/** Qué se dice del puesto cuando la evaluación lo clasificó como «otra». */
export const UNCLASSIFIED_ROLE_TEXT = "Puesto de un área sin clasificar";

/** «Puesto de <área>», sin el «otra» interno. */
export function roleAskText(disciplineSlug: string): string {
  return disciplineSlug === "otra"
    ? UNCLASSIFIED_ROLE_TEXT
    : `Puesto de ${disciplineName(disciplineSlug).toLowerCase()}`;
}

export const ANY_COUNTRY_TEXT = "cualquier país";

/** Lista de países para mostrar: «*» es «cualquier país». */
export function countriesText(countries: readonly string[]): string {
  const clean = countries.map((c) => c.trim()).filter(Boolean);
  return clean.includes("*") ? ANY_COUNTRY_TEXT : clean.join(", ");
}

/** «(must)» y «(nice to have)» de los gaps del modelo, en castellano. */
export function gapText(text: string): string {
  return text
    .replace(/\(\s*must\s*\)/gi, "(excluyente)")
    .replace(/\(\s*(nice(?: to have)?|deseable|optional)\s*\)/gi, "(deseable)");
}

/** ¿El gap del modelo viene marcado como excluyente? */
export const isMustGap = (text: string): boolean => /\(\s*(must|excluyente)\s*\)/i.test(text);

type TextItem = Pick<ChecklistItem, "id" | "pide" | "tenes">;

/**
 * Reescribe los valores internos que un ítem ya guardado trae escritos: «Disponible en *»,
 * «Puesto de otra», «Puesto de project management», y la lista de disciplinas aceptadas.
 */
export function translateChecklistItem<T extends TextItem>(item: T): T {
  let { pide, tenes } = item;
  if (item.id === "pais") {
    pide = pide.replace(/^Disponible en (.+)$/i, (_m, list: string) => {
      const parts = list
        .replace(/\s+y \d+ más$/i, "")
        .split(",")
        .map((s) => s.trim());
      return parts.includes("*") ? `Disponible en ${ANY_COUNTRY_TEXT}` : `Disponible en ${list}`;
    });
  }
  if (item.id === "disciplina") {
    pide = pide.replace(/^Puesto de (.+)$/i, (_m, slug: string) =>
      roleAskText(slug.trim().replace(/ /g, "_")),
    );
    if (tenes) {
      tenes = tenes
        .split(",")
        .map((s) => disciplineName(s.trim().replace(/ /g, "_")))
        .join(", ");
    }
  }
  return pide === item.pide && tenes === item.tenes ? item : { ...item, pide, tenes };
}

/** `translateChecklistItem` sobre todo el checklist (también el descarte rápido). */
export function translateChecklist<
  T extends { items: TextItem[]; descarte_rapido: TextItem | null },
>(checklist: T): T {
  return {
    ...checklist,
    items: checklist.items.map(translateChecklistItem),
    descarte_rapido: checklist.descarte_rapido
      ? translateChecklistItem(checklist.descarte_rapido)
      : null,
  };
}

/**
 * Los excluyentes que nombra la evaluación («X (must)» en `gaps`) tienen que entrar en la cuenta de
 * «Requisitos»: si no, el titular dice «Cumplís todo» y «Te falta» lista excluyentes. Cada gap
 * marcado como excluyente que no está ya como ítem de skill del checklist se suma como requisito
 * excluyente que no se cumple. Devuelve el checklist con los ítems y los conteos al día.
 */
export function withMustGaps(checklist: Checklist, gaps: readonly string[]): Checklist {
  const known = checklist.items.filter((i) => i.kind === "skill").map((i) => nameKey(i.pide));
  const extra: ChecklistItem[] = [];
  for (const raw of gaps) {
    if (!isMustGap(raw)) continue;
    const name = raw.replace(/\(\s*(must|excluyente)\s*\)/i, "").trim();
    const k = nameKey(name);
    if (!k || known.includes(k) || extra.some((e) => nameKey(e.pide) === k)) continue;
    extra.push({
      id: `gap:${extra.length}`,
      kind: "texto",
      nivel: "must",
      pide: name,
      evidencia: null,
      tenes: null,
      status: "no_cumple",
      fuente: { pide: "modelo", tenes: null },
      bloquea: false,
    });
  }
  if (!extra.length) return checklist;
  return {
    ...checklist,
    items: [...checklist.items, ...extra],
    must: { ...checklist.must, no_cumple: checklist.must.no_cumple + extra.length },
  };
}

const nameKey = (s: string): string =>
  foldText(s.replace(/^Menciona\s+/i, ""))
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();

/** Tema de un riesgo o de un requisito, para saber si hablan de lo mismo. */
const TOPICS: readonly { topic: string; ids: readonly string[]; re: RegExp }[] = [
  {
    topic: "ubicación",
    ids: ["pais", "residencia", "autorizacion"],
    re: /pa[ií]s|ubicaci|location|residen|contrata|visa/i,
  },
  { topic: "modalidad", ids: ["modalidad"], re: /h[ií]brid|presencial|modalidad|oficina/i },
  { topic: "inglés", ids: ["ingles"], re: /ingl[eé]s|english/i },
  { topic: "años", ids: ["anos"], re: /a[ñn]os|years/i },
  { topic: "sueldo", ids: ["salario"], re: /salari|sueldo|piso|pagan/i },
  { topic: "jornada", ids: ["jornada"], re: /jornada|horas semanales/i },
];

/**
 * Un riesgo «se ve, no frena». Si habla de un tema donde el checklist tiene un excluyente (ya sea
 * que no se cumple, y entonces es un freno que va en «Te falta», o que sí se cumple, y entonces el
 * riesgo lo contradice), no va en esa lista.
 */
export function contradictsRequirement(
  risk: string,
  items: ReadonlyArray<Pick<ChecklistItem, "id" | "nivel" | "status">>,
): boolean {
  return TOPICS.some(
    (t) =>
      t.re.test(risk) &&
      items.some((i) => t.ids.includes(i.id) && i.nivel === "must" && i.status !== "no_se_sabe"),
  );
}

/** Riesgos que sí van en «se ven, no frenan». */
export function visibleRisks(
  risks: readonly string[],
  items: ReadonlyArray<Pick<ChecklistItem, "id" | "nivel" | "status">> | null | undefined,
): string[] {
  return items ? risks.filter((r) => !contradictsRequirement(r, items)) : [...risks];
}
