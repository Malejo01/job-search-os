import { z } from "zod";
import { err, ok, type Result } from "../result";

/**
 * Contrato de la ficha del aviso (R31-02, plan R30-R34 §8, ADR-048). Puro.
 *
 * - El modelo **propone**: qué pide el aviso y dónde lo dice (`cita`, literal). El código **decide**:
 *   `verifyJobCard` busca cada cita en el texto y descarta lo que no verifica. El modelo nunca dice
 *   «coincide»: no hay ningún campo de estado frente al perfil (eso lo calcula `checklist.ts`).
 * - Nada se deduce: lo que el aviso no dice es `null` / lista vacía y la pantalla muestra «No especificado».
 * - Todos los objetos son estrictos: una clave de más (por ejemplo un texto del aviso que intente colar un
 *   campo) hace fallar la ficha entera.
 * - El texto que viene del modelo es dato: nunca se muestra como HTML.
 */

export const JOB_CARD_SCHEMA_VERSION = 1;

const CITA_MAX = 600;
const TEXTO_MAX = 400;
const LISTA_MAX = 40;

/** Fragmento literal del aviso que respalda el dato. */
const cita = z.string().trim().min(1).max(CITA_MAX);
const texto = z.string().trim().min(1).max(TEXTO_MAX);

// --- Vocabularios (los usan la validación, la tabla de requisitos y /market) ---

export const REQUIREMENT_LEVELS = ["indispensable", "deseable", "sin_distinguir"] as const;
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];

/** Para qué compara el código: idioma con su nivel, años, lugar, autorización, habilidades… */
export const REQUIREMENT_CATEGORIES = [
  "idioma",
  "experiencia",
  "ubicacion",
  "residencia",
  "autorizacion",
  "formacion",
  "habilidad",
  "otro",
] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export const MODALIDADES = ["remoto", "hibrido", "presencial"] as const;
export type Modalidad = (typeof MODALIDADES)[number];

/** `contradictorio`: el aviso dice «desde cualquier país» y más abajo exige estar en uno (lo marca el código). */
export const ALCANCES = ["cualquier_pais", "paises", "ciudad", "contradictorio"] as const;
export type Alcance = (typeof ALCANCES)[number];

export const NIVELES_INGLES = ["basico", "intermedio", "avanzado", "nativo", "sin_nivel"] as const;
export type NivelIngles = (typeof NIVELES_INGLES)[number];

export const JORNADAS = ["completa", "parcial", "por_horas", "por_turnos", "flexible"] as const;
export type Jornada = (typeof JORNADAS)[number];

export const CONTRATACIONES = [
  "relacion_dependencia",
  "freelance",
  "temporal",
  "pasantia",
  "otro",
] as const;
export type Contratacion = (typeof CONTRATACIONES)[number];

export const PERIODOS_SALARIO = ["hora", "mes", "anio"] as const;
export const IDIOMAS_AVISO = ["es", "en", "pt", "otro"] as const;
export type IdiomaAviso = (typeof IDIOMAS_AVISO)[number];

// --- Las 7 condiciones (plan §6 punto 3), cada una con su cita ---

const lugar = z.string().trim().min(1).max(80);

export const ModalidadSchema = z.strictObject({ valor: z.enum(MODALIDADES), cita });
export const DesdeDondeSchema = z.strictObject({
  alcance: z.enum(ALCANCES),
  /** Países o ciudades que nombra el aviso, tal como los escribe. Vacío si dice «cualquier país». */
  lugares: z.array(lugar).max(LISTA_MAX),
  cita,
});
export const SalarioSchema = z.strictObject({
  /** Lo que dice el aviso, tal cual («entre 100 y 200 por mes»). */
  texto,
  minimo: z.number().nonnegative().finite().nullable(),
  maximo: z.number().nonnegative().finite().nullable(),
  moneda: z.string().trim().min(1).max(10).nullable(),
  periodo: z.enum(PERIODOS_SALARIO).nullable(),
  cita,
});
export const ExperienciaSchema = z.strictObject({
  texto,
  /** Años mínimos si el aviso trae un número; si no, `null` (nunca se estima). */
  anos: z.number().nonnegative().max(60).finite().nullable(),
  cita,
});
export const InglesSchema = z.strictObject({
  nivel: z.enum(NIVELES_INGLES),
  /** Cómo lo nombra el aviso («B2», «fluido», «advanced»), si lo nombra. */
  nivelTexto: z.string().trim().min(1).max(60).nullable(),
  cita,
});
export const JornadaSchema = z.strictObject({ valor: z.enum(JORNADAS), cita });
export const ContratacionSchema = z.strictObject({ valor: z.enum(CONTRATACIONES), cita });

