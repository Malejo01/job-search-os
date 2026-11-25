/**
 * Contenido del recorrido para revisar (R26-03): las pantallas que miran Ani y los testers, en los
 * mismos grupos que el menú. Cada una dice qué es en una línea y tres cosas para mirar, en palabras de
 * quien no programa. Sin imports y sin I/O: lo lee la página (servidor), el listado (cliente) y los tests.
 *
 * `route` es la ruta REAL del árbol de `apps/web/app` (con `[id]` donde hay un segmento dinámico); un test
 * verifica que existe. Es también la «pantalla» con la que se abre el feedback («Comentar esta pantalla»).
 * Los textos de esta pantalla viven acá y en `textos-recorrido.ts`, no en `textos-rediseno.ts` (ese lo
 * aprueba Ani).
 */

export const RECORRIDO_GROUPS = [
  { id: "hoy", label: "Hoy" },
  { id: "match", label: "Match" },
  { id: "cv", label: "CV" },
  { id: "tracker", label: "Tracker" },
  { id: "interview", label: "Interview" },
  { id: "academy", label: "Academy" },
  { id: "plan", label: "Plan" },
  { id: "primer-uso", label: "Primer uso" },
  { id: "vacios", label: "Pantallas vacías" },
  { id: "pruebas", label: "Pruebas finales" },
] as const;

export type RecorridoGroupId = (typeof RECORRIDO_GROUPS)[number]["id"];

/**
 * Qué hace «Abrir»:
 * - `route`: va a `route` tal cual.
 * - `job`: reemplaza `[id]` por la primera oferta de quien revisa; si no tiene, va a `listRoute`.
 * - `interview`: lo mismo con una simulación (`prefer` dice cuál mirar primero).
 * - `primer-uso`: vuelve a mostrar el recorrido de primer uso en `/hoy` (lo resuelve el cliente).
 */
export type RecorridoOpen =
  | { kind: "route" }
  | { kind: "job" }
  | { kind: "interview"; prefer: "en_curso" | "terminada" }
  | { kind: "primer-uso" };

export type RecorridoScreen = {
  id: string;
  group: RecorridoGroupId;
  title: string;
  /** Una línea: qué es esta pantalla. */
  what: string;
  /** Tres cosas para mirar, pensadas para alguien que no es técnico. */
  look: readonly [string, string, string];
  /** Ruta real del árbol de `app/`; también es la pantalla del feedback. */
  route: string;
  open: RecorridoOpen;
  /** Adónde va «Abrir» cuando no hay datos para resolver `[id]`. */
  listRoute: string;
  /** Cómo llegar a mano (o por qué puede no aparecer) cuando «Abrir» no lleva directo. */
  howTo: string | null;
};

