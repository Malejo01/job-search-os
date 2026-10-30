import { hasTerm, normalizeTitleText } from "./role-hints";
import type { RoleKey } from "./self-assessment";

/**
 * Chips de especialidad de las carreras de la beta (ADR-027). Cada carrera se parte en
 * subespecialidades que la persona marca para acotar los avisos de su carrera: los chips no crean
 * carreras ni claves nuevas. Puro: solo mira el título.
 *
 * Invariante (lo vigila `specialties.test.ts`): la unión de los `terms` de los chips de una carrera es
 * exactamente `TITLE_TERMS[role]`. Así un término nuevo del título no queda sin chip, y un chip no
 * promete un título que la carrera no reconoce. Un término puede estar en más de un chip. Un chip sin
 * `terms` se elige por otra señal (el sector público o el tipo de organización no se leen del título).
 */
export type RoleSpecialty = {
  /** snake_case, estable: es lo que se guarda en el perfil. */
  id: string;
  /** Lo que ve la persona. */
  label: string;
  /** Frases del título, ya sin acentos ni mayúsculas, con las reglas de `hasTerm`. */
  terms: readonly string[];
};

const chip = (id: string, label: string, terms: readonly string[] = []): RoleSpecialty => ({
  id,
  label,
  terms,
});

export const ROLE_SPECIALTIES: Partial<Record<RoleKey, readonly RoleSpecialty[]>> = {
  finanzas_contabilidad: [
    chip("impuestos", "Impuestos", [
      "analista impositivo",
      "tax analyst",
      "tax associate",
      "tax specialist",
      "impuestos",
      "impositivo",
      "impositiva",
    ]),
    chip("sueldos", "Sueldos", [
      "payroll",
      "nomina",
      "liquidacion de sueldos",
      "liquidador de sueldos",
      "liquidadora de sueldos",
      "analista de sueldos",
      "liquidacion de haberes",
    ]),
    chip("contabilidad_y_balances", "Contabilidad y balances", [
      "accountant",
      "accounting",
      "bookkeeper",
      "bookkeeping",
      "billing specialist",
      "billing analyst",
      "financial controller",
      "assistant controller",
      "contador",
      "contadora",
      "contable",
      "contabilidad",
      "facturacion",
    ]),
    chip("auditoria", "Auditoría", [
      "auditor",
      "auditora",
      "auditoria",
      "internal audit",
      "control interno",
    ]),
    chip("costos", "Costos", ["analista de costos"]),
    // Los títulos genéricos de finanzas (financial analyst, finanzas...) caen acá porque no hay un chip
    // «general»; no prometen FP&A.
    chip("presupuesto_y_control_de_gestion", "Presupuesto y control de gestión", [
      "fp a",
      "financial planning",
      "financial analyst",
      "finance analyst",
      "finance associate",
      "finance specialist",
      "finance coordinator",
      "finance assistant",
      "finance operations",
      "financial operations",
      "analista financiero",
      "analista financiera",
      "analista de finanzas",
      "finanzas",
      "control de gestion",
    ]),
    // Pagos y cobranzas: cuentas a pagar y a cobrar. Facturación queda en contabilidad.
    chip("tesoreria_pagos_y_cobranzas", "Tesorería, pagos y cobranzas", [
      "treasury",
      "tesoreria",
      "accounts payable",
      "accounts receivable",
      "ap specialist",
      "ar specialist",
      "ap clerk",
      "ap ar",
      "cuentas por pagar",
      "cuentas por cobrar",
      "creditos y cobranzas",
      "cuentas corrientes",
    ]),
    chip("prevencion_de_lavado_y_compliance", "Prevención de lavado y compliance", ["aml analyst"]),
    chip("concursos_y_pericias_judiciales", "Concursos y pericias judiciales", ["perito contable"]),
    chip("sector_publico", "Sector público"),
  ],
  abogacia: [
    // Los títulos genéricos (abogado, asesor legal, paralegal) caen en el primer chip.
    chip("empresas_y_contratos", "Empresas y contratos", [
      "abogado",
      "abogada",
      "asesor legal",
      "asesora legal",
      "analista legal",
      "paralegal",
      "asistente legal",
      "legal counsel",
      "corporate counsel",
      "legal analyst",
      "contracts counsel",
      "contract manager",
      "analista de contratos",
      "legal operations",
    ]),
    chip("laboral", "Laboral"),
    chip("impuestos", "Impuestos"),
    chip("juicios_y_tribunales", "Juicios y tribunales", ["procurador", "procuradora"]),
    chip("penal", "Penal"),
    chip("familia_y_sucesiones", "Familia y sucesiones"),
    chip("cumplimiento_y_prevencion_de_lavado", "Cumplimiento y prevención de lavado", [
      "compliance officer",
      "oficial de cumplimiento",
    ]),
    chip("marcas_patentes_y_datos_personales", "Marcas, patentes y datos personales", [
      "privacy counsel",
      "ip associate",
      "trademark paralegal",
    ]),
    chip("sector_publico", "Sector público"),
    chip("inmobiliario_y_registral", "Inmobiliario y registral"),
    chip("internacional_e_inmigracion", "Internacional e inmigración"),
  ],
  administracion_empresas: [
    chip("administracion_general", "Administración general", [
      "analista administrativo",
      "analista administrativa",
      "jefe de administracion",
      "jefa de administracion",
      "responsable administrativo",
      "responsable administrativa",
    ]),
    chip("presupuesto_y_control_de_gestion", "Presupuesto y control de gestión", [
      "analista de control de gestion",
    ]),
    chip("compras", "Compras", [
      "comprador",
      "compradora",
      "analista de compras",
      "buyer",
      "procurement analyst",
    ]),
    chip("logistica_y_cadena_de_suministro", "Logística y cadena de suministro", [
      "analista de logistica",
      "supply chain analyst",
      "demand planner",
    ]),
    chip("procesos_y_mejora_continua", "Procesos y mejora continua", [
      "analista de procesos",
      "process improvement analyst",
    ]),
    chip("comercial_y_precios", "Comercial y precios", ["analista comercial", "pricing analyst"]),
    chip("finanzas_de_la_empresa", "Finanzas de la empresa"),
    chip("personas_rrhh", "Personas (RRHH)"),
    chip("estrategia_y_consultoria", "Estrategia y consultoría", [
      "analista de estrategia",
      "management consultant",
    ]),
    chip("sector_publico", "Sector público"),
  ],
  comunicacion: [
    chip("comunicacion_institucional", "Comunicación institucional", [
      "analista de comunicacion",
      "comunicacion institucional",
      "communications specialist",
      "communications coordinator",
      "communications officer",
    ]),
    chip("comunicacion_interna", "Comunicación interna", [
      "comunicacion interna",
      "internal communications",
    ]),
    chip("prensa_y_medios", "Prensa y medios", [
      "jefe de prensa",
      "jefa de prensa",
      "responsable de prensa",
      "agente de prensa",
      "press officer",
      "media relations",
    ]),
    chip("periodismo", "Periodismo", [
      "periodista",
      "productor periodistico",
      "productora periodistica",
      "journalist",
      "reporter",
      "editor",
      "editora",
    ]),
    chip("redaccion_y_contenidos", "Redacción y contenidos", [
      "redactor",
      "redactora",
      "content writer",
      "content editor",
      "ux writer",
    ]),
    chip("comunicacion_politica_y_de_gobierno", "Comunicación política y de gobierno"),
    chip("ong_y_comunidad", "ONG y comunidad"),
    chip("audiovisual_y_radio", "Audiovisual y radio"),
    chip("opinion_publica", "Opinión pública"),
  ],
  marketing_digital: [
    chip("marketing_digital_y_anuncios", "Marketing digital y anuncios", [
      "marketing digital",
      "digital marketing",
      "seo",
      "sem",
      "performance marketing",
      "growth marketing",
      "paid media",
      "media buyer",
      "trafficker",
      "email marketing",
    ]),
    chip("redes_y_contenidos", "Redes y contenidos", [
      "community manager",
      "social media",
      "content marketing",
      "copywriter",
      "content creator",
      "content writer",
      "content producer",
      "content specialist",
      "redactor",
      "redactora",
      "graphic designer",
      "disenador grafico",
      "disenadora grafica",
      "video editor",
      "editor de video",
      "editora de video",
      "motion graphics",
      "motion designer",
      "creador de contenido",
      "creadora de contenido",
    ]),
    chip("marca", "Marca", ["brand manager", "assistant brand manager", "asistente de marca"]),
    chip("trade_marketing_y_puntos_de_venta", "Trade marketing y puntos de venta", [
      "trade marketing",
    ]),
    chip("investigacion_de_mercado", "Investigación de mercado", [
      "market research analyst",
      "insights analyst",
      "analista de investigacion de mercado",
    ]),
    chip("crm_y_ecommerce", "CRM y e-commerce", [
      "email marketing",
      "crm specialist",
      "analista de crm",
    ]),
    chip("agencia_y_medios", "Agencia y medios", [
      "media planner",
      "planificador de medios",
      "planificadora de medios",
    ]),
    chip("prensa", "Prensa", [
      "relaciones publicas",
      "public relations",
      "ejecutivo de rrpp",
      "ejecutiva de rrpp",
      "ejecutivo de rr pp",
      "ejecutiva de rr pp",
      "relacionista publico",
      "relacionista publica",
      "pr specialist",
      "pr executive",
    ]),
    chip("eventos_y_ceremonial", "Eventos y ceremonial", [
      "organizador de eventos",
      "organizadora de eventos",
      "events coordinator",
      "event coordinator",
    ]),
    chip("relaciones_institucionales", "Relaciones institucionales", [
      "public affairs",
      "relaciones institucionales",
    ]),
    chip("rse_y_sustentabilidad", "RSE y sustentabilidad", ["analista de rse", "csr analyst"]),
  ],
};

/** Los chips de la carrera, en el orden en que se muestran; vacío si la carrera no tiene. */
export function specialtiesFor(role: RoleKey): readonly RoleSpecialty[] {
  return ROLE_SPECIALTIES[role] ?? [];
}

/** Los términos de título de los chips pedidos, sin repetir. Los ids que no existen se ignoran. */
export function termsForSpecialties(role: RoleKey, ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const terms = specialtiesFor(role)
    .filter((c) => wanted.has(c.id))
    .flatMap((c) => c.terms);
  return [...new Set(terms)];
}

/**
 * Ids de los chips de la carrera que el título nombra, en el orden del catálogo. No aplica las
 * exclusiones de la carrera (`matchesRoleTitle`): quien llama ya decidió que el título es de la carrera.
 */
export function specialtyIdsForTitle(title: string, role: RoleKey): string[] {
  const padded = normalizeTitleText(title);
  return specialtiesFor(role)
    .filter((c) => c.terms.some((t) => hasTerm(padded, t)))
    .map((c) => c.id);
}
