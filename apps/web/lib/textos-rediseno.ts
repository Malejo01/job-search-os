import { BRAND } from "@job-search-os/pipeline";
import { MASCOTA_NOMBRE } from "./mascota";
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

/** Nombre de la mascota (R27-01): sale de `MASCOTA_NOMBRE`, el único lugar donde está escrito. */
export const MASCOT_NAME = MASCOTA_NOMBRE;

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

/**
 * Lo que dice Afi en su burbuja (R28-15), borrador para que lo apruebe quien define la marca. Voseo, primera
 * persona y 1 o 2 líneas. `{nombre}` y `{n}` los completa la pantalla (`llenarTexto`, en `afi-dice.tsx`).
 */
export const AFI_DICE = {
  hoy: {
    saludoConNombre: "¡Hola, {nombre}!",
    saludoSinNombre: "¡Hola!",
    conOfertas: "Hoy te traje {n} ofertas nuevas para mirar.",
    unaOferta: "Hoy te traje 1 oferta nueva para mirar.",
    sinOfertas:
      "Hoy no hay ofertas nuevas, pero podés pegar una que te interese y te cuento qué tan bien te calza.",
    seguimosConOfertas: "Seguimos: hay {n} ofertas nuevas para mirar.",
    seguimosUnaOferta: "Seguimos: hay 1 oferta nueva para mirar.",
  },
  primerosPasosListo:
    "¡Listo! Ya sabés usar lo básico. Lo que sigue: revisar cada día las ofertas con mejor puntaje (las verdes).",
  interview: {
    texto: `Soy ${MASCOTA_NOMBRE} y te voy a entrevistar. Elegí una oferta y practicamos.`,
    accion: "Empezar",
  },
  cvArmar: "Te ayudo a armar tu CV paso a paso. Vos revisás todo antes de usarlo.",
  cvCoach: "Vamos a mejorar tu CV juntos: te muestro qué se puede decir mejor y cómo.",
  cvDiagnostico:
    "Te muestro cómo lo leería un sistema de selección: qué entiende y qué se le escapa.",
  tracker: "Acá seguimos tus postulaciones. Te aviso cuáles piden un seguimiento.",
  preparar:
    "Vamos a preparar tu postulación: te muestro qué conviene destacar. El envío lo hacés vos.",
  academy: "Te explico las ideas clave de la búsqueda, una ficha por vez.",
} as const;

/** Completa `{nombre}` y `{n}` de un texto de `AFI_DICE`. Los valores se insertan como texto, nunca como HTML. */
export function llenarTexto(texto: string, valores: Record<string, string | number>): string {
  return texto.replace(/\{(\w+)\}/g, (todo, clave: string) =>
    clave in valores ? String(valores[clave]) : todo,
  );
}

/**
 * Preguntas frecuentes de la beta (R28-12), borrador para que lo apruebe Ani. `/ayuda` ya traía 13 preguntas
 * escritas en la página; acá van las que faltaban. Voseo; sin prometer trabajo, sin «compatibilidad ATS» y sin
 * decir que la app postula por vos (ADR-004). `{n}` lo completa la página (`llenarTexto`).
 */
export const AYUDA_TEXTOS = {
  afiDice: "Acá van las dudas que más nos hacen. Si no encontrás la tuya, escribinos desde la app.",
  menuLink: "Preguntas frecuentes",
  menuHint: "Cómo se calcula la afinidad, pagos, voz, tus datos y a quién escribir.",
  /** Link dentro del asistente (solo texto de UI, no es un prompt). */
  asistenteLink: "Preguntas frecuentes",
  asistenteIntro: "¿Una duda general sobre la beta?",
  faqs: [
    {
      id: "afinidad",
      q: "¿Cómo se calcula la afinidad?",
      a: [
        "Leemos el aviso y lo comparamos con tu perfil: lo que pide, lo que ya tenés y lo que te falta. Con eso armamos un puntaje y te explicamos el porqué, punto por punto.",
        "Las cosas que pueden frenarte (por ejemplo, el país, el idioma o una condición del aviso) se muestran aparte del puntaje, para que no queden escondidas. Es una estimación para ayudarte a decidir; no garantiza que te llamen.",
      ],
    },
    {
      id: "pago",
      q: "¿Cómo pago y cuándo se activa el plan?",
      a: [
        "Pagás con el link de Mercado Pago que te mandamos con la invitación. Después entrás a Ajustes, a «Tu plan», y tocás «Ya pagué» (el número de operación es opcional).",
        "Una persona del equipo confirma el pago a mano y activa tu plan por 30 días. No es automático: puede tardar un poco, y cuando se activa lo ves en «Tu plan». No guardamos datos de tu tarjeta.",
      ],
    },
    {
      id: "voz",
      q: "¿Puedo hablar en vez de escribir? ¿Con qué navegadores?",
      a: [
        "Sí: donde ves el botón «Dictar» podés contar tu respuesta hablando y el texto aparece para que lo revises antes de enviarlo. Nunca se envía solo.",
        "En Chrome, Edge y Safari dictás directo con el navegador. En Opera, Brave y Firefox grabamos y transcribimos en nuestro servidor, y durante la beta puede tener un tope diario. Si no te funciona, podés escribir: todo se puede hacer sin voz.",
      ],
    },
    {
      id: "pocas-ofertas",
      q: "¿Por qué veo pocas ofertas de mi carrera?",
      a: [
        "Las ofertas que traemos solas salen de las páginas de empleo de las propias empresas, y hoy son más de tecnología y remotas. Para otras carreras hay menos, y las vamos sumando de a poco.",
        "Mientras tanto no te quedás sin nada: podés cargar vos los avisos que ves en otros portales y los leemos igual contra tu perfil.",
      ],
    },
    {
      id: "cargar-oferta",
      q: "¿Cómo cargo una oferta que encontré?",
      a: [
        "En Match, tocá «+ Cargar oferta» y pegá el aviso completo (o el link, si lo tenés). Lo leemos, lo comparamos con tu perfil y te mostramos la afinidad y el porqué.",
        "También podés reenviar a tu dirección de la app las alertas que te llegan por email: la ves en Ajustes, en «Reenvío de emails».",
      ],
    },
    {
      id: "tope-interview",
      q: "¿Cuántas simulaciones de Interview puedo hacer por día?",
      a: [
        "Hasta {n} simulaciones completas cada 24 horas. Si llegás al tope, te avisamos cuándo podés empezar otra; mientras tanto podés repasar las que ya terminaste.",
      ],
    },
    {
      id: "contacto",
      q: "¿A quién le escribo si algo no anda o tengo una duda?",
      a: [
        "Desde la app, con el botón «¿Algo no anduvo?» que aparece en todas las pantallas: contanos qué pasó y leemos todo durante la beta. Podés dictar el mensaje si te resulta más cómodo.",
      ],
    },
  ],
} as const;

