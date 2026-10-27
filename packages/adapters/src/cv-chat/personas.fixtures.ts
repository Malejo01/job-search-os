import type { CvTopicKind } from "@job-search-os/pipeline";

/**
 * Seis personas inventadas, de carreras distintas, con las respuestas guionadas de una entrevista completa
 * (C-25, CVC-6). Todo ficticio: empresas «A…», sin nombres reales. Cada tema tiene una lista de respuestas
 * que se consumen en orden (los temas de experiencia se repiten por trabajo); lo que no tiene respuesta se
 * contesta «no».
 */
export type Persona = {
  id: string;
  career: string;
  answers: Partial<Record<CvTopicKind, string[]>>;
};

export const PERSONAS: Persona[] = [
  {
    id: "datos",
    career: "Análisis de datos",
    answers: {
      target: ["Analista de datos semi senior"],
      organization: ["Empresa A", "Empresa B"],
      title: ["Analista de datos", "Asistente de reportes"],
      dates: ["03/2021 - actual", "2018 - 2021"],
      duties: [
        "Armo reportes en SQL y Power BI para 12 sucursales; automatizo el cierre mensual con Python; coordino pedidos de datos con el área comercial",
        "Cargaba datos de ventas en Excel y armaba tableros semanales para la gerencia",
      ],
      achievement: ["Bajé el tiempo de cierre mensual de 5 a 3 días", "no"],
      more_work: ["sí", "no"],
      education: ["Universidad A, Licenciatura en Estadística, 2013 - 2018"],
      certifications: ["Plataforma A, Curso de Power BI, 2022"],
      skills: ["SQL, Python, Power BI, Excel, Pandas"],
      languages: ["Inglés B2, Portugués básico"],
      links: ["https://github.example.test/persona-datos"],
    },
  },
  {
    id: "ventas",
    career: "Ventas",
    answers: {
      target: ["Ejecutiva de cuentas B2B"],
      organization: ["Empresa C"],
      title: ["Ejecutiva comercial"],
      dates: ["06/2019 - 12/2024"],
      duties: [
        "Prospectaba cuentas medianas, hacía demos del producto y cerraba contratos anuales; mantenía el CRM al día y armaba propuestas",
      ],
      achievement: ["Superé la cuota anual tres años seguidos y cerré 28 cuentas nuevas en 2023"],
      more_work: ["no"],
      education: ["Universidad B, Licenciatura en Administración, 2012 - 2017"],
      certifications: ["no"],
      skills: ["CRM, Negociación, Prospección, Excel"],
      languages: ["Inglés C1"],
      links: ["no"],
    },
  },
  {
    id: "diseno",
    career: "Diseño de producto",
    answers: {
      target: ["Diseñadora UX/UI"],
      organization: ["Estudio D", "Empresa E"],
      title: ["Diseñadora UX", "Diseñadora gráfica"],
      dates: ["09/2022 - actual", "2019 - 2022"],
      duties: [
        "Diseño flujos y prototipos en Figma, hago entrevistas con usuarios y coordino con desarrollo la entrega de componentes",
        "Armaba piezas gráficas y manuales de marca para clientes de retail",
      ],
      achievement: ["Rediseñé el onboarding de una app y subió la conversión un 18%", "no"],
      more_work: ["sí", "no"],
      education: ["Instituto A, Tecnicatura en Diseño Gráfico, 2015 - 2018"],
      certifications: ["Plataforma B, Curso de Accesibilidad Web, 2023"],
      skills: ["Figma, Investigación de usuarios, Prototipado, Accesibilidad"],
      languages: ["Inglés B2"],
      links: ["https://portfolio.example.test/diseno"],
    },
  },
  {
    id: "finanzas",
    career: "Finanzas y contabilidad",
    answers: {
      target: ["Analista contable"],
      organization: ["Estudio Contable F"],
      title: ["Auxiliar contable"],
      dates: ["02/2020 - actual"],
      duties: [
        "Registro asientos, concilio cuentas bancarias, preparo liquidaciones de impuestos y atiendo consultas de 40 clientes del estudio",
      ],
      achievement: ["Reduje los errores de conciliación a casi cero con una planilla de control"],
      more_work: ["no"],
      education: ["Universidad C, Contador Público, 2014 - 2019"],
      certifications: ["Colegio A, Actualización impositiva, 2024"],
      skills: ["Excel, Conciliaciones, Impuestos, Sistemas contables"],
      languages: ["Inglés B1"],
      links: ["no"],
    },
  },
  {
    id: "software",
    career: "Desarrollo de software",
    answers: {
      target: ["Desarrolladora backend"],
      organization: ["Empresa G", "Empresa H"],
      title: ["Desarrolladora backend", "Desarrolladora junior"],
      dates: ["05/2022 - actual", "2020 - 2022"],
      duties: [
        "Desarrollo APIs en Node.js y TypeScript con PostgreSQL, escribo tests y participo en las revisiones de código del equipo",
        "Mantenía un sistema de gestión interno en PHP y corregía errores reportados por soporte",
      ],
      achievement: ["Migré el servicio de pagos y bajé la latencia media de 800 a 300 ms", "no"],
      more_work: ["sí", "no"],
      education: ["Universidad D, Ingeniería en Sistemas, 2015 - 2020"],
      certifications: ["no"],
      skills: ["Node.js, TypeScript, PostgreSQL, Docker, Git"],
      languages: ["Inglés B2"],
      links: ["https://github.example.test/persona-software"],
    },
  },
  {
    id: "operaciones",
    career: "Operaciones y logística",
    answers: {
      target: ["Coordinador de logística"],
      organization: ["Empresa I"],
      title: ["Supervisor de depósito"],
      dates: ["2016 - 2024"],
      duties: [
        "Coordinaba un equipo de 15 personas, controlaba el stock con el sistema de gestión y organizaba las rutas de entrega diarias",
      ],
      achievement: ["Bajé las diferencias de inventario del 4% al 1% en un año"],
      more_work: ["no"],
      education: ["Instituto B, Tecnicatura en Logística, 2012 - 2015"],
      certifications: ["Centro A, Curso de seguridad e higiene, 2021"],
      skills: ["Gestión de stock, Planificación de rutas, Liderazgo de equipos, Excel"],
      languages: ["no"],
      links: ["no"],
    },
  },
];
