import { describe, expect, it } from "vitest";
import { CV_REDIRECT_LINKS, CV_REDIRECT_MESSAGE, looksLikeCv } from "./cv-detect";

// CVs 100% inventados
const CV_ES = `Persona Ficticia
Desarrolladora web

Perfil profesional
Desarrolladora con experiencia en productos de prueba.

Experiencia laboral
Empresa Inventada S.A. — Desarrolladora frontend
mar 2021 - actualidad

Otra Empresa Ficticia — Pasante
2019 - 2021

Educación
Tecnicatura en Programación, Instituto de Ejemplo

Idiomas
Inglés B2`;

const CV_EN = `Fictional Person
fictional.person@example.com | +54 11 5555-0000

Summary
Backend developer working on sample products for invented companies, focused on APIs, queues and
databases. Previously built internal tools and dashboards for teams that do not exist, with a lot of
emphasis on testing, observability and documentation that nobody will read because it is made up.
Comfortable with code reviews, mentoring and writing technical notes for fictional stakeholders.
Looking for remote roles in imaginary companies that value careful engineering and clear writing.`;

const CV_DATES = `Experiencia
Empresa A ficticia 2018 - 2020
Empresa B ficticia 2020 - presente`;

const NORMAL = [
  "Cambiá mi país a Uruguay",
  "Tengo 5 años de experiencia en React y quiero subir mi nivel",
  "¿Por qué esta oferta me dio 4? Dice experiencia en AWS",
  "Mi email es persona@example.com, ¿lo usás para algo?",
  "Trabajé en 2019 - 2021 en una empresa ficticia, ¿cuenta para los años?",
  "Skills: React, Node. ¿Qué me conviene estudiar?",
];

describe("looksLikeCv", () => {
  it("reconoce CVs en español e inglés", () => {
    expect(looksLikeCv(CV_ES)).toBe(true);
    expect(looksLikeCv(CV_EN)).toBe(true);
    expect(looksLikeCv(CV_DATES)).toBe(true);
  });

  it("los mensajes normales no disparan", () => {
    for (const m of NORMAL) expect(looksLikeCv(m)).toBe(false);
  });
});

describe("mensaje de derivación", () => {
  it("es fijo y lleva a las pantallas del perfil", () => {
    expect(CV_REDIRECT_MESSAGE).toMatch(/CV/);
    expect(CV_REDIRECT_LINKS.map((l) => l.href)).toEqual(["/settings/perfil", "/settings/skills"]);
  });
});