export const JOB_CARD_CONDITION_KEYS = [
  "modalidad",
  "desdeDonde",
  "salario",
  "experiencia",
  "ingles",
  "jornada",
  "contratacion",
] as const;
export type JobCardConditionKey = (typeof JOB_CARD_CONDITION_KEYS)[number];

export const CondicionesSchema = z.strictObject({
  modalidad: ModalidadSchema.nullable(),
  desdeDonde: DesdeDondeSchema.nullable(),
  salario: SalarioSchema.nullable(),
  experiencia: ExperienciaSchema.nullable(),
  ingles: InglesSchema.nullable(),
  jornada: JornadaSchema.nullable(),
  contratacion: ContratacionSchema.nullable(),
});

// --- Cuerpo de la ficha ---

export const ResumenSchema = z.strictObject({
  /** 2 o 3 frases, en español. */
  texto: z.string().trim().min(1).max(700),
  /** Fragmentos literales en los que se apoya el resumen (al menos uno debe verificar). */
  citas: z.array(cita).min(1).max(5),
});

export const TareaSchema = z.strictObject({ texto, cita });

export const RequisitoSchema = z.strictObject({
  texto,
  nivel: z.enum(REQUIREMENT_LEVELS),
  categoria: z.enum(REQUIREMENT_CATEGORIES),
  /** Años pedidos para este requisito, si hay número. */
  anos: z.number().nonnegative().max(60).finite().nullable(),
  /** Idioma pedido (categoría `idioma`): nombre en español en minúscula («ingles», «portugues»). */
  idioma: z.string().trim().min(1).max(40).nullable(),
  cita,
});

export const HabilidadSchema = z.strictObject({ nombre: z.string().trim().min(1).max(80), cita });

/** Área del puesto: es un dato del aviso, nunca un requisito cumplido. */
export const AreaSchema = z.strictObject({ valor: z.string().trim().min(1).max(80), cita });

/**
 * Idioma del aviso: lo decide el código (`detectJobLanguage`) y, si no alcanza, la ficha. `cita` es opcional
 * (`null`) porque el idioma no siempre tiene una frase puntual que lo respalde.
 */
export const IdiomaAvisoSchema = z.strictObject({
  valor: z.enum(IDIOMAS_AVISO),
  cita: cita.nullable(),
});

export const JobCardSchema = z.strictObject({
  resumen: ResumenSchema.nullable(),
  tareas: z.array(TareaSchema).max(LISTA_MAX),
  requisitos: z.array(RequisitoSchema).max(LISTA_MAX),
  condiciones: CondicionesSchema,
  habilidades: z.array(HabilidadSchema).max(LISTA_MAX),
  area: AreaSchema.nullable(),
  idioma: IdiomaAvisoSchema,
});

export type JobCard = z.infer<typeof JobCardSchema>;
export type JobCardConditions = JobCard["condiciones"];
export type JobCardRequirement = JobCard["requisitos"][number];
export type JobCardResumen = NonNullable<JobCard["resumen"]>;

/** Parsea la salida del modelo (objeto o JSON en texto). Nunca lanza: falla cerrado. */
export function parseJobCard(raw: unknown): Result<JobCard, string> {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return err("ficha_json_invalido");
    }
  }
  const r = JobCardSchema.safeParse(value);
  if (!r.success) return err("ficha_esquema_invalido");
  return ok(r.data);
}

// --- Estado para la pantalla y la base ---

/** Estados de una fila de `job_cards`. */
export const JOB_CARD_ROW_STATUSES = ["lista", "fallida", "sin_texto"] as const;
export type JobCardRowStatus = (typeof JOB_CARD_ROW_STATUSES)[number];

/** Estado que ve la pantalla del detalle (`getJobCardFor`, decisión 4 de la tanda). */
export const JOB_CARD_VIEW_STATES = [
  "lista",
  "preparando",
  "fallida",
  "sin_texto",
  "tope",
  "apagada",
] as const;
export type JobCardViewState = (typeof JOB_CARD_VIEW_STATES)[number];

export type JobCardView =
  | { status: Exclude<JobCardViewState, "lista"> }
  | {
      status: "lista";
      card: JobCard;
    };
