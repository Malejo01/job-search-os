import { describe, expect, it } from "vitest";
import { inferRoleHints } from "./role-hints";
import type { RoleKey } from "./self-assessment";

/**
 * R28-06: carreras no técnicas con reglas de título deterministas (sin IA). Títulos inventados, en
 * español e inglés: al menos 15 positivos por carrera y negativos de títulos parecidos que no son de ella.
 * La regresión de las carreras técnicas está en `role-hints-regression.test.ts`.
 */
const hints = (title: string): RoleKey[] => inferRoleHints({ sourceKind: "other", title });

type Career = { name: string; roles: RoleKey[]; positives: string[]; negatives: string[] };

const CAREERS: Career[] = [
  {
    name: "abogacía",
    roles: ["abogacia"],
    positives: [
      "Abogado Senior",
      "Abogada Corporativa",
      "Abogado/a Laboralista",
      "Abogado de Empresas",
      "Abogada Junior",
      "Asesor Legal Interno",
      "Asesora Legal",
      "Analista Legal",
      "Gerente Legal",
      "Jefe de Asuntos Legales",
      "Procurador Judicial",
      "Escribano Público",
      "Paralegal",
      "Legal Counsel LatAm",
      "In-House Counsel",
      "General Counsel",
      "Senior Counsel, Corporate",
      "Corporate Attorney",
      "Employment Lawyer",
      "Legal Manager",
      "Head of Legal",
      "Legal Advisor",
      "Compliance Officer, Banca",
    ],
    negatives: [
      "Legal Engineer",
      "Legal Software Developer",
      "Legal Nurse Consultant",
      "Legal Translator",
      "Traductor Legal",
      "Legal Sales Representative",
      "Legal Medical Assistant",
      "Cybersecurity Compliance Officer",
      "Compliance Officer, Pharma",
      "Software Engineer, Legal Tech",
      "Legal Operations Software Specialist",
    ],
  },
  {
    name: "contaduría",
    roles: ["finanzas_contabilidad"],
    positives: [
      "Contador Público",
      "Contadora Senior",
      "Analista Contable",
      "Auxiliar Contable",
      "Asistente Contable Jr",
      "Jefe de Contabilidad",
      "Responsable de Impuestos",
      "Analista Impositivo",
      "Liquidador de Sueldos",
      "Analista de Tesorería",
      "Auditor Interno",
      "Auditora Externa",
      "Analista de Cuentas a Pagar",
      "Analista de Costos",
      "Senior Accountant",
      "Staff Accountant",
      "Accounts Payable Analyst",
      "Accounts Receivable Clerk",
      "Payroll Specialist",
      "Tax Accountant",
      "Tax Manager",
      "Treasury Analyst",
      "Financial Controller",
      "Accounting Manager",
      "FP&A Analyst",
      "External Audit Associate",
    ],
    negatives: [
      "Auditor de Calidad",
      "Auditor de Obra",
      "Quality Auditor",
      "Accounting Software Developer",
      "Billing Engineer",
      "Medical Billing Specialist",
      "Account Executive",
      "Account Director",
      "Accountability Lead",
      "Payroll Software Engineer",
      "Quantitative Financial Analyst",
    ],
  },
  {
    name: "administración",
    roles: ["administracion_empresas"],
    positives: [
      "Analista Administrativo",
      "Analista Administrativa Contable",
      "Jefe de Administración",
      "Responsable Administrativo",
      "Gerente de Administración",
      "Coordinador Administrativo",
      "Administrador de Empresas",
      "Licenciado en Administración",
      "Analista de Compras",
      "Comprador Senior",
      "Jefe de Compras",
      "Analista de Abastecimiento",
      "Analista de Procesos",
      "Analista de Logística",
      "Analista de Control de Gestión",
      "Analista de Estrategia",
      "Pricing Analyst",
      "Procurement Analyst",
      "Purchasing Manager",
      "Buyer",
      "Supply Chain Analyst",
      "Demand Planner",
      "Management Consultant",
      "Administrative Manager",
    ],
    negatives: [
      "Administrador de Sistemas",
      "Administrador de Base de Datos",
      "Analista de Procesos Químicos",
      "Process Improvement Analyst, Plant",
      "Encargado de Local",
      "Jefe de Sucursal",
      "Media Buyer",
      "Pricing Software Engineer",
      "Logistics Software Developer",
      "Business Analyst",
      "Operations Manager",
    ],
  },
  {
    name: "comunicación y RR.PP.",
    roles: ["comunicacion", "relaciones_publicas"],
    positives: [
      "Analista de Comunicación",
      "Jefe de Comunicación",
      "Responsable de Comunicación Interna",
      "Comunicación Institucional",
      "Comunicador Social",
      "Licenciada en Comunicación",
      "Jefa de Prensa",
      "Periodista",
      "Redactor",
      "Editora",
      "Relaciones Públicas",
      "Ejecutivo de RR.PP.",
      "Responsable de RRPP",
      "Relacionista Público",
      "Relaciones Institucionales",
      "Coordinador de Eventos",
      "Organizadora de Eventos Corporativos",
      "Analista de RSE",
      "Communications Manager",
      "Communications Director",
      "Head of Communications",
      "Corporate Communications Specialist",
      "Internal Communications Lead",
      "Public Relations Specialist",
      "PR Account Manager",
      "PR Coordinator",
      "Media Relations Manager",
      "Press Officer",
      "Event Planner",
      "Journalist",
    ],
    negatives: [
      "Telecommunications Engineer",
      "Ingeniero en Telecomunicaciones",
      "Unified Communications Administrator",
      "Técnico en Comunicaciones",
      "Network Communications Developer",
      "Moderador de Contenido",
      "Editor de Video",
      "Code Editor Developer",
      "Reporter SQL",
      "Operario de Prensa Hidráulica",
      "RR.PP. para Boliche",
      "Promotor de Fiestas",
      "Communications Dispatcher 911",
    ],
  },
  {
    name: "relaciones internacionales y comercio exterior",
    roles: ["relaciones_internacionales"],
    positives: [
      "Analista de Comercio Exterior",
      "Jefe de Comercio Exterior",
      "Coordinador de Comex",
      "Asistente de Comex",
      "Analista de Importaciones",
      "Analista de Exportaciones",
      "Auxiliar de Importaciones y Exportaciones",
      "Despachante de Aduana",
      "Relaciones Internacionales",
      "Licenciado en Relaciones Internacionales",
      "Cooperación Internacional",
      "Oficial de Programas",
      "Analista de Políticas Públicas",
      "Asuntos Internacionales",
      "Foreign Trade Specialist",
      "International Trade Analyst",
      "Import Export Specialist",
      "Customs Compliance Analyst",
      "Customs Broker",
      "Trade Compliance Specialist",
      "International Relations Officer",
      "Program Officer",
      "Government Affairs Manager",
      "Public Policy Analyst",
      "Geopolitical Analyst",
    ],
    negatives: [
      "FX Analyst",
      "Foreign Exchange Trader",
      "Trade Marketing Manager",
      "International Sales Manager",
      "Public Policy Analyst, Insurance",
      "Trade Compliance Software Engineer",
      "Customs Software Developer",
      "Relaciones Laborales",
      "Customer Support Internacional",
    ],
  },
  {
    name: "RR.HH.",
    roles: ["rrhh_it"],
    positives: [
      "Analista de RRHH",
      "Analista de Recursos Humanos",
      "Generalista de RRHH",
      "Business Partner RRHH",
      "Reclutador",
      "Reclutadora IT",
      "Analista de Selección",
      "Selección de Personal",
      "Analista de Capacitación",
      "Analista de Compensaciones y Beneficios",
      "Administración de Personal",
      "Jefe de Personal",
      "Responsable de Gente y Cultura",
      "Capital Humano",
      "Desarrollo Organizacional",
      "HR Generalist",
      "HR Business Partner",
      "HR Manager",
      "Recruiter",
      "Talent Acquisition Specialist",
      "People and Culture Manager",
      "People Operations Coordinator",
      "Learning and Development Specialist",
      "Compensation and Benefits Analyst",
      "Head of People",
      "Headhunter",
    ],
    negatives: [
      "Human Resources Software Engineer",
      "HR Software Developer",
      "Desarrollador de Recursos Humanos",
      "Shrink Analyst",
      "Resource Manager, Cloud",
    ],
  },
  {
    name: "marketing",
    roles: ["marketing_digital"],
    positives: [
      "Marketing Manager",
      "Marketing Analyst",
      "Marketing Coordinator",
      "Marketing Specialist",
      "Marketing Assistant",
      "Marketing Director",
      "Head of Marketing",
      "Growth Marketing Manager",
      "Digital Marketing Specialist",
      "Brand Manager",
      "Performance Marketing Lead",
      "Content Marketing Manager",
      "Gerente de Marketing",
      "Analista de Marketing",
      "Coordinador de Marketing",
      "Jefa de Marketing",
      "Asistente de Marketing",
      "Responsable de Marketing",
      "Especialista en Marketing Digital",
      "Director de Marketing",
      "Community Manager",
      "Especialista SEO",
      "Analista de Redes Sociales",
      "Media Planner",
    ],
    negatives: [
      "Telemarketing Agent",
      "Telemarketer",
      "Marketing Engineer",
      "Marketing Software Developer",
      "Ingeniero de Marketing Automation",
      "Network Marketing Distributor",
      "Brand Ambassador",
      "Supermarket Manager",
      "Marketplace Manager",
      "Stock Market Analyst",
    ],
  },
  {
    name: "atención al cliente",
    roles: ["atencion_cliente"],
    positives: [
      "Atención al Cliente",
      "Agente de Atención al Cliente",
      "Asesor de Atención al Cliente",
      "Ejecutivo de Atención al Cliente",
      "Asesora de Atención",
      "Servicio al Cliente",
      "Representante de Servicio al Cliente",
      "Soporte al Cliente",
      "Teleoperador",
      "Operadora Telefónica",
      "Operador de Call Center",
      "Supervisor de Call Center",
      "Atención al Público",
      "Atención a Clientes",
      "Agente de Chat",
      "Customer Service Representative",
      "Customer Support Specialist",
      "Customer Care Agent",
      "Customer Service Associate",
      "Customer Experience Agent",
      "Client Services Representative",
      "Support Agent, Spanish",
      "Contact Center Agent",
      "Customer Support Manager",
    ],
    negatives: [
      "Customer Success Engineer",
      "Customer Success Manager",
      "Customer Support Engineer",
      "Technical Customer Support",
      "Soporte Técnico al Cliente",
      "IT Help Desk",
      "Customer Service Software Developer",
      "Customer Service Data Analyst",
      "Account Executive",
    ],
  },
];