export const RECORRIDO_SCREENS: readonly RecorridoScreen[] = [
  {
    id: "hoy",
    group: "hoy",
    title: "Hoy",
    what: "Lo primero que ves al entrar: lo nuevo, lo que vence y lo que conviene hacer ahora.",
    look: [
      "Que se entienda qué hacer primero sin leer todo.",
      "Que las ofertas nuevas muestren su puntaje y una razón corta.",
      "Que en el celular ningún botón quede tapado por la burbuja del asistente.",
    ],
    route: "/hoy",
    open: { kind: "route" },
    listRoute: "/hoy",
    howTo: null,
  },
  {
    id: "match-lista",
    group: "match",
    title: "Lista de ofertas",
    what: "Todas las ofertas que llegaron, ordenadas para que veas primero las que más te sirven.",
    look: [
      "Que cada tarjeta se lea de un vistazo: puesto, empresa y sello de afinidad.",
      "Que los filtros se entiendan y que al usarlos la lista cambie.",
      "Que una oferta descartada se vea distinta de una que conviene mirar.",
    ],
    route: "/jobs",
    open: { kind: "route" },
    listRoute: "/jobs",
    howTo: null,
  },
  {
    id: "match-oferta",
    group: "match",
    title: "Oferta con el sello abierto",
    what: "El detalle de una oferta, con el sello de afinidad y cómo se compone el puntaje.",
    look: [
      "Tocá el sello: que se abra «Cómo se compone el puntaje» y se entienda cada barra.",
      "Que las palabras (por ejemplo «a tu favor») no suenen a promesa de trabajo.",
      "Que se vea claro qué podés hacer después: guardar, descartar o preparar.",
    ],
    route: "/jobs/[id]",
    open: { kind: "job" },
    listRoute: "/jobs",
    howTo: "Todavía no tenés ofertas: sumá una desde «Cargar oferta» en Ofertas y volvé acá.",
  },
  {
    id: "match-condiciones",
    group: "match",
    title: "Condiciones de la oferta",
    what: "Dentro de la oferta, el bloque «Condiciones laborales»: lo que el aviso dice y lo que no.",
    look: [
      "Que lo que el aviso no dice figure como «no informado» y no como un dato inventado.",
      "Que sueldo, modalidad y lugar se lean sin tener que adivinar.",
      "Que el bloque no se mezcle con el puntaje: una cosa es la oferta y otra, cuánto te sirve.",
    ],
    route: "/jobs/[id]",
    open: { kind: "job" },
    listRoute: "/jobs",
    howTo: "Todavía no tenés ofertas: sumá una desde «Cargar oferta» en Ofertas y volvé acá.",
  },
  {
    id: "match-transparencia",
    group: "match",
    title: "Transparencia del aviso",
    what: "Dentro de la oferta, el bloque que dice cuánto cuenta el aviso mismo (no si te conviene).",
    look: [
      "Que se entienda que mide al aviso y no a vos.",
      "Que la lista de lo que falta sea concreta y no asuste.",
      "Que la palabra del puntaje (por ejemplo «completo» o «escueto») resulte justa.",
    ],
    route: "/jobs/[id]",
    open: { kind: "job" },
    listRoute: "/jobs",
    howTo: "Todavía no tenés ofertas: sumá una desde «Cargar oferta» en Ofertas y volvé acá.",
  },
  {
    id: "match-preparar",
    group: "match",
    title: "Preparar mi postulación",
    what: "Ayuda para armar la postulación: respuestas, carta y CV para esa oferta. Termina en un enlace al aviso.",
    look: [
      "Que quede claro que la postulación la hacés vos, en el sitio del aviso.",
      "Que los textos sugeridos suenen a vos y no a un robot.",
      "Que la lista de pasos finales sirva y no sobre.",
    ],
    route: "/jobs/[id]/postular",
    open: { kind: "job" },
    listRoute: "/jobs",
    howTo: "Todavía no tenés ofertas: sumá una desde «Cargar oferta» en Ofertas y volvé acá.",
  },
  {
    id: "cv-diagnostico",
    group: "cv",
    title: "Diagnóstico del CV",
    what: "Tu CV con sus niveles: qué tiene fuerte, qué falta y qué conviene mejorar.",
    look: [
      "Que los niveles tengan palabras que se entiendan sin explicación.",
      "Que lo que falta venga con un paso concreto para resolverlo.",
      "Que descargar el CV en DOCX o PDF funcione y se vea prolijo.",
    ],
    route: "/cv",
    open: { kind: "route" },
    listRoute: "/cv",
    howTo: null,
  },
  {
    id: "cv-coach",
    group: "cv",
    title: "Coach del CV",
    what: "Una guía paso a paso para completar y mejorar tu CV.",
    look: [
      "Que cada pregunta se entienda a la primera.",
      "Que se pueda frenar y retomar sin perder lo escrito.",
      "Que las sugerencias no inventen cosas que vos no hiciste.",
    ],
    route: "/cv/coach",
    open: { kind: "route" },
    listRoute: "/cv/coach",
    howTo: null,
  },
  {
    id: "cv-armar",
    group: "cv",
    title: "Armá tu CV con IA",
    what: "Una charla para armar tu CV desde cero con ayuda de la IA.",
    look: [
      "Que se sepa que la IA propone y vos decidís.",
      "Que la charla no se pierda si cerrás la pantalla.",
      "Que el resultado final se pueda leer y corregir antes de guardarlo.",
    ],
    route: "/cv/armar",
    open: { kind: "route" },
    listRoute: "/cv/armar",
    howTo:
      "Si la pantalla no aparece, esa función todavía no está encendida para tu cuenta: avisale al equipo.",
  },
  {
    id: "tracker",
    group: "tracker",
    title: "Tracker de postulaciones",
    what: "El seguimiento de las postulaciones que hiciste y lo que toca hacer con cada una.",
    look: [
      "Que cada estado (por ejemplo «sin respuesta») se entienda sin glosario.",
      "Que los avisos de seguimiento lleguen en el momento justo y no abrumen.",
      "Que cambiar el estado de una postulación sea fácil con el dedo.",
    ],
    route: "/applications",
    open: { kind: "route" },
    listRoute: "/applications",
    howTo: null,
  },
  {
    id: "interview-inicio",
    group: "interview",
    title: "Interview: inicio",
    what: "Desde acá empezás una simulación de entrevista y ves tu progreso.",
    look: [
      "Que se entienda la diferencia entre practicar con una oferta y practicar por carrera.",
      "Que el cupo del día se vea claro, sin tener que calcularlo.",
      "Que el progreso muestre algo útil cuando todavía hay pocas simulaciones.",
    ],
    route: "/interview",
    open: { kind: "route" },
    listRoute: "/interview",
    howTo: null,
  },
  {
    id: "interview-pregunta",
    group: "interview",
    title: "Interview: pregunta con voz",
    what: "Una pregunta de la simulación, que podés contestar escribiendo o con la voz.",
    look: [
      "Que el botón del micrófono se encuentre y diga qué está haciendo.",
      "Que el contador de preguntas no quede tapado por la burbuja en el celular.",
      "Que lo dictado aparezca como texto y se pueda corregir antes de enviar.",
    ],
    route: "/interview/[id]",
    open: { kind: "interview", prefer: "en_curso" },
    listRoute: "/interview",
    howTo: "Todavía no hiciste ninguna simulación: empezá una desde Interview y volvé acá.",
  },
  {
    id: "interview-devolucion",
    group: "interview",
    title: "Interview: devolución",
    what: "Lo que te dice la simulación después de cada respuesta: puntajes, un consejo y un ejemplo.",
    look: [
      "Que el consejo sea concreto y respetuoso, no una nota seca.",
      "Que el ejemplo de respuesta ayude y no suene a recetario.",
      "Que los puntajes se entiendan: qué mide cada uno.",
    ],
    route: "/interview/[id]",
    open: { kind: "interview", prefer: "terminada" },
    listRoute: "/interview",
    howTo: "Todavía no hiciste ninguna simulación: empezá una desde Interview y volvé acá.",
  },
  {
    id: "interview-informe",
    group: "interview",
    title: "Interview: informe final",
    what: "Al terminar las cinco preguntas, el resumen de cómo te fue y qué practicar.",
    look: [
      "Que el resumen se pueda leer en menos de un minuto.",
      "Que diga qué practicar primero, no solo qué salió mal.",
      "Que se pueda repetir la simulación con un toque.",
    ],
    route: "/interview/[id]",
    open: { kind: "interview", prefer: "terminada" },
    listRoute: "/interview",
    howTo: "Hace falta una simulación terminada: completá las cinco preguntas desde Interview.",
  },
  {
    id: "academy",
    group: "academy",
    title: "Academy",
    what: "Fichas cortas para entender el proceso de búsqueda, con los «?» que aparecen en la app.",
    look: [
      "Que cada ficha se lea en un par de minutos y sin vueltas.",
      "Que el «?» de una pantalla lleve a la ficha que corresponde.",
      "Que ninguna ficha prometa resultados ni suene a curso.",
    ],
    route: "/academy",
    open: { kind: "route" },
    listRoute: "/academy",
    howTo:
      "Si no ves fichas, todavía no hay ninguna aprobada. Las que están en revisión se ven en «Revisar Academy».",
  },
  {
    id: "plan",
    group: "plan",
    title: "Plan",
    what: "Qué sumar a tu perfil para acercarte a las ofertas que te interesan.",
    look: [
      "Que las sugerencias sean pocas y accionables.",
      "Que quede claro de dónde sale cada sugerencia.",
      "Que el tono acompañe y no presione.",
    ],
    route: "/plan",
    open: { kind: "route" },
    listRoute: "/plan",
    howTo: null,
  },
  {
    id: "primer-uso",
    group: "primer-uso",
    title: "Recorrido de primer uso",
    what: "El aviso de cuatro pasos que ve una persona la primera vez que entra después del rediseño.",
    look: [
      "Que los cuatro pasos se entiendan sin conocer la app.",
      "Que se pueda saltear en cualquier momento.",
      "Que en el celular quepa entero y los botones se toquen bien.",
    ],
    route: "/hoy",
    open: { kind: "primer-uso" },
    listRoute: "/hoy",
    howTo: "«Abrir» te lleva a Hoy y lo vuelve a mostrar en este navegador.",
  },
  {
    id: "vacios",
    group: "vacios",
    title: "Pantallas sin datos",
    what: "Cómo se ve una pantalla cuando todavía no hay nada que mostrar, por ejemplo «Sin descripción».",
    look: [
      "Que el texto diga qué pasó y qué hacer, no solo «no hay nada».",
      "Que haya un botón o link claro para seguir.",
      "Que no parezca un error.",
    ],
    route: "/jobs/pending-jd",
    open: { kind: "route" },
    listRoute: "/jobs/pending-jd",
    howTo: "Si tenés avisos sin texto los vas a ver acá; si no, se muestra el estado vacío.",
  },
  {
    id: "informe-prueba",
    group: "pruebas",
    title: "Tu informe de revisión",
    what: "Donde juntás todo lo que viste, ítem por ítem, con texto, voz, capturas y documentos, y lo mandás de una vez.",
    look: [
      "Armá 2 o 3 ítems: uno con texto largo, otro dictado por voz y otro con una captura pegada con Ctrl+V.",
      "Desde el celular, sumá una foto de la galería; en la computadora, probá «Capturar esta pantalla».",
      "Cerrá la pestaña, volvé más tarde, fijate que siga todo y tocá «Enviar informe».",
    ],
    route: "/recorrido/informe",
    open: { kind: "route" },
    listRoute: "/recorrido/informe",
    howTo:
      "También se llega desde «¿Algo no anduvo?» → «Agregar al informe». Probalo en tu navegador de siempre y en el celular.",
  },
  {
    id: "textos-aprobar",
    group: "pruebas",
    title: "Aprobar los textos nuevos",
    what: "Los textos que dice Afi y los de la ayuda, para que los apruebes o propongas cómo decirlos.",
    look: [
      "Lo que dice Afi en el informe de revisión y cuando lo enviás.",
      "Lo que dice Afi con su burbuja en Hoy, Match, Interview, CV y Academy.",
      "Las preguntas frecuentes de /ayuda.",
    ],
    route: "/settings/textos",
    open: { kind: "route" },
    listRoute: "/settings/textos",
    howTo:
      "Cada texto tiene «Aprobar» o «Proponer otro». Lo que no apruebes queda pendiente en la checklist de apertura.",
  },
];

