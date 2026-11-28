import { detectJobLanguage } from "../normalize/language";
import { normalizeForMatch } from "./normalize";
import type {
  Contratacion,
  Jornada,
  JobCard,
  JobCardConditions,
  JobCardRequirement,
  NivelIngles,
  Modalidad,
  RequirementCategory,
  RequirementLevel,
} from "./schema";

/**
 * Verificación de la ficha contra el texto del aviso (R31-02). Puro y determinista: acá se decide qué sobrevive.
 *
 * El modelo propone cada dato con su cita literal; el código lo acepta solo si:
 *  1. la cita está en el aviso (se compara sin mayúsculas, acentos, viñetas ni espacios repetidos);
 *  2. la cita dice lo que el dato afirma (cada condición tiene su propia comprobación: «remoto» citado para
 *     «desde cualquier país» no vale);
 *  3. el texto que escribió el modelo sale de la cita (mismas cifras y herramientas; en español, también las
 *     palabras) y no trae links, mails, HTML, instrucciones ni veredictos.
 *
 * Lo que no pasa se descarta y se anota en `dropped`. Lo que pasa a medias (un número, un nivel, una categoría que
 * la cita no respalda) se vacía o baja a «sin nivel» / «sin distinguir» / «otro» y se anota en `adjusted`: nunca se
 * deduce. El modelo no puede decir «coincide»: la ficha no tiene ese campo y cualquier texto que lo diga se
 * descarta. El idioma del aviso lo decide el código.
 */

export type DropReason =
  | "cita_no_encontrada"
  | "cita_muy_corta"
  | "cita_no_respalda"
  | "texto_no_respaldado"
  | "instruccion_en_texto"
  | "contenido_no_permitido"
  | "duplicado";

export type VerifyDrop = { field: string; reason: DropReason };
export type VerifyAdjustment = { field: string; what: string };

export type VerifyOutcome = {
  card: JobCard;
  dropped: VerifyDrop[];
  adjusted: VerifyAdjustment[];
  /** El aviso (o un dato que salió de él) trae instrucciones dirigidas a un modelo. Se reporta; no corta nada. */
  injectionSuspected: boolean;
};

/** Mínimo de caracteres (normalizados) para que una cita pruebe algo. */
const CITA_MIN_CHARS = 3;
/** Cuánto texto anterior a la cita se mira para saber en qué sección del aviso está. */
const SECTION_WINDOW = 600;

// --- Detectores (se aplican a texto ya normalizado: minúsculas, sin acentos) ---

/** Instrucciones para un modelo. Se aplican al aviso, a las citas y al texto que escribió el modelo. */
const INSTRUCTION_RES: RegExp[] = [
  /\bignor(a|ar|e|en|ad|ando)\b.{0,40}\b(instruccion|indicacion|prompt|regla|lo anterior|todo lo)/,
  /\bignore\b.{0,40}\b(instruction|prompt|above|previous|prior|rules?)\b/,
  /\bdisregard\b.{0,40}\b(instruction|above|previous|prior)/,
  /\bolvid(a|ate|ar)\b.{0,30}\b(instruccion|todo lo anterior|reglas)/,
  /\b(system|developer) prompt\b|prompt del sistema|instrucciones del sistema|\btus instrucciones\b|\byour instructions\b/,
  /\byou are now\b|\bahora (sos|eres)\b|\bactua como\b|\bact as (a|an|the)\b|\bpretend to be\b|\bfinge ser\b/,
  /que (este|ese) (puesto|aviso|empleo) (coincide|es perfecto|encaja)|coincide al \d+ ?%|\bpuntaje (de )?10\b|\bscore (of )?10\b/,
  /\bas an ai\b|\bmodelo de lenguaje\b|\blanguage model\b|\bcomo (una )?ia\b/,
  /<\/?(system|assistant|user|instructions?|prompt)\b|<<<|>>>/,
];

/** Veredictos y cosas que el modelo nunca debe escribir en un dato: el estado frente al perfil lo decide el código. */
const MODEL_VERDICT_RE =
  /\b(coincide|coinciden|matches|match)\b|compatible con (tu|su) perfil|\btu perfil\b|\byour profile\b|\b(puntaje|score|calificacion|nota)\s*[:=]?\s*\d|\baplic(a|ar) (ya|ahora)\b|\bapply now\b|\bte (conviene|recomiendo)\b|\brecomendad[oa]\b/;