describe.each(CAREERS)("carreras no técnicas · $name", (career) => {
  it("tiene al menos 15 positivos y negativos propios", () => {
    expect(career.positives.length).toBeGreaterThanOrEqual(15);
    expect(career.negatives.length).toBeGreaterThanOrEqual(5);
  });

  it.each(career.positives)("positivo: %s", (title) => {
    const found = hints(title);
    expect(
      career.roles.some((r) => found.includes(r)),
      `${title} -> ${found.join(",")}`,
    ).toBe(true);
  });

  it.each(career.negatives)("negativo: %s", (title) => {
    const found = hints(title);
    expect(
      career.roles.filter((r) => found.includes(r)),
      `${title} -> ${found.join(",")}`,
    ).toEqual([]);
  });
});

describe("carreras no técnicas · casos de borde entre carreras", () => {
  it("Product Marketing Manager es product_marketing, no marketing digital", () => {
    expect(hints("Product Marketing Manager")).toEqual(["product_marketing"]);
    expect(hints("Gerente de Marketing de Producto")).toEqual(["product_marketing"]);
  });

  it("Customer Success Engineer no es atención al cliente", () => {
    expect(hints("Customer Success Engineer")).toEqual(["customer_success"]);
  });

  it("Legal Engineer y Compliance Officer de seguridad no son abogacía", () => {
    expect(hints("Legal Engineer")).toEqual([]);
    expect(hints("Security Compliance Officer")).toEqual([]);
  });

  it("un RR.PP. de boliche no es de ninguna carrera de comunicación", () => {
    const h = hints("RR.PP. para Boliche");
    expect(h).not.toContain("relaciones_publicas");
    expect(h).not.toContain("comunicacion");
  });

  it("el recruiter técnico sigue siendo RR.HH. de IT", () => {
    expect(hints("Technical Recruiter")).toEqual(["rrhh_it"]);
  });
});