export type RecorridoTargets = {
  /** Primera oferta de quien revisa (la más reciente), o null. */
  jobId: string | null;
  /** Simulación en curso más reciente, o null. */
  interviewActiveId: string | null;
  /** Simulación terminada más reciente, o null. */
  interviewDoneId: string | null;
};

export const NO_TARGETS: RecorridoTargets = {
  jobId: null,
  interviewActiveId: null,
  interviewDoneId: null,
};

/**
 * Adónde lleva «Abrir». `resolved` es falso cuando hacen falta datos que quien revisa no tiene todavía: el
 * link cae en la lista (`listRoute`) y la pantalla muestra `howTo`. Para el primer uso devuelve `/hoy` y el
 * cliente se ocupa de volver a mostrarlo.
 */
export function resolveOpen(
  screen: RecorridoScreen,
  targets: RecorridoTargets,
): { href: string; resolved: boolean } {
  const open = screen.open;
  if (open.kind === "route" || open.kind === "primer-uso") {
    return { href: screen.route, resolved: true };
  }
  const id =
    open.kind === "job"
      ? targets.jobId
      : open.prefer === "en_curso"
        ? (targets.interviewActiveId ?? targets.interviewDoneId)
        : (targets.interviewDoneId ?? targets.interviewActiveId);
  if (!id) return { href: screen.listRoute, resolved: false };
  return { href: screen.route.replace("[id]", encodeURIComponent(id)), resolved: true };
}

/** Clave de `localStorage` con lo ya revisado, por persona y por versión de la lista. */
export function recorridoKey(userId: string): string {
  return `jso-recorrido:r26:${userId}`;
}

/** Lee lo guardado: solo ids de pantallas que existen; cualquier otra cosa se ignora. */
export function parseReviewed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const known = new Set(RECORRIDO_SCREENS.map((s) => s.id));
    return [...new Set(data.filter((x): x is string => typeof x === "string" && known.has(x)))];
  } catch {
    return [];
  }
}
