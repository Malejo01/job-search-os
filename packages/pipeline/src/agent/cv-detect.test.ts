import { describe, expect, it } from "vitest";
import {
  CV_OMITTED_MARKER,
  CV_REDIRECT_LINKS,
  CV_REDIRECT_MESSAGE,
  looksLikeCv,
  screenUserMessage,
} from "./cv-detect";

// Todo inventado: personas y empresas ficticias, teléfonos del rango +1 555 01xx, emails @example.com
const CVS: Record<string, string> = {
  es_clasico: `Nombre Inventado Apellido
Desarrollador Backend
nombre.inventado@example.com · +1 555 555 0101 · Ciudad Ejemplo

Sobre mí
Desarrollador con 6 años construyendo APIs.

Experiencia Profesional
Empresa Ficticia SA · Backend Developer · 2020 - Actualidad
- Diseñé servicios en Node.js
Compañía Imaginaria · Junior · 2018 - 2020

Educación
Ingeniería en Sistemas · Universidad de Ejemplo · 2012 - 2018

Habilidades técnicas
Node.js, PostgreSQL, Docker`,
  en_classic: `Invented Name
Senior Frontend Engineer
invented.name@example.com | (555) 010-0199

Professional Summary
Frontend engineer with 7 years building SPAs.

Professional Experience
Fake Corp — Senior Engineer — Jan 2021 to Present
Made Up Inc — Engineer — Jun 2017 to Dec 2020

Education
B.Sc. Computer Science, Example University

Technical Skills
React, TypeScript`,
  en_summary_contacto: `Fictional Person
fictional.person@example.com | +1 555 010 0100

Summary
Backend developer working on sample products for invented companies, focused on APIs and queues.`,
  linkedin_pdf_es: `Contactar
www.linkedin.com/in/nombre-inventado-000000 (LinkedIn)
Aptitudes principales
React
Node.js
Languages
Inglés (Professional Working Proficiency)
Nombre Inventado
Desarrollador Full Stack en Empresa Ficticia
Ciudad Ejemplo, Provincia Ejemplo
Extracto
Desarrollador full stack con foco en producto.
Experiencia
Empresa Ficticia
Desarrollador Full Stack
marzo de 2021 - Present (3 años 8 meses)
Ciudad Ejemplo
Educación
Universidad de Ejemplo
Licenciatura, Sistemas · (2014 - 2019)`,
  linkedin_pdf_en: `Contact
www.linkedin.com/in/invented-name-000000 (LinkedIn)
Top Skills
React
Languages
Spanish (Native or Bilingual)
Invented Name
Data Analyst at Fake Corp
Example City
Summary
Analyst.
Experience
Fake Corp
Data Analyst
March 2022 - Present (2 years 8 months)
Education
Example University
Bachelor's degree, Statistics · (2015 - 2020)`,
  linkedin_web_copy: `Invented Name
Product Designer at Fake Corp
Example City · Contact info
About
Designer focused on research.
Experience
Product Designer
Fake Corp · Full-time
Mar 2021 - Present · 3 yrs 8 mos
Education
Example University
2014 - 2018
Skills
Figma`,
  cv_corto_es: `Nombre Inventado
nombre.inventado@example.com
+1 555 555 0102
Desarrolladora React, 4 años. Empresa Ficticia (2020-2024).`,
  cv_corto_en: `Invented Name - invented@example.com - +1 555 010 0100
QA Engineer, 5 yrs at Fake Corp (2019-2024), Selenium, Cypress.`,
  una_linea: `Nombre Inventado | nombre@example.com | +1 555 555 0103 | Experiencia: Empresa Ficticia (Frontend, 2021-2024), Empresa Imaginaria (Junior, 2019-2021). Educación: Tecnicatura en Programación (Instituto Ejemplo). Skills: React, TypeScript, Node. Idiomas: inglés B2. Busco remoto.`,
  fechas_numericas: `Experiencia
Empresa Ficticia — 03/2021 - 05/2024
Empresa Imaginaria — 01/2019 - 02/2021
Contacto: nombre@example.com`,
  headers_con_emoji: `👤 Nombre Inventado
📧 nombre@example.com  📱 +1 555 555 0104
💼 Experiencia laboral
Empresa Ficticia, frontend, 2021 a la fecha
🎓 Educación
Instituto Ejemplo`,
  headers_mayus_conocimientos: `NOMBRE INVENTADO
DATOS DE CONTACTO
nombre@example.com
OBJETIVO
Conseguir un puesto de frontend.
ANTECEDENTES LABORALES
Empresa Ficticia (2021 a 2024)
CONOCIMIENTOS
React`,
  en_mm_yyyy: `Persona Inventada
Desarrollador Backend

PROFESSIONAL SUMMARY
Backend developer...

PROFESSIONAL EXPERIENCE
Empresa Ficticia — Backend Developer
03/2019 - 05/2021
Otra Empresa — Dev
06/2021 - Present

TECHNICAL SKILLS
Node, Postgres

EDUCATION
Universidad de Ejemplo 2010 a 2015`,
  vinetas: `• Experiencia
Empresa Ficticia 2019 - 2021
Otra Empresa 2021 - actualidad
• Educación
Universidad de Ejemplo
• Idiomas
Inglés B2`,
  una_linea_sin_contacto: `Experiencia laboral: Empresa Ficticia (2019 - 2021) backend; Otra Empresa (2021 - actualidad). Educación: Universidad de Ejemplo. Habilidades: Node, Postgres. Idiomas: inglés B2.`,
  es_con_fechas: `Experiencia
Empresa Ficticia 2018 - 2020
Otra Empresa 2020 - presente
Educación
Instituto de Ejemplo`,
};

