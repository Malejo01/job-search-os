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
  /** Ejemplos de puesto en lenguaje simple (2 o 3 por especialidad). */
  examples?: readonly string[];
  /** Áreas que casi no se publican («te avisamos si aparece»). */
  rare?: boolean;
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
      "legal assistant",
      "attorney",
      "lawyer",
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
      "communications manager",
      "comunicacion corporativa",
      "corporate communications",
      "jefe de comunicacion",
      "jefa de comunicacion",
      "responsable de comunicacion",
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
      "pr manager",
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
  relaciones_internacionales: [
    chip("comercio_exterior", "Comercio exterior", [
      "analista de comercio exterior",
      "asistente de comex",
      "comercio exterior",
      "analista de importaciones",
      "analista de exportaciones",
      "foreign trade",
      "import export specialist",
      "customs compliance",
      "analista de comex",
      "despachante de aduana",
      "importaciones y exportaciones",
    ]),
    chip("cooperacion_internacional_y_ong", "Cooperación internacional y ONG", [
      "oficial de programas",
      "program officer",
      "programme associate",
      "grants officer",
      "partnerships officer",
      "cooperacion internacional",
    ]),
    chip("organismos_internacionales", "Organismos internacionales"),
    chip(
      "relaciones_institucionales_y_asuntos_publicos",
      "Relaciones institucionales y asuntos públicos",
      [
        "relaciones institucionales",
        "public affairs",
        "government affairs",
        "public policy analyst",
      ],
    ),
    chip("analisis_politico_y_riesgo", "Análisis político y riesgo", [
      "political risk analyst",
      "geopolitical analyst",
    ]),
    chip("integracion_y_negociaciones", "Integración y negociaciones"),
    chip("migraciones_y_movilidad", "Migraciones y movilidad", ["global mobility"]),
    chip("diplomacia", "Diplomacia"),
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
      "pr manager",
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

/**
 * Metadatos para la UI de cada especialidad (R2-2): 2 o 3 ejemplos de puesto en lenguaje simple
 * y marca de áreas que casi no se publican («te avisamos si aparece»).
 */
export const SPECIALTY_METADATA: Readonly<
  Record<string, { readonly examples: readonly string[]; readonly rare?: boolean }>
> = {
  // finanzas_contabilidad
  "finanzas_contabilidad:impuestos": {
    examples: ["analista impositivo/a", "tax analyst", "especialista en impuestos"],
  },
  "finanzas_contabilidad:sueldos": {
    examples: ["liquidador/a de sueldos", "payroll", "analista de nómina"],
  },
  "finanzas_contabilidad:contabilidad_y_balances": {
    examples: ["contador/a", "analista contable", "facturación"],
  },
  "finanzas_contabilidad:auditoria": {
    examples: ["auditor/a interno/a", "control interno", "auditor/a contable"],
  },
  "finanzas_contabilidad:costos": {
    examples: ["analista de costos", "control de costos"],
  },
  "finanzas_contabilidad:presupuesto_y_control_de_gestion": {
    examples: ["analista financiero/a", "control de gestión", "planeamiento financiero"],
  },
  "finanzas_contabilidad:tesoreria_pagos_y_cobranzas": {
    examples: ["analista de tesorería", "cuentas por pagar", "cobranzas"],
  },
  "finanzas_contabilidad:prevencion_de_lavado_y_compliance": {
    examples: ["analista de compliance", "prevención de lavado", "AML"],
  },
  "finanzas_contabilidad:concursos_y_pericias_judiciales": {
    examples: ["perito contable", "auxiliar de justicia"],
    rare: true,
  },
  "finanzas_contabilidad:sector_publico": {
    examples: ["administración pública", "contabilidad gubernamental"],
  },

  // abogacia
  "abogacia:empresas_y_contratos": {
    examples: ["abogado/a corporativo/a", "analista de contratos", "asesor/a legal"],
  },
  "abogacia:laboral": {
    examples: ["abogado/a laboralista", "asesor/a en derecho laboral"],
  },
  "abogacia:impuestos": {
    examples: ["abogado/a tributarista", "asesor/a fiscal"],
  },
  "abogacia:juicios_y_tribunales": {
    examples: ["abogado/a litigante", "procurador/a"],
  },
  "abogacia:penal": {
    examples: ["abogado/a penalista", "asesor/a legal penal"],
  },
  "abogacia:familia_y_sucesiones": {
    examples: ["derecho de familia", "sucesiones", "divorcios"],
    rare: true,
  },
  "abogacia:cumplimiento_y_prevencion_de_lavado": {
    examples: ["compliance officer", "oficial de cumplimiento", "prevención de lavado"],
  },
  "abogacia:marcas_patentes_y_datos_personales": {
    examples: ["abogado/a de marcas y patentes", "privacidad y datos personales"],
  },
  "abogacia:sector_publico": {
    examples: ["abogado/a en sector público", "asesor/a legal en organismos"],
  },
  "abogacia:inmobiliario_y_registral": {
    examples: ["derecho inmobiliario", "contratos de locación", "trámites registrales"],
  },
  "abogacia:internacional_e_inmigracion": {
    examples: ["derecho internacional", "trámites migratorios y visas"],
  },

  // administracion_empresas
  "administracion_empresas:administracion_general": {
    examples: [
      "analista administrativo/a",
      "jefe/a de administración",
      "coordinador/a administrativo/a",
    ],
  },
  "administracion_empresas:presupuesto_y_control_de_gestion": {
    examples: ["control de gestión", "analista de presupuesto", "planeamiento operativo"],
  },
  "administracion_empresas:compras": {
    examples: ["analista de compras", "comprador/a", "procurement analyst"],
  },
  "administracion_empresas:logistica_y_cadena_de_suministro": {
    examples: ["analista de logística", "supply chain analyst", "planificador/a de demanda"],
  },
  "administracion_empresas:procesos_y_mejora_continua": {
    examples: ["analista de procesos", "mejora continua", "eficiencia operativa"],
  },
  "administracion_empresas:comercial_y_precios": {
    examples: ["analista comercial", "analista de pricing", "gestión comercial"],
  },
  "administracion_empresas:finanzas_de_la_empresa": {
    examples: ["finanzas corporativas", "tesorería operativa", "análisis financiero"],
  },
  "administracion_empresas:personas_rrhh": {
    examples: ["administración de personal", "analista de recursos humanos"],
  },
  "administracion_empresas:estrategia_y_consultoria": {
    examples: ["analista de estrategia", "consultor/a de negocios"],
  },
  "administracion_empresas:sector_publico": {
    examples: ["gestión pública", "administración gubernamental"],
  },

  // comunicacion
  "comunicacion:comunicacion_institucional": {
    examples: [
      "responsable de comunicación",
      "comunicación corporativa",
      "asuntos institucionales",
    ],
  },
  "comunicacion:comunicacion_interna": {
    examples: ["comunicación interna", "clima y cultura laboral", "canales internos"],
  },
  "comunicacion:prensa_y_medios": {
    examples: ["jefe/a de prensa", "relaciones con medios", "vocero/a de prensa"],
  },
  "comunicacion:periodismo": {
    examples: ["periodista", "redactor/a de noticias", "producción periodística"],
  },
  "comunicacion:redaccion_y_contenidos": {
    examples: ["redactor/a de contenidos", "copywriter", "editor/a de contenidos"],
  },
  "comunicacion:comunicacion_politica_y_de_gobierno": {
    examples: ["comunicación de gobierno", "vocería política", "campañas de comunicación"],
  },
  "comunicacion:ong_y_comunidad": {
    examples: ["comunicación comunitaria", "proyectos sociales", "relaciones con la comunidad"],
  },
  "comunicacion:audiovisual_y_radio": {
    examples: ["producción audiovisual", "edición de podcast", "contenidos multimedia"],
  },
  "comunicacion:opinion_publica": {
    examples: ["analista de opinión pública", "estudios de opinión", "investigación social"],
  },

  // relaciones_internacionales
  "relaciones_internacionales:comercio_exterior": {
    examples: ["analista de comercio exterior", "asistente de comex", "despachante de aduana"],
  },
  "relaciones_internacionales:cooperacion_internacional_y_ong": {
    examples: [
      "oficial de programas internacionales",
      "gestión de convenios",
      "cooperación técnica",
    ],
  },
  "relaciones_internacionales:organismos_internacionales": {
    examples: ["analista en organismos internacionales", "relaciones multilaterales"],
  },
  "relaciones_internacionales:relaciones_institucionales_y_asuntos_publicos": {
    examples: ["relaciones institucionales", "asuntos públicos", "government affairs"],
  },
  "relaciones_internacionales:analisis_politico_y_riesgo": {
    examples: ["analista de riesgo político", "análisis geopolítico", "análisis de coyuntura"],
  },
  "relaciones_internacionales:integracion_y_negociaciones": {
    examples: ["negociaciones internacionales", "acuerdos comerciales"],
  },
  "relaciones_internacionales:migraciones_y_movilidad": {
    examples: ["movilidad global", "gestión de visados", "relocalización internacional"],
  },
  "relaciones_internacionales:diplomacia": {
    examples: ["carrera diplomática", "cancillería", "representación exterior"],
    rare: true,
  },

  // marketing_digital
  "marketing_digital:marketing_digital_y_anuncios": {
    examples: ["especialista en marketing digital", "paid media", "analista SEO y SEM"],
  },
  "marketing_digital:redes_y_contenidos": {
    examples: ["community manager", "creador/a de contenido", "social media analyst"],
  },
  "marketing_digital:marca": {
    examples: ["brand manager", "asistente de marca", "gestión de marca"],
  },
  "marketing_digital:trade_marketing_y_puntos_de_venta": {
    examples: ["analista de trade marketing", "promociones en punto de venta"],
  },
  "marketing_digital:investigacion_de_mercado": {
    examples: ["analista de investigación de mercado", "insights del consumidor"],
  },
  "marketing_digital:crm_y_ecommerce": {
    examples: ["especialista en CRM", "email marketing", "analista de ecommerce"],
  },
  "marketing_digital:agencia_y_medios": {
    examples: ["planificador/a de medios", "ejecutivo/a de cuentas en agencia"],
  },
  "marketing_digital:prensa": {
    examples: ["relaciones públicas", "PR specialist", "prensa y difusión"],
  },
  "marketing_digital:eventos_y_ceremonial": {
    examples: ["organizador/a de eventos", "coordinador/a de eventos y congresos"],
  },
  "marketing_digital:relaciones_institucionales": {
    examples: ["relaciones institucionales", "asuntos corporativos"],
  },
  "marketing_digital:rse_y_sustentabilidad": {
    examples: ["analista de sustentabilidad", "responsabilidad social empresaria"],
  },
};

/** Los chips de la carrera, en el orden en que se muestran; vacío si la carrera no tiene. */
export function specialtiesFor(role: RoleKey): readonly RoleSpecialty[] {
  const list = ROLE_SPECIALTIES[role] ?? [];
  return list.map((c) => {
    const meta = SPECIALTY_METADATA[`${role}:${c.id}`];
    return {
      ...c,
      examples: meta?.examples ?? [],
      ...(meta?.rare ? { rare: true } : {}),
    };
  });
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
