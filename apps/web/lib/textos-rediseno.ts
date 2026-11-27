import {
  BRAND,
  formatAffinityScore,
  roundScore,
  type SealLevel,
  type SealState,
} from "@job-search-os/pipeline";
import { MASCOTA_NOMBRE } from "./mascota";
import { INTERVIEW_CLIENTE } from "./textos-interview";
import { POSTULAR_CLIENTE } from "./textos-postular";

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

/** Niveles del diagnóstico del CV (R33-06, C-36): 8 a 10, 5 a 7, 1 a 4 y 0. */
export const CV_LEVEL_WORDS = {
  good: "Sólido",
  improvable: "En camino",
  missing: "Para reforzar",
  empty: "Sin empezar",
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

/** R33 · calidad: «Tu CV» (R33-01), revisión «Esto es lo que entendí» (R33-05) y diagnóstico (R33-06). */
export const CV_CALIDAD_TEXTOS = {
  tuCv: {
    seguir: "Seguir armando mi CV",
    faltanTitulo: "Lo que falta para un CV completo",
    borrador: "Tenés un borrador sin confirmar.",
    retomar: "Retomarlo",
    completoTitulo: "Tu CV está completo",
    completoTexto: "Mirá cómo lo leen los sistemas de selección y descargalo.",
    /** Cada faltante con su botón al campo exacto (C-04). */
    pendientes: {
      summary: { text: "tu resumen", cta: "Escribir mi resumen" },
      experience: { text: "tu experiencia laboral", cta: "Agregar mi experiencia" },
      education: { text: "tus estudios", cta: "Agregar mis estudios" },
      skills: { text: "tus habilidades", cta: "Agregar mis habilidades" },
      languages: { text: "tu nivel de inglés", cta: "Agregar mi nivel de inglés" },
    },
  },
  /** «Esto es lo que entendí» (R33-05, C-26 a C-35). */
  revision: {
    titulo: "Esto es lo que entendí",
    regla: "Corregí lo que haga falta. Si algo está vacío, queda vacío: no lo completo yo.",
    ejemplo: "Ejemplo: ",
    ejemploAviso: "Los ejemplos en gris son una guía: no entran a tu CV.",
    sinCompletar: "Sin completar",
    quitarTrabajo: "Quitar este trabajo",
    quitarPregunta: "¿Quitar este trabajo?",
    quitar: "Quitar",
    cancelar: "Cancelar",
    deshacer: "Deshacer",
    trabajoQuitado: "Quitaste el trabajo.",
    agregarTrabajo: "Agregar otro trabajo",
    agregarEstudio: "Agregar estudio o certificación",
    estudiosVacio: "Nada cargado todavía.",
    estudioIncompleto: "Se suma a tu CV cuando completes la institución y el título.",
    tipoEstudio: "Estudio",
    tipoCertificacion: "Certificación",
    resumenTitulo: "Resumen profesional",
    resumenLabel: "Resumen (2 o 3 frases)",
    resumenEjemplo: "Administrativa con experiencia en atención y organización de tareas.",
    resumenAyuda: "Es un borrador con lo que contaste: corregilo con tus palabras.",
    blandasTitulo: "Habilidades blandas que confirmaste",
    blandasAyuda: "Solo están las que elegiste con «Usarla». Quitá las que no quieras.",
    skillsTitulo: "Habilidades",
    skillsAgregar: "Agregar habilidad",
    skillsAyuda:
      "Escribí una habilidad y tocá «Agregar habilidad» (o Enter). Quitá las que no uses.",
    skillsSugerencias: "Sugerencias",
    skillsSugerenciaAviso: "Sugerencia: verificá que corresponda a tu caso",
    idiomasTitulo: "Idiomas",
    idiomaNombre: "Idioma",
    idiomaNivel: "Nivel",
    idiomaSinNivel: "Sin nivel",
    idiomaAgregar: "Agregar otro idioma",
    idiomaQuitar: "Quitar idioma",
    /** Nivel (MCER) con su explicación (C-31). */
    niveles: [
      { value: "A1", label: "A1: principiante" },
      { value: "A2", label: "A2: básico" },
      { value: "B1", label: "B1: intermedio" },
      { value: "B2", label: "B2: intermedio alto" },
      { value: "C1", label: "C1: avanzado" },
      { value: "C2", label: "C2: casi nativo" },
      { value: "Nativo", label: "Nativo" },
    ],
    linksTitulo: "Links",
    linkLinkedin: "LinkedIn",
    linkGithub: "GitHub",
    linkPortfolio: "Portfolio",
    linkError: "Tiene que empezar con https://",
    linkAyuda: "Opcional. Se escribe completo, empezando con https://",
    cierre: "Guardar y ver mi CV",
    cierreAviso: "Nada entra a tu CV hasta que toques «Guardar y ver mi CV».",
  },
  /** Diagnóstico (R33-06, C-36 a C-42). */
  diagnostico: {
    frase:
      "Estos niveles miden cómo lo lee un sistema automático. No miden si sos buen o buena candidata.",
    /** Significado de cada palabra, para quien la toca. */
    significados: {
      good: "Está listo, sin cambios urgentes",
      improvable: "Tiene base, conviene mejorarlo",
      missing: "Falta contenido importante",
      empty: "No hay nada cargado",
    },
    /** Qué mide cada barra (C-38), con su ⓘ. */
    labels: {
      structure: "Estructura",
      keywords: "Palabras clave de tu carrera",
      readability: "Legibilidad",
      length: "Largo",
      achievements: "Logros medibles",
      sections: "Secciones profesionales",
    },
    mide: {
      structure: "Si el CV tiene las secciones y el orden que esperan los sistemas.",
      keywords: "Cuántas de las habilidades más pedidas para tu puesto nombra tu CV.",
      readability: "Si las viñetas son cortas y de una idea por línea, fáciles de leer.",
      length:
        "Si el CV tiene un largo cómodo: ni tan corto que falte detalle, ni tan largo que se pierda lo importante.",
      achievements: "Cuántas viñetas muestran un resultado que se puede medir.",
      sections:
        "Si están las secciones que se esperan en un CV: resumen, experiencia, estudios, habilidades e idiomas.",
    },
    ayuda: "Qué mide",
    enPausa: "Se calcula cuando tengas experiencia cargada.",
    principalTitulo: "Cargá tu experiencia laboral",
    principalTexto:
      "Legibilidad, largo y logros se calculan con tu experiencia. Cuando la cargues, los vemos.",
    /** Botón de cada paso concreto (tabla 8.2). */
    pasos: {
      add_headline: "Agregar titular",
      add_contact: "Agregar un dato de contacto",
      add_summary: "Escribir mi resumen",
      add_experience: "Agregar mi experiencia",
      add_education: "Agregar mis estudios",
      add_skills: "Agregar mis habilidades",
      add_languages: "Agregar mi nivel de inglés",
      mark_keywords: "Marcar las que tengo",
      write_achievement: "Escribir un logro con ayuda",
      edit_history: "Revisar mi historial",
    },
  },
} as const;

/** R33 · documento: descarga del CV en PDF y DOCX (R33-08), contacto y links (R33-07). */
export const CV_DOCUMENTO_TEXTOS = {
  descarga: {
    pdf: "Descargar PDF",
    docx: "Descargar DOCX",
    generando: "Generando tu archivo…",
    listo: "Listo: el archivo se descargó.",
    errorGenerico: "No pudimos generar el archivo. Probá de nuevo o descargá el otro formato.",
    errorSesion: "Tu sesión venció. Volvé a iniciar sesión y probá de nuevo.",
    errorSinPerfil: "Completá tu perfil para armar el CV y después descargalo.",
    /** `{n}` es la cantidad de segundos. */
    errorRitmo: "Descargaste muchas veces seguidas. Esperá {n} segundos y probá de nuevo.",
  },
  /** Opciones del CV (R33-07): la vista previa se actualiza sola al cambiarlas. */
  opciones: {
    titulo: "Opciones del CV",
    idioma: "Idioma",
    email: "Incluir mi email",
    basicas: "Incluir habilidades básicas",
    lugar: "Incluir ciudad y país",
    lugarAyuda: "Incluye ciudad y país, no tu dirección.",
    /** Una por link cargado. */
    incluirLink: {
      linkedin: "Incluir mi LinkedIn",
      github: "Incluir mi GitHub",
      portfolio: "Incluir mi portfolio",
      otro: "Incluir mi otro link",
    },
    telefono: "Incluir mi teléfono",
    telefonoAyuda: "Viene sin marcar: lo sumás solo si querés que aparezca en tu CV.",
    actualizando: "Actualizando la vista previa…",
  },
  /** Links del CV (R33-07, C-45). */
  links: {
    titulo: "Tus links",
    ayuda:
      "Escribilos completos, con https://. Algunos sistemas de selección no leen los links ocultos, por eso el CV muestra la dirección entera, debajo de tu nombre.",
    campo: {
      linkedin: "LinkedIn",
      github: "GitHub",
      portfolio: "Portfolio o sitio web",
      otro: "Otro link (Behance, blog, etc.)",
    },
    otroEtiqueta: "Nombre del otro link, por ejemplo Behance",
    telefono: "Teléfono (opcional)",
    telefonoAyuda:
      "Con código de área o de país. No se muestra en tu CV hasta que marques «Incluir mi teléfono».",
    errorEtiqueta: "Usá un nombre corto, solo con letras, números y espacios.",
    errorTelefono: "Escribilo solo con números, espacios, + - y paréntesis (de 6 a 15 dígitos).",
    guardar: "Guardar links",
    guardando: "Guardando…",
    guardado: "Guardado.",
    errorFormato:
      "Tiene que ser una dirección completa que empiece con https://, sin usuario ni espacios.",
    abrir: "Abrir para probarlo",
  },
  /** Aviso antes de descargar un CV incompleto (R33-07, C-46). */
  aviso: {
    /** `{lista}` va con los faltantes separados por « / ». */
    titulo: "Tu CV todavía no tiene {lista}.",
    pregunta: "¿Completarlo antes?",
    completar: "Completar",
    igual: "Descargar igual",
    items: {
      education: "Educación",
      summary: "Resumen",
      results: "resultados en tus logros",
    },
  },
  /** Avisos suaves de calidad del CV (R33-09): orientan, no cambian el CV ni sacan nada. */
  calidad: {
    titulo: "Para que tu CV se lea mejor",
    sinTitular: "Falta un titular con el puesto que buscás, debajo de tu nombre.",
    /** `{lista}` son las habilidades separadas por coma. */
    sinRespaldo:
      "Estas habilidades no aparecen en ninguna viñeta de tu experiencia: {lista}. Si de verdad las usaste, contalo ahí. No las sacamos.",
    tareas:
      "Estas viñetas cuentan tareas, no logros. Con unas preguntas la completás sin inventar nada.",
    preguntas: "Preguntas para completarla",
    soloVerdad: "Respondé solo lo que pasó de verdad. Lo que no mediste, no lo sumes.",
  },
  /** Antes y después de una reescritura (R33-09, C-68). */
  reescritura: {
    antes: "Antes",
    despues: "Después",
    dejarMio: "Dejar la mía",
    usarNueva: "Usar la nueva",
    /** `{lista}` son palabras tuyas. */
    conserva: "Conserva tus palabras: {lista}.",
    pierde: "La nueva sacó varias palabras tuyas: {lista}.",
  },
} as const;

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
        "Leemos el aviso y lo comparamos con tu perfil: lo que pide, lo que ya tenés y lo que queda sin confirmar. Con eso armamos un puntaje y te explicamos el porqué, punto por punto.",
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

/**
 * Tanda R30 «Confianza» (plan R30 a R34). Textos nuevos de la interfaz, borrador para que los apruebe Ani. Voseo,
 * glosario del plan §3 (un test los revisa con el modo estricto). Cada bloque lo edita un solo teammate:
 * `base` (glosario, sellos, aclaración y «cómo calculamos»), `listado` (`LISTADO_TEXTOS`) y `detalle`
 * (`DETALLE_TEXTOS`). `{n}`, `{sitio}` y similares los completa la pantalla (`llenarTexto`).
 */

/** Los tres estados de cada requisito (glosario: nunca «cumple», «te falta» ni «no cumple»). */
export const ESTADO_REQUISITO_TEXTOS = {
  coincide: "Coincide",
  sinConfirmar: "Sin confirmar",
  noCoincide: "No coincide",
} as const;

/** Palabras sueltas del glosario que se repiten en varias pantallas. */
export const GLOSARIO_TEXTOS = {
  yaMePostule: "Ya me postulé",
  guardada: "Guardada",
  sinEvaluar: "Sin evaluar",
  noEspecificado: "No especificado",
  habilidades: "Habilidades",
  aviso: "Aviso",
  oferta: "Oferta",
} as const;

/** Los cuatro sellos de afinidad y el sello de una oferta en cola (R30-02). */
export const SELLOS_TEXTOS = {
  alta: "Afinidad alta",
  media: "Afinidad media",
  baja: "Afinidad baja",
  sin_evaluar: "Sin evaluar",
  pendiente: "Leyendo la oferta contra tu perfil…",
  /** Palabra corta dentro del sello en cola: la frase entera va al lado. */
  pendienteCorto: "Leyendo…",
  /** Aclaración fija de la evaluación (regla 5 del plan). */
  aclaracion:
    "Esta comparación usa la información del aviso y de tu perfil. No indica tus posibilidades de contratación.",
} as const;

/** La palabra del sello: siempre está, el color nunca es la única señal. */
export function sealWord(state: SealState): string {
  return SELLOS_TEXTOS[state];
}

/** Lo mismo en minúsculas, para completar una frase («afinidad alta»). */
function sealPhrase(level: SealLevel): string {
  return SELLOS_TEXTOS[level].toLowerCase();
}

/**
 * `aria-label` del sello: «puntaje 8.5, afinidad alta» (los e2e leen el formato «puntaje N», con punto). El número es
 * el ya redondeado a un decimal, el mismo que dice el sello (R30-02).
 */
export function sealAriaLabel(state: SealState, value: number | null): string {
  if (state === "pendiente") return "en cola";
  if (state === "sin_evaluar" || value === null) return "sin evaluar";
  return `puntaje ${roundScore(value)}, ${sealPhrase(state)}`;
}

/** La misma información como frase, para el modo `text` (lectores de pantalla en /hoy). */
export function sealSentence(state: SealState, value: number | null): string {
  if (state === "pendiente") return "En cola para evaluar";
  if (state === "sin_evaluar" || value === null) return SELLOS_TEXTOS.sin_evaluar;
  return `Puntaje ${formatAffinityScore(value)} de 10, ${sealPhrase(state)}`;
}

/**
 * «Cómo calculamos la afinidad» (R30-02): qué sale del aviso, qué del perfil y qué está sin confirmar. El informe
 * (R-05) fija el sentido y el título, no el texto de cada línea; las líneas son las del plan.
 */
export const COMO_CALCULAMOS_TEXTOS = {
  summary: "Cómo calculamos la afinidad",
  intro:
    "La afinidad va de 0 a 10 y compara lo que dice el aviso con lo que cargaste en tu perfil. Es una guía para decidir.",
  avisoTitle: "Sale del aviso",
  avisoText:
    "Lo que pide el puesto: tareas, requisitos, modalidad, idioma, sueldo y desde dónde se puede trabajar.",
  perfilTitle: "Sale de tu perfil",
  perfilText: "Lo que cargaste: tu experiencia, tus habilidades, tu idioma y dónde vivís.",
  sinConfirmarTitle: "Está sin confirmar",
  sinConfirmarText:
    "Lo que el aviso o tu perfil no dicen. No lo damos por cumplido ni por faltante: queda sin confirmar.",
  sinConfirmarNinguno: "Todo lo que miramos tiene su dato.",
  condicionTitle: "La condición excluyente va aparte",
  condicionText:
    "Si el aviso pide algo que hoy no coincide con tu perfil, lo mostramos aparte de la afinidad: no cambia el número.",
} as const;

/** Textos del listado y la tarjeta (R30-03 a R30-07). Lo edita solo `listado`. */
export const LISTADO_TEXTOS = {
  /** Pestañas (plan §5). */
  tabs: {
    aria: "Pestañas de ofertas",
    porRevisar: "Por revisar",
    guardadas: "Guardadas",
    yaMePostule: "Ya me postulé",
    descartadas: "Descartadas",
    todas: "Todas",
  },
  /** «Guardada» es una marca con fecha, no un estado (R30-03). */
  guardar: {
    guardar: "Guardar",
    quitar: "Quitar de guardadas",
    marca: "Guardada",
    /** Para quien usa lector de pantalla: la acción nombra la oferta. */
    guardarOferta: "Guardar la oferta {titulo}",
    quitarOferta: "Quitar de guardadas la oferta {titulo}",
    vacioTitulo: "Todavía no guardaste ninguna oferta",
    vacioTexto: "Tocá «Guardar» en una oferta para tenerla a mano acá, sin cambiarle el estado.",
  },
  /** Tarjeta (R30-04). Los requisitos salen de la tabla de la evaluación. */
  tarjeta: {
    verOferta: "Ver oferta",
    descartar: "Descartar",
    abrirDetalle: "Abrir el detalle de {titulo}",
    /** «No coincide: residencia en EE. UU.», con texto e ícono. */
    noCoincide: "No coincide: {requisito}",
    /** «Sin confirmar: inglés, años de experiencia»: hasta 2 cosas. */
    sinConfirmar: "Sin confirmar: {lista}",
    salarioDesde: "desde USD {min}",
    leyendo: "Leyendo la oferta contra tu perfil…",
  },
  /** Vigencia (R30-07). Solo para ofertas que vienen del pool. */
  vigencia: {
    yaNoFigura: "Este aviso ya no figura en {fuente}",
    yaNoFiguraSinFuente: "Este aviso ya no figura en su fuente",
  },
  /** Descartadas (R30-06). */
  descartadas: {
    marca: "Descartada por vos",
    volverARevisar: "Volver a revisar",
    verOferta: "Ver oferta",
    avisoDescartada: "Oferta descartada.",
    deshacer: "Deshacer",
  },
  /** Chips, contador y estados de la lista (R30-05). */
  filtros: {
    aria: "Filtros",
    remoto: "Remoto",
    enCiudad: "En {ciudad}",
    aceptanPais: "Aceptan {pais}",
    enEspanol: "En español",
    paraEmpezar: "Para empezar",
    orden: "Orden",
    quitarFiltro: "Quitar el filtro {nombre}",
    limpiar: "Limpiar filtros",
    contadorUno: "1 oferta con estos filtros",
    contador: "{n} ofertas con estos filtros",
    /** Sin ningún chip activo el contador no habla de filtros. */
    totalUno: "1 oferta",
    total: "{n} ofertas",
    ordenAfinidad: "Orden: afinidad",
    ordenRecientes: "Orden: más recientes",
    ordenAyuda: "Cambiar el orden",
    paisSinDato: "Cargá tu país en tu perfil para usar este filtro",
    /** Informe R-18: estado de carga y estado vacío, tal cual. */
    cargando: "Buscando ofertas…",
    vacioTitulo: "No encontramos ofertas con estos filtros.",
    vacioTexto: "Probá quitar alguno para ver más opciones.",
  },
  /** «+ Agregar una oferta» (R30-05). */
  agregar: {
    boton: "+ Agregar una oferta",
    aclaracion: "Traé un aviso que viste en otro sitio y lo evaluamos",
  },
  /** Resumen del panel de la lista: los mismos conteos de la tabla de requisitos que la tarjeta. */
  panel: {
    resumen: "Coincide: {coincide} · Sin confirmar: {sinConfirmar} · No coincide: {noCoincide}",
    barra: "Requisitos que coinciden",
  },
} as const;

/** Textos del detalle y la evaluación (R30-08 a R30-11). Lo edita solo `detalle`. */
export const DETALLE_TEXTOS = {
  /** «Lo importante para decidir» (R30-08): siempre las 7 filas, solo con lo que dice el aviso. */
  condiciones: {
    titulo: "Lo importante para decidir",
    nota: "Esto es lo que dice el aviso, sin mezclar tu perfil.",
    noEspecificado: "No especificado",
    /** Rótulos de las 7 filas, tal cual el informe (R-26); el valor ausente es «No especificado» (glosario). */
    filas: {
      modality: "Modalidad",
      location: "Desde dónde podés trabajar",
      salary: "Salario",
      seniority: "Experiencia",
      language: "Inglés",
      hours: "Jornada y horario",
      contract: "Tipo de contratación",
    },
    todoElMundo: "Desde cualquier país",
    inglesNoLoPide: "No lo pide",
    horasSemanales: "{n} h semanales",
  },
  /** «Cómo encaja» (R30-08): sale solo de la tabla de requisitos. */
  encaja: {
    titulo: "Cómo encaja",
    /** El informe (S-16, R-06, R-30) da ejemplos de un caso concreto, no una frase por estado: estas son las del plan. */
    veredicto: {
      excluyente: "Hay una condición del aviso que hoy no coincide con tu perfil.",
      noCoincide: "Algunos requisitos del aviso no coinciden con tu perfil.",
      sinConfirmar: "Hay requisitos que no podemos confirmar con tu perfil.",
      coincide: "Los requisitos del aviso coinciden con tu perfil.",
      vacio: "Todavía no hay requisitos del aviso para comparar con tu perfil.",
    },
    pesan: "Lo que más pesa",
    pide: "El aviso pide: {pide}",
    tenes: "En tu perfil: {tenes}",
    sinDato: "Todavía no tenemos este dato en tu perfil.",
    excluyente: "Excluyente",
    deseable: "Deseable",
    condicionTitulo: "Condición excluyente",
    condicionExplica:
      "La afinidad compara tu perfil con el puesto. Esta condición es un requisito del aviso que hoy no coincide, y se explica aparte del puntaje.",
  },
  /** «¿Te sirve esta evaluación?» (R30-11). Viajan como props al componente de cliente. */
  valoracion: {
    titulo: "¿Te sirve esta evaluación?",
    si: "Sí",
    no: "No",
    gracias: "Gracias",
    /** Los cuatro motivos, tal cual el informe (S-43). La ayuda es la del plan §6 (gana sobre «Nos ayuda a mejorarla»). */
    motivosTitulo: "¿Qué pasó? (opcional)",
    motivos: [
      "Leyeron mal un requisito",
      "El puntaje no me parece justo",
      "Falta algo importante",
      "Otro",
    ],
    motivoCampo: "Contanos más (opcional)",
    ayuda: "Nos ayuda a mejorar la evaluación; no cambia tu puntaje.",
    guardar: "Guardar motivo",
    guardando: "Guardando…",
    quitar: "Quitar motivo",
    guardado: "Guardado ✓",
    error: "No se pudo guardar el motivo. Probá de nuevo.",
  },
  /** «Preparar mi postulación» (R30-10): el botón de salida y la pregunta al volver. */
  postular: {
    ...POSTULAR_CLIENTE,
    /** Aclaración del botón de salida: el nombre de la marca sale de `BRAND` (no viaja al cliente). */
    aviso: `Vas a continuar en un sitio externo. Tu postulación no se envía desde ${BRAND.name}.`,
  },
  /** Tabla de «Requisitos» (R30-09): la única fuente de lo que la pantalla dice sobre requisitos. */
  requisitos: {
    titulo: "Requisitos del aviso",
    titular: "Coinciden {x} de {y} requisitos excluyentes",
    titularSinConfirmar: " y {n} sin confirmar",
    sinRequisitos: "No hay requisitos verificables; mirá la lista",
    deseables: "Deseables: coinciden {x} de {y}",
    deseablesSinConfirmar: " y {n} sin confirmar",
    excluyenteTitulo: "Condición excluyente",
    excluyenteSi: "Hoy no coincide: {pide}",
    excluyenteTenes: " (en tu perfil: {tenes})",
    excluyenteNo: "No encontramos condiciones excluyentes que no coincidan con tu perfil.",
    lista: { excluyente: "excluyente", deseable: "deseable" },
    loQuePide: "Lo que pide el aviso",
    enTuPerfil: "En tu perfil",
    sinConfirmarPerfil: "Sin confirmar: todavía no tenemos este dato.",
  },
  /** Secciones plegables de la evaluación completa (R30-08/09): igual en computadora y celular. */
  secciones: {
    requisitos: "Requisitos",
    habilidades: "Habilidades",
    comoSeCalculo: "Cómo se calculó",
    preparar: "Preparar mi postulación",
    descripcion: "Ver descripción original",
    fuentes: "Fuentes",
  },
  /** Antes de evaluar (plan §4): sello «Sin evaluar», botón y estimación provisoria plegada. */
  antes: {
    texto: "Todavía no evaluamos esta oferta con tu perfil.",
    evaluar: "Evaluar esta oferta",
    provisoria: "Estimación provisoria (sin IA)",
    provisoriaTexto:
      "Sale de reglas, sin inteligencia artificial: requisitos del aviso contra tu experiencia, riesgos y salario contra tu piso. No es la evaluación completa.",
    provisoriaNumero: "{n} de 10, solo como referencia",
    riesgos: "Riesgos detectados",
  },
  /** «Habilidades» de la evaluación (plan §6). */
  habilidades: {
    intro: "Habilidades que menciona el aviso. No cuentan en el puntaje principal.",
    mencionada: "Mencionada en el aviso",
    nivel: "Tu nivel: {n} de 3",
    sinCargar: "Sin cargar",
    cargar: "Cargá tu nivel de {nombre}",
    vacio: "No encontramos habilidades que el aviso mencione.",
  },
  /** «Preparar mi postulación» dentro del detalle (R30-10, plan §7). */
  preparar: {
    intro:
      "Pegá las preguntas del formulario, revisá los borradores y copiá lo aprobado. Nada se envía desde acá. La postulación la hacés vos, en el sitio del aviso.",
    pasos: "Antes de postularte",
    cv: "Revisar mi CV para esta oferta",
    guardadas: "Respuestas guardadas ({n})",
  },
  /** Estado de la oferta (glosario: «Ya me postulé», nunca «Aplicada»). */
  estado: {
    marcarPostulada: "Ya me postulé",
    postuladaEl: "Ya me postulé el {fecha}",
  },
  /** Riesgos que dejó la evaluación (solo con dato detrás, ver `riesgosVisibles`). */
  riesgos: { titulo: "Riesgos de la evaluación ({n})" },
  /** «Proponer otro puntaje» (R30-11): solo testers y admins. */
  proponerPuntaje: {
    titulo: "Proponer otro puntaje",
    /** El informe (S-44, S-45) pide que diga qué efecto tiene, sin dar el texto: este es el del plan. */
    aclaracion:
      "Es una propuesta para revisar la evaluación. No cambia el puntaje que ves ni lo que decide la app.",
    campoPuntaje: "Tu puntaje (0–10)",
    campoNota: "Nota",
    notaEjemplo: "por qué no coincide con la evaluación",
    guardar: "Guardar",
    guardado: "Guardado: {puntaje} · diferencia con la evaluación {diferencia}",
  },
} as const;

/**
 * Textos de la ficha del aviso en el detalle (R31-04, R31-07, R31-08). Lo edita solo `pantalla`.
 * Lo que dice la ficha sale del aviso, con su cita; acá solo van los rótulos y los estados.
 */
export const PANTALLA_TEXTOS = {
  pocasPalabras: { titulo: "La oferta en pocas palabras" },
  queVasAHacer: { titulo: "Qué vas a hacer", vacio: "No especificado" },
  queBuscan: {
    titulo: "Qué buscan",
    indispensable: "Indispensable",
    deseable: "Deseable",
    sinDistinguir: "El aviso no distingue entre indispensable y deseable.",
    vacio: "No especificado",
  },
  /** Cita literal del aviso, plegada bajo cada dato. */
  cita: { rotulo: "Así lo dice el aviso", ver: "Ver cita" },
  /** Valores de «Lo importante para decidir» cuando salen de la ficha (el aviso, con su cita). */
  valores: {
    jornada: {
      completa: "Jornada completa",
      parcial: "Jornada parcial",
      por_horas: "Por horas",
      por_turnos: "Por turnos",
      flexible: "Horario flexible",
    },
    contratacion: {
      relacion_dependencia: "Relación de dependencia",
      freelance: "Freelance",
      temporal: "Temporal",
      pasantia: "Pasantía",
      otro: "Otro",
    },
    alcance: {
      cualquier_pais: "Desde cualquier país",
      paises: "Solo desde:",
      ciudad: "Solo desde:",
      contradictorio: "El aviso dice cosas distintas",
    },
    periodo: { hora: "por hora", mes: "por mes", anio: "por año" },
  },
  /** Estados de la ficha: nunca mueven la página (el esqueleto ocupa el mismo lugar). */
  estados: {
    preparando: "Preparando el resumen…",
    preparandoAyuda: "Lo leemos del aviso. Puede tardar unos segundos.",
    error: "No pudimos preparar el resumen.",
    reintentar: "Reintentar",
    reintentando: "Reintentando…",
    sinTexto: "Pegá la descripción para ver el resumen",
    pegar: "Pegar la descripción",
    tope: "Hoy llegamos al límite de resúmenes. Probá de nuevo mañana: el resto de la app sigue igual.",
  },
  /** «Esto mismo te pasa en N de tus M ofertas» (R31-08). */
  repetido: {
    texto: "Esto mismo te pasa en {n} de tus {m} ofertas",
    textoUna: "Esto mismo te pasa en 1 de tus {m} ofertas",
    boton: "Actualizar {campo}",
    guardar: "Guardar",
    guardando: "Guardando…",
    cancelar: "Cancelar",
    guardado: "Listo. Actualizamos tus ofertas sin volver a leer los avisos.",
    error: "No pudimos guardar. Probá de nuevo; lo que escribiste sigue acá.",
    errorValor: "Revisá el dato: no es un valor válido.",
    modalTitulo: "Actualizar {campo}",
    modalAyuda: "Solo cambia este dato de tu perfil. No volvemos a leer los avisos.",
    etiquetas: {
      ingles: "Tu nivel de inglés",
      anos: "Tus años de experiencia",
      pais: "Tu país (código de 2 letras, por ejemplo AR)",
    },
    ingles: {
      elegir: "Elegí tu nivel",
      A1: "A1 · Principiante",
      A2: "A2 · Básico",
      B1: "B1 · Intermedio",
      B2: "B2 · Intermedio alto",
      C1: "C1 · Avanzado",
      C2: "C2 · Dominio",
    },
    campos: {
      ingles: "mi inglés",
      anos: "mis años de experiencia",
      pais: "mi país",
      residencia: "mi lugar de residencia",
      autorizacion: "mi autorización de trabajo",
      habilidad: "mi nivel en {nombre}",
    },
  },
} as const;

/**
 * Textos de la evaluación con la ficha del aviso (R31-05, R31-10). Lo edita solo `evaluacion`.
 * La pregunta de un toque aparece en las filas «Sin confirmar» de lo que pide el aviso.
 */
export const EVALUACION_TEXTOS = {
  pregunta: {
    /** El informe (S-23) pide un botón de carga en la fila, sin dar el texto; la pregunta Sí, No o En parte es del plan §8. */
    enunciado: "¿Tenés esto?",
    grupo: "Tu respuesta sobre: {pide}",
    si: "Sí",
    no: "No",
    enParte: "En parte",
    notaEtiqueta: "Contanos en qué medida (opcional)",
    guardar: "Guardar",
    guardando: "Guardando…",
    ayuda: "Tu respuesta se guarda en tu perfil y vale para las demás ofertas que pidan lo mismo.",
    respondida: "Tu respuesta: {valor}",
    cambiar: "Cambiar mi respuesta",
    guardado: "Listo. Guardamos tu respuesta.",
    error: "No pudimos guardar. Probá de nuevo; lo que escribiste sigue acá.",
    errorNota: "La nota es demasiado larga. Acortala y probá de nuevo.",
  },
  /** Kit para calibrar la evaluación nueva (R31-10): solo testers y admins, con `JOB_CARD` encendida. */
  calibracion: {
    titulo: "Calibrar la evaluación nueva",
    intro:
      "Estas son ofertas tuyas evaluadas con la versión nueva. Marcá en cada una si la evaluación está bien y, si no, escribí el motivo en pocas palabras. Lo que marques no cambia ningún puntaje.",
    consejoMotivo: "En el motivo no escribas datos personales: ni tuyos ni de otras personas.",
    queMirar: "Qué mirar en cada oferta",
    queMirarItems: [
      "Que la oferta tenga el requisito que la evaluación dice que pide, con la cita del aviso.",
      "Que lo que no coincide sea un dato tuyo y no una suposición.",
      "Que las condiciones del aviso (modalidad, lugar, jornada) estén aparte y no bajen el puntaje.",
      "Que «Muchos candidatos» aparezca solo si el aviso trae el número.",
    ],
    progreso: "Marcaste {x} de {y}",
    resumen: "De acuerdo en {a} y en desacuerdo en {d}.",
    sinOfertas:
      "Todavía no tenés ofertas evaluadas con la versión nueva. Cuando las haya, aparecen acá, entre 20 y 30, variadas.",
    abrir: "Abrir la oferta",
    condiciones: "Condiciones del aviso: {n}",
    sinCondiciones: "Sin condiciones excluyentes",
    exportar: "Exportar lo marcado (CSV)",
    exportarAyuda:
      "Solo para admins. Trae lo que marcaron todas las personas, sin email, nombre ni datos del perfil.",
  },
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

/**
 * Alta y apertura por carrera (R32-01, R32-03, R32-04 y R32-09). Lo edita solo `alta`. Voseo, sin prometer
 * trabajo. `{carrera}`, `{n}` y similares los completa `llenarTexto`: se insertan como texto, nunca como HTML.
 */
export const ALTA_TEXTOS = {
  /** R32-01: recuadro para las cuentas que todavía no cargaron su carrera. Se pide una sola vez. */
  carreraPedida: {
    titulo: "¿Cuál es tu carrera?",
    texto:
      "La usamos para mostrarte primero las ofertas que te sirven. Te la pedimos una sola vez y la podés cambiar cuando quieras en Ajustes.",
    grupo: "Elegí una",
    otra: "Otra",
    otraLabel: "Escribí tu carrera",
    otraAyuda: "Entre 2 y 60 caracteres.",
    guardar: "Guardar mi carrera",
    ahoraNo: "Ahora no",
    guardada: "Listo, guardamos tu carrera.",
    errores: {
      elegir: "Elegí una carrera para guardar.",
      corta: "Escribí tu carrera, con al menos 2 letras.",
      larga: "Tu carrera tiene más de 60 caracteres. Acortala un poco.",
      caracteres: "Usá solo letras, números y signos comunes, sin enlaces.",
      fallo: "No pudimos guardar tu carrera. Probá de nuevo en un rato.",
    },
  },
  /** R32-01: «Otra» en el paso de puestos del alta. */
  carreraOtra: {
    legend: "¿Tu carrera no está en la lista?",
    ayuda:
      "Si ninguno de los puestos es el tuyo, escribí tu carrera acá y no elijas ninguno. Todavía no podemos asegurarte ofertas de carreras que no están en la lista.",
    label: "Mi carrera",
    placeholder: "Por ejemplo, Arquitectura",
    obligatoria: "Elegí al menos un puesto o escribí tu carrera en «Otra».",
    error: "Escribí tu carrera con entre 2 y 60 letras, números o signos comunes, sin enlaces.",
  },
  /** R32-03: lo que ve quien se anota de una carrera que todavía no abrió. */
  esperaCarrera: "Todavía estamos sumando ofertas de {carrera}. Te avisamos por email apenas abra.",
  /** R32-03: pantalla de admin `/admin/carreras`. Informa; la decisión es del responsable. */
  apertura: {
    titulo: "Apertura por carrera",
    intro:
      "Acá decidís qué carreras están abiertas. Nada abre solo: el panel de cobertura informa y el cambio lo hacés vos. Con la lista vacía no se cierra nada a quien ya está adentro, y las altas nuevas quedan en la lista de espera de su carrera.",
    umbral: "Para abrir: al menos {tomables} tomables y {empieza} para quien empieza.",
    carrera: "Carrera",
    estado: "Estado",
    cobertura: "Cobertura",
    abierta: "Abierta",
    cerrada: "Cerrada",
    abrir: "Abrir {carrera}",
    cerrar: "Cerrar {carrera}",
    verCobertura: "Ver el panel de cobertura",
    coberturaFila: "{tomables} tomables · {empieza} para quien empieza",
    sinCobertura: "Sin dato de cobertura",
    semaforo: { verde: "En verde", amarillo: "Cerca", rojo: "En rojo" },
    abiertaDesde: "Abierta desde el {fecha} por {quien}",
    abiertaSinQuien: "Abierta desde el {fecha}",
    historialTitulo: "Quién cambió la lista y cuándo",
    historialVacio: "Todavía no se cambió nada.",
    historialAbrir: "{quien} abrió {carrera} el {fecha}",
    historialCerrar: "{quien} cerró {carrera} el {fecha}",
    quienNinguno: "una cuenta que ya no existe",
    otraAviso:
      "«Otra» nunca abre sola: son personas con una carrera que todavía no está en el catálogo.",
    ok: {
      abierta: "Listo: la carrera quedó abierta.",
      cerrada: "Listo: la carrera quedó cerrada. Quien ya estaba adentro no pierde nada.",
      sin_cambio: "Ya estaba así: no cambió nada.",
    },
    errores: {
      invalida: "Esa carrera no se puede abrir.",
      no_admin: "Tu cuenta no puede administrar las carreras.",
      sin_base: "Tu cuenta es admin en la app pero falta habilitarla en la base (app_admins).",
      fallo: "No se pudo guardar el cambio. Probá de nuevo.",
    },
    noLeyo:
      "No se pudo leer la lista de carreras abiertas. ¿Falta aplicar la migración 0089 y la política 0074?",
  },
  /** R32-04: estado vacío por carrera, cuando hay pocas ofertas. */
  pocasOfertas: {
    titulo: "Hay pocas ofertas de {carreras} en {idioma} esta semana",
    fila: "{carrera}: {n} esta semana",
    texto:
      "Encontramos menos de {umbral}. Para ver más, armá una alerta por email en el portal de tu carrera y reenviala acá, o cargá una oferta que hayas visto.",
    guia: "Ver la guía de alertas, paso a paso",
    cargar: "Cargar una oferta",
    cerrar: "Ahora no",
  },
  /** R32-04: guía de alertas por carrera. Las alertas las arma cada persona; la app no entra a ningún portal. */
  guia: {
    aclaracion:
      "Las alertas las armás vos en cada portal: nosotros no las creamos ni entramos a tu cuenta. Después hacés que esos emails lleguen a tu dirección.",
    carrera: "Para {carrera}",
    palabras: "Palabras para buscar",
    pasoAPaso: "Paso a paso en {portal}",
    llegadas: "Te llegaron {n} ofertas de {portal} en los últimos 30 días.",
    llegadaUna: "Te llegó 1 oferta de {portal} en los últimos 30 días.",
    llegadaNinguna: "Todavía no te llegó ninguna oferta de {portal}.",
    recibir: {
      directa: "Escribís tu dirección como email de la alerta y llegan solas.",
      reenviar:
        "Llegan a tu email y las reenviás a tu dirección (a mano o con los filtros de Gmail).",
      pegar: "Todavía no leemos sus emails: pegá los avisos que te interesen.",
    },
    cuales:
      "Mirá cuál te sirve: si un portal no te trae ofertas, no hace falta mantener esa alerta.",
  },
  /** R32-09: email de novedades, su preferencia en Ajustes y la baja en un clic. */
  novedades: {
    titulo: "Novedades por email",
    texto:
      "Un email, como mucho una vez por semana, con las ofertas nuevas de tu carrera. Si no hay ofertas nuevas, no te escribimos.",
    label: "Quiero recibir el email de novedades",
    guardar: "Guardar",
    guardado: "Listo, guardamos tu preferencia.",
    baja: {
      titulo: "Email de novedades",
      ajustes: "Ir a Ajustes",
      ok: {
        titulo: "Te diste de baja",
        texto:
          "Listo: no te mandamos más el email de novedades. Si fue un error, lo podés volver a prender en Ajustes.",
      },
      invalido: {
        titulo: "El enlace no es válido",
        texto:
          "El enlace de baja está incompleto o no es el que te mandamos. Podés dejar de recibir el email desde Ajustes, en «Novedades por email».",
      },
      error: {
        titulo: "No pudimos darte de baja",
        texto:
          "Probá de nuevo en un rato, o dejá de recibir el email desde Ajustes, en «Novedades por email».",
      },
    },
  },
} as const;

/**
 * Panel de cobertura (R32-02, `/admin/cobertura`). Lo edita solo `cobertura`. Es una pantalla de admin: informa
 * y el responsable decide, nada abre solo.
 */
export const COBERTURA_TEXTOS = {
  titulo: "Cobertura por carrera",
  intro:
    "Cuántas ofertas del pool le sirven hoy a una persona de Argentina, carrera por carrera. Informa; la decisión de abrir una carrera es tuya.",
  definiciones: {
    titulo: "Cómo se cuenta",
    vigente: "Vigente: una fuente mostró el aviso en los últimos 7 días.",
    tomable:
      "Tomable: el aviso acepta Argentina, su región o todo el mundo de forma explícita, o el lugar de trabajo está en Argentina. Si no dice países, no cuenta.",
    paraEmpezar:
      "Para quien empieza: tomable y de nivel trainee, pasante o junior, la misma señal del chip «Para empezar».",
    espanol: "En español: el idioma del aviso es español. Sin dato no cuenta, así que es un piso.",
    varias: "Una oferta con varias carreras cuenta una vez en cada una.",
  },
  umbral: "Para abrir una carrera: al menos {tomables} tomables y {empieza} para quien empieza.",
  semaforo: {
    verde: "Lista para abrir",
    amarillo: "Cerca del umbral",
    rojo: "Todavía no",
  },
  columnas: {
    carrera: "Carrera",
    estado: "Estado",
    vigentes: "Vigentes",
    tomables: "Tomables",
    paraEmpezar: "Para quien empieza",
    espanol: "En español",
    fuentes: "Fuentes",
    tendencia: "Últimos 14 días",
  },
  fuentes: {
    ninguna: "Sin fuentes",
    detalle: "{fuente}: {tomables} tomables de {vigentes}",
  },
  tendencia: {
    resumen: "{nuevas} nuevas en 7 días, {previas} en los 7 anteriores",
    grafico: "Ofertas tomables nuevas por día, de hace 14 días a hoy",
    sinDatos: "Sin datos suficientes: el pool todavía no tiene 14 días de historia.",
  },
  sinDatos: "No se pudo leer la cobertura. Probá de nuevo en un momento.",
  generado: "Calculado el {fecha}.",
  apertura: {
    label: "Cobertura de las carreras de la beta",
    todas: "Las {total} carreras están en verde.",
    algunas: "{verdes} de {total} carreras en verde; faltan: {faltan}.",
    noLeyo: "No se pudo leer la cobertura del pool.",
    todo: "Sumá fuentes para esas carreras y volvé a mirar el panel de cobertura. Abrir una carrera lo decide el responsable.",
  },
} as const;

/**
 * Los dos asistentes del CV (R33-02 a R33-04): el coach de «Tengo CV» (`/cv/coach`) y el chat de «No tengo CV»
 * (`/cv/armar`). Los textos salen del informe de revisión (C-03 a C-20), tal cual, con el glosario del plan.
 * Lo edita solo `asistente`.
 */
export const CV_ASISTENTE_TEXTOS = {
  borrador: {
    aviso:
      "Guardamos un borrador para que no pierdas nada. Nada entra a tu CV hasta que lo confirmes.",
    hay: "Tenés un borrador sin confirmar.",
    retomar: "Retomarlo",
    empezarDeNuevo: "Empezar de nuevo",
    descartando: "Descartando…",
    descartadoError: "No pudimos descartar el borrador. Probá de nuevo en un rato.",
    retomarError: "No pudimos retomar el borrador. Podés empezar de nuevo.",
    volver: "Volver a Tu CV",
    volverAclaracion: "Tu progreso queda guardado como borrador.",
    // «Tu CV»: lo que está en el borrador deja de figurar como faltante y dice que está sin confirmar
    sinConfirmar: "{seccion}: sin confirmar, está en tu borrador",
    secciones: {
      resumen: "Resumen",
      experiencia: "Experiencia",
      estudios: "Estudios",
    },
    coachPendientes: "Tenés {n} propuestas del coach sin confirmar.",
    coachPendientesUna: "Tenés 1 propuesta del coach sin confirmar.",
    coachRetomar: "Retomar propuestas",
  },
  /** Bienvenida (C-13): la honestidad, corta y arriba. */
  bienvenida: {
    honestidad:
      "Vos revisás todo antes de usarlo. Nada entra a tu CV hasta que lo confirmes. La IA no agrega datos que no dijiste. No te asegura pasar ningún filtro.",
    comoFunciona:
      "Te hago preguntas de a una, vos corregís lo que entendí y al final armo un CV legible por ATS (los sistemas que leen CV: sin tablas ni columnas). Son 7 temas: puesto, resumen, experiencia, estudios, habilidades, idiomas y links.",
    empezar: "Empezar",
  },
  /** Botones de cada pregunta (C-06 a C-11). */
  pregunta: {
    etiqueta: "Tu respuesta",
    responder: "Responder y seguir",
    saltear: "Saltear esta pregunta",
    salteaApoyo: "Podés volver a esto más tarde",
    volverAnterior: "Volver a la pregunta anterior",
    escribiYa: "Escribí una respuesta o tocá «Saltear esta pregunta».",
    // C-09: el dictado no envía solo
    dictadoRevisar: "Revisá lo que dijimos y apretá Responder y seguir",
  },
  /** Avance como lista de temas (C-10). */
  avance: {
    titulo: "Avance",
    resumen: "{hechos} de {total} temas",
    temas: {
      puesto: "Puesto",
      resumen: "Resumen profesional",
      experiencia: "Experiencia",
      estudios: "Estudios",
      habilidades: "Habilidades",
      idiomas: "Idiomas",
      links: "Links",
    },
    estados: {
      done: "Hecho",
      current: "Ahora",
      skipped: "Salteado",
      pending: "Pendiente",
    },
    volverAEsto: "Volver a este tema",
  },
  /** «Terminar y armar» (C-08): solo con datos suficientes y con confirmación. */
  terminar: {
    boton: "Terminar y armar",
    pregunta: "Vas a armar tu CV con lo que contaste hasta ahora. Falta: {faltan}. ¿Armarlo igual?",
    preguntaSinFaltantes: "Vas a armar tu CV con lo que contaste hasta ahora. ¿Armarlo igual?",
    seguir: "Seguir respondiendo",
    armar: "Armar ahora",
  },
  /** Resumen profesional en la revisión (C-16 y C-17): un solo bloque, sin «Objetivo» aparte. */
  resumen: {
    titulo: "Resumen profesional",
    ayuda:
      "Es un borrador con lo que contaste, en tus palabras. Editalo como quieras: si lo dejás vacío, queda vacío.",
    etiqueta: "Resumen",
  },
  /** Habilidades blandas por situaciones (C-18 a C-20). */
  blandas: {
    titulo: "Habilidades que contaste",
    intro:
      "Por lo que contaste, estas habilidades podrían ir en tu CV. Entra solo la que vos elijas.",
    origen: "La sugerimos por lo que contaste en {empresa}",
    origenSinEmpresa: "La sugerimos por lo que contaste",
    vineta: "Viñeta que sumaríamos: «{texto}»",
    // Cuando la viñeta no entra, se dice antes del clic: la habilidad entra igual, nunca se omite en silencio
    vinetaSinLugar:
      "Ya tenés 4 tareas en este trabajo: la viñeta no se sumó; podés reemplazar una al revisar. La habilidad entra igual.",
    vinetaSinTrabajo:
      "Todavía no hay una experiencia cargada: la habilidad entra, pero la viñeta no se suma.",
    vinetaYaEsta: "Esa viñeta ya figura en las tareas de este trabajo.",
    usar: "Usarla",
    noGracias: "No, gracias",
    limite: "Como máximo 4 habilidades blandas: no llenamos el CV de adjetivos.",
    elegidas: "Habilidades que elegiste: {lista}",
  },
} as const;
