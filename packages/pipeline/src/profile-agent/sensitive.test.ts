import { describe, expect, it } from "vitest";
import { findProfileSensitive, hasProfileSensitive } from "./sensitive";

describe("datos sensibles que no pasan al perfil (ADR-034)", () => {
  const cases: [string, string][] = [
    ["age", "Edad: 34 años"],
    ["age", "Tengo 29 años y busco mi primer trabajo"],
    ["age", "Nací en 1991 en una ciudad chica"],
    ["age", "Fecha de nacimiento: 3 de mayo de 1990"],
    ["marital_status", "Estado civil: casada"],
    ["marital_status", "Soltero, sin compromisos"],
    ["children", "Hijos: 2"],
    ["children", "Tengo dos hijos chicos"],
    ["children", "Madre de familia numerosa"],
    ["children", "Casado con hijos"],
    ["children", "Estoy embarazada de cuatro meses"],
    ["health", "Estado de salud: bueno"],
    ["health", "Tengo diabetes tipo 2"],
    ["health", "Discapacidad: motriz"],
    ["health", "Certificado de discapacidad vigente"],
    ["religion", "Religión: católica"],
    ["religion", "Soy musulmana practicante"],
    ["religion", "Mi religión no me impide trabajar los sábados"],
    ["politics", "Militante del partido en mi barrio"],
    ["politics", "Afiliado al partido desde 2015"],
    ["politics", "Orientación política: centro"],
    ["national_id", "Documento nacional: 55 555 555"],
    ["address", "Domicilio: Calle Ficticia 1, depto B"],
    ["address", "Vivo en Avenida Ficticia 4500"],
    ["address", "Código postal: 1425"],
    ["contact", "Escribime a ficticia@example.com"],
    ["contact", "Mi teléfono es +00 00 0000 0000"],
  ];
  it.each(cases)("detecta %s: %s", (kind, text) => {
    expect(findProfileSensitive(text)).toContain(kind);
  });

  // Variantes (seguridad R10-0, O4 y O5): valores inventados
  const variants: [string, string][] = [
    ["national_id", "Documento 12345678"],
    ["national_id", "Mi número es 27-8888888-3"],
    ["national_id", "27-9999999-5"],
    ["age", "Fecha de nacimiento: 01/01/2000"],
    ["age", "Date of birth: 01/01/2000"],
    ["age", "Born in 1995"],
    ["age", "Born on 1 January 1995"],
    ["age", "Nacida en 1992"],
    ["age", "Nacido el 3 de mayo"],
    ["age", "Nací el 03/05/1990"],
    ["age", "34 años de edad"],
    ["marital_status", "Divorciado"],
    ["marital_status", "Viudo"],
    ["marital_status", "Casada"],
  ];
  it.each(variants)("variante: detecta %s en «%s»", (kind, text) => {
    expect(findProfileSensitive(text)).toContain(kind);
  });
  it("«nací en» un lugar no es una fecha de nacimiento", () => {
    expect(findProfileSensitive("Nací en Rosario y estudié en Córdoba")).toEqual([]);
  });

  const clean = [
    "Desarrollé una API de pagos para Empresa A con Node.js y PostgreSQL",
    "Tengo 5 años de experiencia en ventas B2B",
    "Universidad Católica de Ficticia · Licenciatura en Administración",
    "Hospital Ficticio · Analista de datos clínicos",
    "Atención a personas con discapacidad en un centro de día",
    "Componentes hijos y nodos hijos en el árbol de renderizado",
    "Asesor legislativo en el Congreso de Ficticia",
    "Trabajé 2019-2023 en Empresa B",
    "Salud pública: análisis de indicadores",
    "Implementé CI/CD con 12 pipelines",
    "Armé un programa de voluntariado para la comunidad",
    "",
  ];
  it.each(clean)("no marca un texto laboral común: %s", (text) => {
    expect(findProfileSensitive(text)).toEqual([]);
  });

  it("no se esquiva con invisibles ni mayúsculas ni acentos de más", () => {
    expect(hasProfileSensitive("ESTADO​ CIVIL: soltera")).toBe(true);
    expect(hasProfileSensitive("TENGO DOS HIJOS")).toBe(true);
    expect(hasProfileSensitive("religion⁠: catolica")).toBe(true);
  });

  it("devuelve tipos, nunca el texto, y sin repetidos", () => {
    const kinds = findProfileSensitive("Edad: 40 años. Estado civil: casado. Hijos: 3");
    expect(kinds).toEqual(["age", "marital_status", "children"]);
    expect(JSON.stringify(kinds)).not.toMatch(/casado|40/);
  });
});