/** Links, mails y etiquetas: no van en un dato que escribe el modelo. */
const FORBIDDEN_CONTENT_RE = /https?:|www\.|@|<\/?[a-z!]|\]\(|\bjavascript:/;

const WORLD_RE =
  /cualquier (pais|lugar|parte|ubicacion|rincon|ciudad)|(todo|todos) (el|los) (mundo|paises)|todo el planeta|\bmundial(es)?\b|\bworld-?wide\b|\banywhere\b|\bglobally\b|\bglobal (remote|team|hiring)\b|remoto global|around the world|from any (country|location|place)|\bany country\b|qualquer (pais|lugar|parte|cidade)|todo o mundo|mundo inteiro/;
/** «cualquier lugar de Brasil», «anywhere in the US»: es un alcance acotado, no «cualquier país». */
const WORLD_RESTRICTED_RE =
  /(anywhere|any|cualquier|qualquer|todo)\b.{0,25}\b(in|en|de|del|do|da|of|dentro|within)\s+(the\s+|la\s+|el\s+)?(us|usa|u\.s\.|united states|eeuu|ee\.? ?uu|europe|europa|latam|latinoamerica|latin america|america latina|brasil|brazil|argentina|mexico|chile|colombia|peru|uruguay|spain|espana|portugal|uk|canada|emea|apac)\b/;

const MODALIDAD_RES: Record<Modalidad, RegExp> = {
  remoto:
    /\bremot[oa]s?\b|\bremote\b|teletrabaj|home ?office|\bwork(ing)? from home\b|\bwfh\b|a distancia|trabalho remoto/,
  hibrido: /hibrid|hybrid|semi-?presencial/,
  presencial:
    /presencial|\bon-?site\b|\bin-?office\b|\bin office\b|en (la )?oficina|en sede\b|en planta\b|en (nuestras )?oficinas|\bno remot|\bnot remote\b|office-based|en (el )?local\b|en tienda/,
};
const NOT_REMOTE_RE = /\b(no|not|sin|nao)\s+(es\s+|is\s+)?(remot|remote|teletrabaj)/;

const INGLES_BASE_RE = /\bingles\b|\benglish\b/;
const INGLES_LEVEL_RES: Record<Exclude<NivelIngles, "sin_nivel">, RegExp> = {
  basico: /basic|elemental|beginner|\ba[12]\b/,
  intermedio: /intermedi|\bb[12]\b|conversacional|conversational|working knowledge/,
  avanzado:
    /avanzad|avancad|advanced|\bc[12]\b|fluent|fluid|fluente|proficien|excelente|alto nivel|high level|profesional|professional/,
  nativo: /nativ|bilingue|bilingual|mother tongue|lengua materna/,
};

const EXPERIENCIA_CUE_RE = /\banos?\b|\byears?\b|\byrs?\b|experien|\bexp\b|trayectoria|antiguedad/;

const JORNADA_RES: Record<Jornada, RegExp> = {
  completa:
    /tiempo completo|full[- ]?time|jornada completa|dedicacion (completa|exclusiva)|\b(40|44|45|48) ?(hs|horas|hours|h)\b|\b8 ?(hs|horas|hours)\b|tempo integral|jornada integral/,
  parcial:
    /medio tiempo|part[- ]?time|jornada parcial|tiempo parcial|media jornada|jornada reducida|meio periodo|meio expediente|\b(20|24|25|30) ?(hs|horas|hours)\b|\b4 ?(hs|horas)\b/,
  por_horas: /por hora|\bhourly\b|per hour|a la hora|por horas|pago por hora/,
  por_turnos: /\bturnos?\b|\bshifts?\b|rotativ|plantao|\bguardias?\b/,
  flexible: /flexib|libre disponibilidad|horario libre/,
};

const CONTRATACION_RES: Record<Contratacion, RegExp> = {
  relacion_dependencia:
    /relacion de dependencia|en dependencia|contrato indefinido|indeterminad|planta permanente|\bemplead[oa]\b|\bemployee\b|\bpermanent\b|\bclt\b|efetivo|\bw-?2\b|\bnomina\b|\bpayroll\b|contratacion directa|direct hire/,
  freelance:
    /freelanc|independiente|monotribut|\bcontractor\b|autonom|honorarios|prestador|\bpj\b|\bb2b\b|por proyecto|\bfactura|consultor|self-?employed|\b1099\b|prestacion de servicios|locacion de servicios|pessoa juridica/,
  temporal:
    /temporal|plazo fijo|eventual|fixed[- ]?term|temporary|por obra|por temporada|seasonal|contrato (por|a|de) \d|\b\d+ meses\b|duracion determinada|prazo determinado|temporario/,
  pasantia:
    /pasant|practicas (profesionales|laborales|rentadas|pre-?profesionales)|practicante|\bintern(ship)?\b|becari|estagi|trainee|aprendiz|programa de jovenes/,
  otro: /contrat|contract|vinculo|modalidad de (contratacion|trabajo)|tipo de (empleo|contrato)/,
};

const SALARIO_CUE_RE =
  /salari|sueldo|remunerac|compensat|\bsalary\b|\bpay\b|honorarios|\busd\b|\beur\b|\bars\b|\bbrl\b|\bmxn\b|\bclp\b|\bcop\b|\bpen\b|dolar|dollar|\bpesos?\b|\beuros?\b|reais|\$|€|£|ingreso|bruto|neto|\bpor (mes|hora|ano)\b|per (month|hour|year)|mensual|anual|\bk\b|\/ ?(mes|month|hr|hour|ano|year)|\bmil\b/;
const MONEDA_RES: Record<string, RegExp> = {
  USD: /\busd\b|us\$|u\$s|dolar|dollar|\$/,
  EUR: /\beur\b|euro|€/,
  ARS: /\bars\b|\bpesos?\b|\$/,
  BRL: /\bbrl\b|reais|\breal\b|r\$/,
  MXN: /\bmxn\b|\bpesos?\b|\$/,
  CLP: /\bclp\b|\bpesos?\b|\$/,
  COP: /\bcop\b|\bpesos?\b|\$/,
  UYU: /\buyu\b|\bpesos?\b|\$/,
  GBP: /\bgbp\b|£|pound|libras?/,
};
const PERIODO_RES = {
  hora: /\bhora\b|\bhoras\b|\bhour\b|\bhourly\b|\/ ?h\b|\bhr\b/,
  mes: /\bmes\b|\bmeses\b|mensual|\bmonth\b|\bmonthly\b|\/ ?mo\b/,
  anio: /\bano\b|\banos\b|anual|\byear\b|\byearly\b|\bannual\b|\/ ?yr\b/,
} as const;

const CATEGORIA_RES: Partial<Record<RequirementCategory, RegExp>> = {
  idioma:
    /ingles|english|portugues|portuguese|frances|french|aleman|german|italiano|italian|chino|chinese|mandarin|japones|japanese|idioma|bilingue|language|lengua|ruso|coreano/,
  experiencia: EXPERIENCIA_CUE_RE,
  ubicacion:
    /residen|reside|residir|vivir|vivas|radicad|ubicad|basad|located|based in|living in|live in|resident|domicili|ciudad|\bpais\b|country|\bcity\b|zona\b|region|estar en|encontrarse|localidad|provincia|\bcerca\b/,
  residencia: /residen|reside|residir|radicad|vivir|vivas|domicili|resident|live in|living in/,
  autorizacion:
    /autoriz|permiso de trabajo|work permit|\bvisa\b|authori[sz]|eligible to work|right to work|ciudadan|citizen|sponsor|permiso/,
};

/** Estas categorías dicen «estar en un lugar»: contradicen un «desde cualquier país» (lo decide el código). */
const PLACE_CATEGORIES: ReadonlySet<RequirementCategory> = new Set(["ubicacion", "residencia"]);

const INDISPENSABLE_STRONG_RE =
  /indispensabl|imprescindibl|excluyent|obligatori|\bmust[- ]have\b|\bmust\b|\bmandatory\b|requisitos? (minimos?|basicos)|minimum (requirements|qualifications)|\brequired\b|\bessential\b|essencial|indispensavel|imprescindivel/g;
/** «Requisitos»: cuenta como indispensable solo si el aviso también marca algo como deseable (así lo distingue). */
const INDISPENSABLE_WEAK_RE =
  /\brequisitos?\b|\brequirements?\b|requerimientos?|\bqualifications\b|se requiere|\brequerid[oa]s?\b|\bexigimos\b|\bexigencias?\b/g;
const DESEABLE_RE =
  /deseabl|desejavel|desejaveis|nice[- ]to[- ]have|\bplus\b|preferibl|\bpreferred\b|\bpreferably\b|se valora|\bvalorad[oa]s?\b|\bbonus\b|diferencial|\bopcional(es)?\b|conocimientos? adicionales|valorizad|differentiator/g;

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  quatro: 4,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

const LANGUAGE_ALIASES: Record<string, string[]> = {
  ingles: ["ingles", "english"],
  portugues: ["portugues", "portuguese"],
  frances: ["frances", "french", "francais"],
  aleman: ["aleman", "german", "deutsch"],
  italiano: ["italiano", "italian"],
  chino: ["chino", "chinese", "mandarin"],
  japones: ["japones", "japanese"],
};

// --- Utilidades ---

/** Los números de un texto, sin separadores de miles ni decimales: «1.250» -> «1250». */
function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
}

function positionsOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (needle === "") return out;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    out.push(i);
    from = i + 1;
  }
  return out;
}

function yearsSupported(years: number, citaNorm: string): boolean {
  if (numbersIn(citaNorm).includes(String(years))) return true;
  return (citaNorm.match(/[a-z]+/g) ?? []).some((w) => NUMBER_WORDS[w] === years);
}

/** Las primeras 5 letras de cada palabra de 4+ letras: tolera conjugaciones y plurales. */
const stems = (text: string): string[] =>
  (normalizeForMatch(text).match(/[a-z0-9]{4,}/g) ?? []).map((w) => w.slice(0, 5));

/** Las herramientas, siglas y cifras de un texto del modelo (se comparan aunque el aviso esté en otro idioma). */
function technicalTokens(text: string): string[] {
  return (text.match(/[\p{L}\d+#.]+/gu) ?? [])
    .map((t) => t.replace(/\.+$/, ""))
    .filter((t) => t !== "" && (/\d/.test(t) || /\p{Lu}.*\p{Lu}/u.test(t) || /[+#]/.test(t)))
    .map((t) => normalizeForMatch(t));
}

type Located = { n: string; pos: number[] };

export function verifyJobCardDetailed(card: JobCard, jdText: string): VerifyOutcome {
  const haystack = normalizeForMatch(jdText);
  const dropped: VerifyDrop[] = [];
  const adjusted: VerifyAdjustment[] = [];
  let injectionSuspected = INSTRUCTION_RES.some((re) => re.test(haystack));
  const jdLanguage = detectJobLanguage(jdText, null);
  const strictWords = jdLanguage !== "en" && jdLanguage !== "pt";

  const drop = (field: string, reason: DropReason) => dropped.push({ field, reason });
  const adjust = (field: string, what: string) => adjusted.push({ field, what });

  /** La cita tiene que estar en el aviso y no ser una instrucción. */
  function locate(field: string, cita: string): Located | null {
    const n = normalizeForMatch(cita);
    if (n.length < CITA_MIN_CHARS) {
      drop(field, "cita_muy_corta");
      return null;
    }
    if (INSTRUCTION_RES.some((re) => re.test(n))) {
      injectionSuspected = true;
      drop(field, "instruccion_en_texto");
      return null;
    }
    const pos = positionsOf(haystack, n);
    if (pos.length === 0) {
      drop(field, "cita_no_encontrada");
      return null;
    }
    return { n, pos };
  }

  /** ¿Por qué un texto que escribió el modelo no vale? `null` si vale. */
  function textProblem(texto: string, citaNorm: string | null): DropReason | null {
    const n = normalizeForMatch(texto);
    if (INSTRUCTION_RES.some((re) => re.test(n)) || MODEL_VERDICT_RE.test(n))
      return "instruccion_en_texto";
    if (FORBIDDEN_CONTENT_RE.test(texto.toLowerCase())) return "contenido_no_permitido";
    if (citaNorm === null) return null;
    const cited = new Set(numbersIn(citaNorm));
    if (numbersIn(n).some((x) => !cited.has(x))) return "texto_no_respaldado";
    if (technicalTokens(texto).some((t) => !citaNorm.includes(t))) return "texto_no_respaldado";
    if (strictWords) {
      const own = stems(texto);
      if (own.length > 0) {
        const fromCita = new Set(stems(citaNorm));
        if (own.filter((s) => fromCita.has(s)).length / own.length < 0.5)
          return "texto_no_respaldado";
      }
    }
    return null;
  }

  /** El texto que escribió el modelo: sin instrucciones, veredictos, links ni HTML, y apoyado en su cita. */
  function textOk(field: string, texto: string, citaNorm: string | null): boolean {
    const problem = textProblem(texto, citaNorm);
    if (problem === null) return true;
    if (problem === "instruccion_en_texto") injectionSuspected = true;
    drop(field, problem);
    return false;
  }

  // --- Resumen ---
  let resumen: JobCard["resumen"] = null;
  if (card.resumen) {
    const citas: string[] = [];
    card.resumen.citas.forEach((c, i) => {
      if (locate(`resumen.citas[${i}]`, c)) citas.push(c);
    });
    if (citas.length === 0) {
      drop("resumen", "cita_no_encontrada");
    } else {
      // Lo que afirma el resumen tiene que salir de las citas que verificaron (todas juntas), no solo existir
      const problem = textProblem(card.resumen.texto, citas.map(normalizeForMatch).join(" "));
      if (problem === null) {
        resumen = { texto: card.resumen.texto, citas };
      } else {
        if (problem === "instruccion_en_texto") injectionSuspected = true;
        drop("resumen", problem);
      }
    }
  }

  // --- Tareas ---
  const tareas: JobCard["tareas"] = [];
  const seenTareas = new Set<string>();
  card.tareas.forEach((t, i) => {
    const field = `tareas[${i}]`;
    const c = locate(field, t.cita);
    if (!c || !textOk(field, t.texto, c.n)) return;
    const key = normalizeForMatch(t.texto);
    if (seenTareas.has(key)) return drop(field, "duplicado");
    seenTareas.add(key);
    tareas.push(t);
  });

  // --- Requisitos ---
  const hasDeseableMarker = new RegExp(DESEABLE_RE.source).test(haystack);
  const markersBefore = (pos: number, len: number) => {
    const win = haystack.slice(Math.max(0, pos - SECTION_WINDOW), pos + len);
    const marks: { at: number; kind: RequirementLevel }[] = [];
    for (const m of win.matchAll(INDISPENSABLE_STRONG_RE))
      marks.push({ at: m.index, kind: "indispensable" });
    if (hasDeseableMarker) {
      for (const m of win.matchAll(INDISPENSABLE_WEAK_RE))
        marks.push({ at: m.index, kind: "indispensable" });
    }
    for (const m of win.matchAll(DESEABLE_RE)) marks.push({ at: m.index, kind: "deseable" });
    marks.sort((a, b) => a.at - b.at);
    return marks.at(-1)?.kind ?? null;
  };

  const requisitos: JobCard["requisitos"] = [];
  const seenReq = new Set<string>();
  card.requisitos.forEach((r, i) => {
    const field = `requisitos[${i}]`;
    const c = locate(field, r.cita);
    if (!c || !textOk(field, r.texto, c.n)) return;
    const key = normalizeForMatch(r.texto);
    if (seenReq.has(key)) return drop(field, "duplicado");
    seenReq.add(key);

    let nivel: RequirementLevel = r.nivel;
    if (nivel !== "sin_distinguir" && !c.pos.some((p) => markersBefore(p, c.n.length) === nivel)) {
      nivel = "sin_distinguir";
      adjust(`${field}.nivel`, "el aviso no marca este nivel");
    }
    let categoria: RequirementCategory = r.categoria;
    const catRe = CATEGORIA_RES[categoria];
    if (catRe && !catRe.test(c.n)) {
      categoria = "otro";
      adjust(`${field}.categoria`, "la cita no respalda la categoría");
    }
    let anos = r.anos;
    if (anos !== null && !yearsSupported(anos, c.n)) {
      anos = null;
      adjust(`${field}.anos`, "los años no están en la cita");
    }
    let idioma = r.idioma;
    if (idioma !== null) {
      const name = normalizeForMatch(idioma);
      const aliases = LANGUAGE_ALIASES[name] ?? [name];
      if (categoria !== "idioma" || !aliases.some((a) => c.n.includes(a))) {
        idioma = null;
        adjust(`${field}.idioma`, "el idioma no está en la cita");
      }
    }
    const out: JobCardRequirement = { ...r, nivel, categoria, anos, idioma };
    requisitos.push(out);
  });

  // --- Habilidades ---
  const habilidades: JobCard["habilidades"] = [];
  const seenSkill = new Set<string>();
  card.habilidades.forEach((h, i) => {
    const field = `habilidades[${i}]`;
    const c = locate(field, h.cita);
    if (!c) return;
    const name = normalizeForMatch(h.nombre);
    if (INSTRUCTION_RES.some((re) => re.test(name)) || MODEL_VERDICT_RE.test(name)) {
      injectionSuspected = true;
      return drop(field, "instruccion_en_texto");
    }
    if (FORBIDDEN_CONTENT_RE.test(h.nombre.toLowerCase()))
      return drop(field, "contenido_no_permitido");
    if (name.length < 2 || !c.n.includes(name)) return drop(field, "cita_no_respalda");
    if (seenSkill.has(name)) return drop(field, "duplicado");
    seenSkill.add(name);
    habilidades.push(h);
  });

  // --- Área ---
  let area: JobCard["area"] = null;
  if (card.area) {
    const c = locate("area", card.area.cita);
    if (c && textOk("area", card.area.valor, null)) area = card.area;
  }

  // --- Las 7 condiciones ---
  const cond = card.condiciones;
  const out: JobCardConditions = {
    modalidad: null,
    desdeDonde: null,
    salario: null,
    experiencia: null,
    ingles: null,
    jornada: null,
    contratacion: null,
  };

  if (cond.modalidad) {
    const f = "condiciones.modalidad";
    const c = locate(f, cond.modalidad.cita);
    if (c) {
      const ok =
        MODALIDAD_RES[cond.modalidad.valor].test(c.n) &&
        !(cond.modalidad.valor === "remoto" && NOT_REMOTE_RE.test(c.n));
      if (ok) out.modalidad = cond.modalidad;
      else drop(f, "cita_no_respalda");
    }
  }

  if (cond.desdeDonde) {
    const f = "condiciones.desdeDonde";
    const d = cond.desdeDonde;
    const c = locate(f, d.cita);
    if (c) {
      const lugares = d.lugares.filter((l) => c.n.includes(normalizeForMatch(l)));
      if (lugares.length !== d.lugares.length)
        adjust(`${f}.lugares`, "se quitaron lugares que la cita no nombra");
      const worldwide = WORLD_RE.test(c.n) && !WORLD_RESTRICTED_RE.test(c.n);
      if (d.alcance === "cualquier_pais" || d.alcance === "contradictorio") {
        if (!worldwide) drop(f, "cita_no_respalda");
        else out.desdeDonde = { alcance: d.alcance, lugares, cita: d.cita };
      } else if (lugares.length === 0) {
        drop(f, "cita_no_respalda");
      } else {
        out.desdeDonde = { alcance: d.alcance, lugares, cita: d.cita };
      }
    }
  }

  if (cond.salario) {
    const f = "condiciones.salario";
    const s = cond.salario;
    const c = locate(f, s.cita);
    if (c) {
      const nums = numbersIn(c.n);
      if (nums.length === 0 || !SALARIO_CUE_RE.test(c.n)) {
        drop(f, "cita_no_respalda");
      } else if (
        INSTRUCTION_RES.some((re) => re.test(normalizeForMatch(s.texto))) ||
        FORBIDDEN_CONTENT_RE.test(s.texto.toLowerCase())
      ) {
        drop(f, "contenido_no_permitido");
      } else {
        const supports = (x: number | null) =>
          x === null ? null : nums.includes(String(Math.round(x))) ? x : null;
        const minimo = supports(s.minimo);
        const maximo = supports(s.maximo);
        if (minimo !== s.minimo || maximo !== s.maximo)
          adjust(`${f}.monto`, "un monto no está en la cita");
        let moneda = s.moneda;
        if (moneda !== null) {
          const re = MONEDA_RES[moneda.toUpperCase()];
          if (!(re ? re.test(c.n) : c.n.includes(normalizeForMatch(moneda)))) {
            moneda = null;
            adjust(`${f}.moneda`, "la moneda no está en la cita");
          }
        }
        let periodo = s.periodo;
        if (periodo !== null && !PERIODO_RES[periodo].test(c.n)) {
          periodo = null;
          adjust(`${f}.periodo`, "el período no está en la cita");
        }
        const cited = new Set(nums);
        const texto = numbersIn(normalizeForMatch(s.texto)).every((x) => cited.has(x))
          ? s.texto
          : s.cita;
        out.salario = { texto, minimo, maximo, moneda, periodo, cita: s.cita };
      }
    }
  }

  if (cond.experiencia) {
    const f = "condiciones.experiencia";
    const e = cond.experiencia;
    const c = locate(f, e.cita);
    if (c) {
      if (!EXPERIENCIA_CUE_RE.test(c.n)) {
        drop(f, "cita_no_respalda");
      } else {
        let anos = e.anos;
        if (anos !== null && !yearsSupported(anos, c.n)) {
          anos = null;
          adjust(`${f}.anos`, "los años no están en la cita");
        }
        // Un texto que no sale de la cita no descarta la condición: se muestra la cita en su lugar
        const problem = textProblem(e.texto, c.n);
        if (problem === "instruccion_en_texto") injectionSuspected = true;
        if (problem) adjust(`${f}.texto`, "el texto no sale de la cita");
        out.experiencia = { texto: problem ? e.cita : e.texto, anos, cita: e.cita };
      }
    }
  }

  if (cond.ingles) {
    const f = "condiciones.ingles";
    const g = cond.ingles;
    const c = locate(f, g.cita);
    if (c) {
      if (!INGLES_BASE_RE.test(c.n)) {
        drop(f, "cita_no_respalda");
      } else {
        let nivel = g.nivel;
        if (nivel !== "sin_nivel" && !INGLES_LEVEL_RES[nivel].test(c.n)) {
          nivel = "sin_nivel";
          adjust(`${f}.nivel`, "la cita no respalda el nivel");
        }
        let nivelTexto = g.nivelTexto;
        if (
          nivelTexto !== null &&
          (nivel === "sin_nivel" || !c.n.includes(normalizeForMatch(nivelTexto)))
        ) {
          nivelTexto = null;
        }
        out.ingles = { nivel, nivelTexto, cita: g.cita };
      }
    }
  }

  if (cond.jornada) {
    const f = "condiciones.jornada";
    const c = locate(f, cond.jornada.cita);
    if (c) {
      if (JORNADA_RES[cond.jornada.valor].test(c.n)) out.jornada = cond.jornada;
      else drop(f, "cita_no_respalda");
    }
  }

  if (cond.contratacion) {
    const f = "condiciones.contratacion";
    const c = locate(f, cond.contratacion.cita);
    if (c) {
      if (CONTRATACION_RES[cond.contratacion.valor].test(c.n)) out.contratacion = cond.contratacion;
      else drop(f, "cita_no_respalda");
    }
  }

  // «Remoto mundial» y más abajo exige estar en un país: lo decide el código, con las dos citas a la vista.
  if (out.desdeDonde && out.desdeDonde.alcance === "cualquier_pais") {
    const restricts = requisitos.some(
      (r) => PLACE_CATEGORIES.has(r.categoria) && r.nivel !== "deseable",
    );
    if (restricts || out.desdeDonde.lugares.length > 0) {
      out.desdeDonde = { ...out.desdeDonde, alcance: "contradictorio" };
      adjust(
        "condiciones.desdeDonde.alcance",
        "el aviso dice «cualquier país» y pide estar en un lugar",
      );
    }
  }

  // --- Idioma del aviso: lo decide el código; si no alcanza, vale lo que dijo el modelo con su cita verificada ---
  let idiomaCita: string | null = null;
  const declared = card.idioma.cita ? normalizeForMatch(card.idioma.cita) : "";
  if (declared.length >= CITA_MIN_CHARS && positionsOf(haystack, declared).length > 0)
    idiomaCita = card.idioma.cita;
  const idioma: JobCard["idioma"] = {
    valor: jdLanguage ?? (idiomaCita ? card.idioma.valor : "otro"),
    cita: idiomaCita,
  };

  return {
    card: { resumen, tareas, requisitos, condiciones: out, habilidades, area, idioma },
    dropped,
    adjusted,
    injectionSuspected,
  };
}

/** La ficha con todo lo que no se verifica descartado (falla cerrado). */
export function verifyJobCard(card: JobCard, jdText: string): JobCard {
  return verifyJobCardDetailed(card, jdText).card;
}
