import { BRAND } from "@job-search-os/pipeline";
import { INTERVIEW_CLIENTE } from "./textos-interview";

/**
 * Textos del rediseño que todavía puede cambiar quien define la marca. Todo en un solo lugar: cambiar
 * uno es una línea. Son los valores por defecto hasta la aprobación final.
 */

/** Palabra de una barra de afinidad según su puntaje (0 a 10). */
export const AFFINITY_WORDS = {
  high: "Te calza",
  mid: "Cerca",
  low: "A medias",
  far: "Lejos",
} as const;

/** Palabra de la transparencia del aviso según su puntaje (0 a 10). */
export const TRANSPARENCY_WORDS = {
  clear: "Aviso claro",
  partial: "Le faltan datos",
  opaque: "Aviso opaco",
} as const;

/** Niveles del diagnóstico del CV. */
export const CV_LEVEL_WORDS = {
  good: "Bien",
  improvable: "Mejorable",
  missing: "Falta",
} as const;

/** Palabra de cada puntaje de la devolución de Interview: en `textos-interview.ts` (R23-09). */
export { INTERVIEW_SCORE_WORDS } from "./textos-interview";

/** Título del diagnóstico del CV. */
export const CV_DIAGNOSIS_TITLE = "Cómo lo leen los sistemas de selección";

/** Nombre de la mascota hasta que se elija uno. */
export const MASCOT_NAME = "Tu asistente";

/** Texto para un criterio sin datos: nunca se inventa un puntaje. */
export const NO_DATA_LABEL = "Sin datos";

/** Nivel de un ítem del diagnóstico del CV cuando el mercado del puesto tiene pocos avisos: sin puntaje. */
export const CV_NOT_ENOUGH_DATA_LABEL = "Sin datos suficientes";

/** Recorrido de primer uso tras el rediseño (R23-05): cuatro pasos cortos, sin promesas. */
export const PRIMER_USO = {
  label: `Lo nuevo de ${BRAND.name}`,
  next: "Siguiente",
  back: "Anterior",
  skip: "Saltar",
  done: "Listo",
  steps: [
    {
      id: "menu",
      title: "El menú cambió",
      text: "Arriba (o abajo, en el celular) tenés cinco secciones: Hoy, Match, CV, Tracker e Interview. Lo demás, como Academy, Perfil y Ajustes, está en «Más», dentro de tu avatar.",
    },
    {
      id: "interview",
      title: "Practicá una entrevista",
      text: "En Interview elegís una oferta y respondés cinco preguntas. Después de cada respuesta ves una devolución con puntajes y consejos.",
    },
    {
      id: "sello",
      title: "El sello tiene detalle",
      text: "En cada oferta, abrí el detalle del sello para ver una barra por criterio. No cambia el número: te explica de dónde sale.",
    },
    {
      id: "academy",
      title: "Academy",
      text: "Fichas cortas para entender los términos que aparecen en la app. También las abrís desde los «?» que ves al lado de cada término.",
    },
  ],
} as const;

/** Texto para una condición laboral que el aviso no dice. */
export const NOT_INFORMED_LABEL = "No lo informa";

/** Estados vacíos y errores con la marca (R23-07): título, y la acción cuando no la trae la pantalla. */
export const ESTADOS_TEXTOS = {
  matchRevisado: { title: "Revisaste todo lo de este período" },
  matchSinResultados: { title: "Nada coincide con esos filtros" },
  trackerVacio: { title: "Todavía no marcaste postulaciones", action: "Ver mis ofertas" },
  cvSinPerfil: {
    title: "Falta tu perfil para armar el CV",
    text: "Completá tu perfil para armar el CV.",
    action: "Completar mi perfil",
  },
  academyVacia: { title: "Todavía estamos preparando las fichas", action: "Volver a Hoy" },
  academySinResultados: {
    title: "No encontramos esa ficha",
    text: "No encontramos fichas con esa búsqueda. Probá con otra palabra.",
    action: "Ver todas las fichas",
  },
  errorPantalla: {
    title: "Algo falló de nuestro lado",
    text: "No es algo que hiciste vos. Probá de nuevo; si sigue pasando, avisanos.",
    retry: "Probar de nuevo",
    home: "Ir a Hoy",
  },
  postularSinCv: { action: "Ir a mi CV" },
} as const;

/** Ayudas «?» (R23-04): cada término técnico y la ficha de Academy que lo explica. */
export const AYUDAS_ACADEMY = {
  afinidad: { slug: "afinidad", term: "afinidad" },
  seniority: { slug: "seniority", term: "seniority" },
  modalidad: { slug: "presencial-hibrido-remoto", term: "presencial, híbrido, remoto" },
  transparencia: { slug: "transparencia-del-aviso", term: "transparencia del aviso" },
  ats: { slug: "filtro-ats", term: "filtro ATS" },
  palabrasClave: { slug: "palabras-clave", term: "palabras clave" },
  logros: { slug: "logros-medibles", term: "logros medibles" },
  star: { slug: "metodo-star", term: "método STAR" },
  seguimiento: { slug: "despues-de-postularte", term: "qué hacer después de postularte" },
} as const;

/** Interview pulido (R23-08): espera, vacío, 404 propio. «analizando» y «retry» viajan al cliente: están en `textos-interview.ts` (R23-09). */
export const INTERVIEW_TEXTOS = {
  ...INTERVIEW_CLIENTE,
  vacio: {
    title: "Todavía no hiciste ninguna simulación",
    text: "Cuando termines una, la vas a poder repasar desde acá y ver cómo evolucionás.",
    action: "Empezar mi primera simulación",
  },
  noEncontrada: {
    title: "No encontramos esta simulación",
    text: "Puede que la hayas borrado o que el enlace esté mal escrito.",
    action: "Ir a Interview",
  },
} as const;
