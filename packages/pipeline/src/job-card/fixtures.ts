import type { JobCard } from "./schema";

/**
 * Aviso y ficha de ejemplo (datos inventados) para tests y para armar pantallas sin llamar al modelo.
 * Cada cita de `EXAMPLE_JOB_CARD` está literalmente en `EXAMPLE_JD_ES`.
 */
export const EXAMPLE_JD_ES = `Empresa A busca Analista de Datos para su equipo de Producto.

Sobre el puesto
Vas a trabajar con el equipo de producto para convertir datos en decisiones.

Qué vas a hacer
- Armar reportes y tableros semanales para el equipo de producto.
- Limpiar y consolidar datos de distintas fuentes.
- Presentar hallazgos a las áreas de negocio.

Qué buscamos
Requisitos indispensables:
- Al menos 3 años de experiencia como analista de datos.
- SQL avanzado.
- Inglés intermedio (B1) para leer documentación.
Deseable:
- Conocimientos de Power BI.

Condiciones
Modalidad 100% remota. Podés trabajar desde Argentina, Chile o Uruguay.
Salario: 1.250 a 1.750 dólares por mes.
Jornada completa, 40 horas semanales.
Contratación como freelance (monotributo o equivalente).`;

export const EXAMPLE_JOB_CARD: JobCard = {
  resumen: {
    texto:
      "Empresa A busca una persona para analizar datos del equipo de Producto. Trabajo remoto desde Argentina, Chile o Uruguay.",
    citas: [
      "Empresa A busca Analista de Datos para su equipo de Producto.",
      "Vas a trabajar con el equipo de producto para convertir datos en decisiones.",
      "Modalidad 100% remota. Podés trabajar desde Argentina, Chile o Uruguay.",
    ],
  },
  tareas: [
    {
      texto: "Armar reportes y tableros semanales",
      cita: "Armar reportes y tableros semanales para el equipo de producto.",
    },
    {
      texto: "Limpiar y consolidar datos de distintas fuentes",
      cita: "Limpiar y consolidar datos de distintas fuentes.",
    },
    {
      texto: "Presentar hallazgos a las áreas de negocio",
      cita: "Presentar hallazgos a las áreas de negocio.",
    },
  ],
  requisitos: [
    {
      texto: "Al menos 3 años de experiencia como analista de datos",
      nivel: "indispensable",
      categoria: "experiencia",
      anos: 3,
      idioma: null,
      cita: "Al menos 3 años de experiencia como analista de datos.",
    },
    {
      texto: "SQL avanzado",
      nivel: "indispensable",
      categoria: "habilidad",
      anos: null,
      idioma: null,
      cita: "SQL avanzado.",
    },
    {
      texto: "Inglés intermedio (B1) para leer documentación",
      nivel: "indispensable",
      categoria: "idioma",
      anos: null,
      idioma: "ingles",
      cita: "Inglés intermedio (B1) para leer documentación.",
    },
    {
      texto: "Conocimientos de Power BI",
      nivel: "deseable",
      categoria: "habilidad",
      anos: null,
      idioma: null,
      cita: "Conocimientos de Power BI.",
    },
  ],
  condiciones: {
    modalidad: { valor: "remoto", cita: "Modalidad 100% remota." },
    desdeDonde: {
      alcance: "paises",
      lugares: ["Argentina", "Chile", "Uruguay"],
      cita: "Podés trabajar desde Argentina, Chile o Uruguay.",
    },
    salario: {
      texto: "1.250 a 1.750 dólares por mes",
      minimo: 1250,
      maximo: 1750,
      moneda: "USD",
      periodo: "mes",
      cita: "Salario: 1.250 a 1.750 dólares por mes.",
    },
    experiencia: {
      texto: "Al menos 3 años como analista de datos",
      anos: 3,
      cita: "Al menos 3 años de experiencia como analista de datos.",
    },
    ingles: {
      nivel: "intermedio",
      nivelTexto: "B1",
      cita: "Inglés intermedio (B1) para leer documentación.",
    },
    jornada: { valor: "completa", cita: "Jornada completa, 40 horas semanales." },
    contratacion: {
      valor: "freelance",
      cita: "Contratación como freelance (monotributo o equivalente).",
    },
  },
  habilidades: [
    { nombre: "SQL", cita: "SQL avanzado." },
    { nombre: "Power BI", cita: "Conocimientos de Power BI." },
  ],
  area: { valor: "Datos", cita: "Empresa A busca Analista de Datos para su equipo de Producto." },
  idioma: {
    valor: "es",
    cita: "Vas a trabajar con el equipo de producto para convertir datos en decisiones.",
  },
};

/** Aviso que no dice casi nada: todo queda vacío y la pantalla muestra «No especificado». */
export const EMPTY_JOB_CARD: JobCard = {
  resumen: null,
  tareas: [],
  requisitos: [],
  condiciones: {
    modalidad: null,
    desdeDonde: null,
    salario: null,
    experiencia: null,
    ingles: null,
    jornada: null,
    contratacion: null,
  },
  habilidades: [],
  area: null,
  idioma: { valor: "es", cita: null },
};