const NO_CV: Record<string, string> = {
  jd_pegada: `Buscamos Frontend Developer para Empresa Ficticia.
Requisitos
- 3 años de experiencia en React
Experiencia
Excluyente React
Habilidades
TypeScript
Idiomas
Inglés intermedio`,
  jd_con_dos_puntos: `Buscamos Backend Developer Sr para una empresa ficticia.

Responsabilidades
- Diseñar APIs

Experiencia:
- 3+ años con Node

Educación:
- Ingeniería o afín

Idiomas:
- Inglés intermedio

Beneficios: prepaga, home office.`,
  jd_email_y_sueldo:
    "Puesto: Analista de datos. Modalidad híbrida. Requisitos: SQL, Python, Power BI, 2 años de experiencia. Ofrecemos salario 1.500.000 - 2.000.000 ARS, prepaga, capacitación. ".repeat(
      2,
    ) + "Enviá tu CV a rrhh@example.com indicando pretensión.",
  pregunta_con_fechas:
    "Trabajé en Empresa Ficticia 2019 - 2021 y en Otra Empresa 2021 - actualidad.\nSkills\n¿Qué me falta para backend?",
  recruiter:
    "Hola! Me escribió una recruiter desde talento@example.com por un puesto que paga 1500 - 2000 USD. " +
    "Quiero saber si me conviene. ".repeat(12),
  m1: "Cambiá mi país a Uruguay",
  m2: "Tengo 5 años de experiencia en React y quiero subir mi nivel",
  m3: "¿Por qué esta oferta me dio 4? Dice experiencia en AWS",
  m4: "Mi email es persona@example.com, ¿lo usás para algo?",
  m5: "Trabajé en 2019 - 2021 en una empresa ficticia, ¿cuenta para los años?",
  m6: "Skills: React, Node. ¿Qué me conviene estudiar?",
};

describe("looksLikeCv", () => {
  for (const [name, text] of Object.entries(CVS)) {
    it(`reconoce el CV «${name}»`, () => expect(looksLikeCv(text)).toBe(true));
  }
  for (const [name, text] of Object.entries(NO_CV)) {
    it(`no confunde «${name}» con un CV`, () => expect(looksLikeCv(text)).toBe(false));
  }

  it("no se cuelga con 200.000 caracteres", () => {
    for (const text of [
      "a".repeat(200_000),
      " ".repeat(200_000) + "a",
      "1".repeat(200_000),
      "a@".repeat(100_000),
      ". experiencia ".repeat(15_000),
    ]) {
      const t0 = performance.now();
      looksLikeCv(text);
      expect(performance.now() - t0).toBeLessThan(200);
    }
  });
});

describe("screenUserMessage", () => {
  it("un CV largo se deriva al flujo de CV antes del tope de largo", () => {
    const cv = (CVS.es_clasico + "\n").repeat(20).slice(0, 5000);
    expect(cv.length).toBe(5000);
    expect(screenUserMessage(cv)).toEqual({ ok: false, error: "cv" });
  });

  it("un mensaje largo que no es CV es muy largo; uno normal pasa", () => {
    expect(screenUserMessage("hola ".repeat(500))).toEqual({
      ok: false,
      error: "message_too_long",
    });
    expect(screenUserMessage("Cambiá mi país a Uruguay").ok).toBe(true);
  });
});

describe("mensaje de derivación", () => {
  it("es fijo, dice que no se guardó y lleva a las pantallas del perfil", () => {
    expect(CV_REDIRECT_MESSAGE).toMatch(/No lo mandé al asistente ni lo guardé/);
    expect(CV_REDIRECT_LINKS.map((l) => l.href)).toEqual(["/settings/perfil", "/settings/skills"]);
    expect(looksLikeCv(CV_OMITTED_MARKER)).toBe(false);
  });
});
