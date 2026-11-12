/**
 * Textos públicos clave para que Ani los lea en un solo lugar (C8-18, `/settings/textos`). Cada entrada
 * dice qué es, un extracto **literal** del texto, en qué archivo vive (para pedir el cambio con un PR
 * chico), dónde verlo en la app y, si hace falta, qué tiene que decidir. Un test verifica que cada
 * extracto siga existiendo en su archivo: si alguien cambia el texto, el test avisa.
 */
export type TextoAni = {
  area: string;
  nombre: string;
  /** Copia literal de un pedazo del texto (o null si se arma en código, ver `archivo`). */
  extracto: string | null;
  /** Ruta desde la raíz del repo. */
  archivo: string;
  /** Página donde se ve; null si no se ve en una página (emails). */
  verEn: string | null;
  /** Lo que Ani tiene que decidir, si hay algo. */
  decidir?: string;
};

export const TEXTOS_ANI: readonly TextoAni[] = [
  {
    area: "Portada",
    nombre: "Titular",
    extracto: "Las ofertas que te quedan bien, con el porqué.",
    archivo: "apps/web/app/(public)/page.tsx",
    verEn: "/",
  },
  {
    area: "Portada",
    nombre: "Bajada",
    extracto: "Leemos cada aviso contra tu perfil y te decimos qué tan afín es",
    archivo: "apps/web/app/(public)/page.tsx",
    verEn: "/",
  },
  {
    area: "/acceso",
    nombre: "Bajada de la cabecera",
    extracto: "Para estudiantes y recién recibidos de 8 carreras. Abrimos el 26 de noviembre.",
    archivo: "apps/web/app/(public)/acceso/page.tsx",
    verEn: "/acceso",
  },
  {
    area: "/acceso",
    nombre: "Confirmación al anotarse",
    extracto: "te escribimos si hay lugar, con el link para crear tu cuenta.",
    archivo: "apps/web/app/(public)/acceso/actions.ts",
    verEn: "/acceso",
    decidir: "¿Se entiende que el cupo es limitado?",
  },
  {
    area: "/acceso",
    nombre: "«Qué sigue» después de anotarse",
    extracto: "Revisamos los pedidos y armamos el grupo de la beta, con lugar para cada carrera.",
    archivo: "apps/web/app/(public)/acceso/waitlist-form.tsx",
    verEn: "/acceso",
  },
  {
    area: "/acceso",
    nombre: "Texto para compartir",
    extracto: "lee ofertas de trabajo contra tu perfil y te dice por qué sí y por qué no.",
    archivo: "apps/web/app/(public)/acceso/share-button.tsx",
    verEn: "/acceso",
  },
  {
    area: "/precios",
    nombre: "Descripción de la página",
    extracto: "El link de pago llega con la invitación.",
    archivo: "apps/web/app/(public)/precios/page.tsx",
    verEn: "/precios",
    decidir: "Solo se ve con PRICING_ENABLED=1. ¿El precio se muestra o va solo en la invitación?",
  },
  {
    area: "/ayuda",
    nombre: "¿Cuánto cuesta?",
    extracto: "La beta es por invitación y se usa con el Plan Beta, que es pago, mes a mes.",
    archivo: "apps/web/app/(public)/ayuda/page.tsx",
    verEn: "/ayuda",
  },
  {
    area: "/ayuda",
    nombre: "Lista de preguntas",
    extracto: "¿Necesito conocimientos técnicos o saber de programación?",
    archivo: "apps/web/app/(public)/ayuda/page.tsx",
    verEn: "/ayuda",
    decidir:
      "¿Faltan preguntas de las carreras no tech (trabajos presenciales en Salta, datos, cancelar)?",
  },
  {
    area: "Onboarding",
    nombre: "Piso salarial (paso 1)",
    extracto: "Piso salarial mensual en USD (opcional)",
    archivo: "apps/web/components/profile-form.tsx",
    verEn: "/onboarding",
    decidir:
      "Para abogacía o contaduría en Salta el sueldo es en pesos y el campo trabaja en USD. ¿Lo dejamos, lo escondemos para esas carreras o se pasa a pesos (cambio grande)? (R-2 de C7)",
  },
  {
    area: "Onboarding",
    nombre: "«Skills» (paso 2, menú y Ajustes)",
    extracto: "Tus skills agregadas",
    archivo: "apps/web/app/(app)/settings/skills/skills-form.tsx",
    verEn: "/settings/skills",
    decidir: "¿«Conocimientos» o «Habilidades» en vez de «skills»? Es un PR propio. (R-2 de C7)",
  },
  {
    area: "Onboarding",
    nombre: "Alertas por email (paso 3)",
    extracto: "Sumá tus alertas de LinkedIn, Get on Board e Indeed",
    archivo: "apps/web/app/onboarding/ofertas/page.tsx",
    verEn: "/onboarding/ofertas",
    decidir:
      "Get on Board es de tecnología; para estas carreras pesan Computrabajo, ZonaJobs o Bumeran, pero hoy el lector reconoce LinkedIn, Indeed y Get on Board. ¿Lo sacamos del título? (R-2 de C7)",
  },
  {
    area: "Estados vacíos",
    nombre: "Ofertas sin nada todavía",
    extracto: "Todavía no tenés ofertas",
    archivo: "apps/web/app/(app)/jobs/page.tsx",
    verEn: "/jobs",
  },
  {
    area: "Hoy",
    nombre: "«Empezá acá» (C8-5)",
    extracto: "Pegá una oferta o esperá las nuestras",
    archivo: "packages/pipeline/src/start-here.ts",
    verEn: "/hoy",
  },
  {
    area: "Ayuda en contexto (C8-6)",
    nombre: "Las 5 explicaciones de «¿Qué es esto?»",
    extracto: "Es un número del 0 al 10 que dice qué tan cerca está la oferta de tu perfil.",
    archivo: "packages/pipeline/src/help/ayuda-en-contexto.ts",
    verEn: "/settings/textos",
    decidir: "La del puntaje da umbrales («un 8 o más suele valer la pena»): ¿los dejamos?",
  },
  {
    area: "Emails",
    nombre: "Bienvenida al activar el plan (C8-7)",
    extracto: "Ya tenés tu lugar en la Beta de",
    archivo: "packages/pipeline/src/welcome-email.ts",
    verEn: "/settings/marca",
  },
  {
    area: "Emails",
    nombre: "Aviso de vencimiento del plan",
    extracto: "Si querés seguir con el plan completo, pagá el mes con Mercado Pago:",
    archivo: "packages/pipeline/src/plan-expiry-notice.ts",
    verEn: null,
  },
  {
    area: "Invitación",
    nombre: "Mensaje con el precio y el link de pago",
    extracto: null,
    archivo: "apps/web/app/(app)/settings/invitations/actions.ts",
    verEn: "/settings/invitations",
    decidir: "Texto del pago y de becados (C7-12): lo armó la nube, falta el OK de Ani.",
  },
];