/**
 * «Mi informe de revisión» (R29-03), borrador para que lo apruebe Ani. Solo lo ven testers y admins. Voseo; sin
 * nombres escritos a mano (`MASCOTA_NOMBRE` y `BRAND` salen de su lugar). `{n}`, `{max}` y similares los completa
 * la pantalla (`llenarTexto`). Los errores de los adjuntos salen de `ATTACHMENT_ERROR_TEXTS` (pipeline).
 */
export const INFORME_TEXTOS = {
  title: "Mi informe de revisión",
  intro:
    "Armá acá todo lo que viste mientras recorrías la app. Se guarda solo y lo podés seguir otro día. Cuando termines, lo enviás y lo leemos.",
  recorridoLink: "Mi informe de revisión",
  recorridoHint: "Juntá en un solo lugar todo lo que viste, con capturas y documentos.",
  afiExplicando: "Contame todo lo que viste: podés escribir, dictar y sumar capturas",
  afiEnviado: "¡Gracias! Lo voy a leer con mucha atención.",
  empty: "Todavía no sumaste nada. Empezá con tu primer ítem.",
  addItem: "Agregar ítem",
  addItemFull: "Llegaste al máximo de {max} ítems por informe.",
  itemTitle: "Ítem {n}",
  removeItem: "Quitar ítem",
  removeItemConfirm: "¿Quitar este ítem con sus capturas y documentos? No se puede deshacer.",
  screenLabel: "Pantalla",
  screenGeneral: "Toda la app (en general)",
  categoryLabel: "Tipo de comentario",
  messageLabel: "Qué viste",
  messageHint: "Podés escribir todo lo que quieras, hasta {max} caracteres.",
  messageCounter: "{n} de {max} caracteres",
  messageTrimmed: "Se cortó el final de lo dictado: un ítem llega hasta {max} caracteres.",
  attachments: "Capturas y documentos",
  attachmentsHint:
    "Soltá archivos acá, elegilos o pegá una captura con Ctrl+V. PDF y Word (.docx) de hasta 4 MB.",
  attachmentsChoose: "Elegir archivos",
  attachmentsCapture: "Capturar esta pantalla",
  attachmentsCaptureHint: "Elegí la ventana o pestaña; sacamos la captura y la sumamos acá.",
  attachmentsUploading: "Subiendo {name}…",
  attachmentsPreparing: "Preparando {name}…",
  attachmentsFull: "Este ítem ya tiene el máximo de {max} adjuntos.",
  attachmentRemove: "Quitar {name}",
  attachmentOpen: "Abrir {name}",
  attachmentsCaptureFailed:
    "No pudimos sacar la captura. Probá con otra ventana o pegá una con Ctrl+V.",
  attachmentsNoWebp: "Tu navegador no puede preparar la imagen. Probá con Chrome o Edge.",
  savedNow: "Guardado",
  savedAgo: "Guardado a las {hora}",
  saving: "Guardando…",
  unsaved: "Cambios sin guardar",
  saveError: "No pudimos guardar los cambios. Tu texto sigue acá: probá de nuevo.",
  saveSession: "Se venció tu sesión. Tu texto sigue acá: iniciá sesión en otra pestaña y volvé.",
  saveLocked: "Este informe ya no se puede editar.",
  send: "Enviar informe",
  sendConfirmTitle: "¿Enviar el informe?",
  sendConfirmBody: "Vas a enviar {resumen}. Después no se puede cambiar.",
  sendConfirmYes: "Sí, enviar",
  sendConfirmNo: "Volver",
  sendEmpty: "Sumá al menos un ítem antes de enviar.",
  sendItemEmpty: "El ítem {n} no tiene texto ni adjuntos: escribí algo o quitalo.",
  sendError: "No pudimos enviar el informe. Tus ítems siguen guardados: probá de nuevo.",
  sentTitle: "¡Informe enviado!",
  sentBody: "Mandaste {resumen}. Gracias por mirar con tanto detalle.",
  newReport: "Armar otro informe",
  sentListTitle: "Informes que ya enviaste",
  sentItem: "{fecha} · {resumen}",
  addToReport: "Agregar al informe",
  addToReportDone: "Lo sumamos a tu informe.",
  addToReportLink: "Ver mi informe",
  addToReportError: "No pudimos sumarlo al informe. Probá de nuevo.",
  addToReportFull: "Tu informe ya tiene el máximo de {max} ítems.",
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
