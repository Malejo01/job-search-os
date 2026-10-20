import { describe, expect, it } from "vitest";
import { extractPastedJob, MAX_PASTE_CHARS } from "./manual-paste";

describe("extractPastedJob", () => {
  it("1) estilo LinkedIn copiado: título, empresa, ubicación · modalidad", () => {
    const text = [
      "Desarrollador Backend Semi Senior",
      "Empresa Ficticia",
      "Buenos Aires, Argentina · Remoto",
      "",
      "Acerca del empleo",
      "Buscamos una persona para sumarse al equipo de plataforma.",
    ].join("\n");
    const r = extractPastedJob(text);
    expect(r.title).toBe("Desarrollador Backend Semi Senior");
    expect(r.company).toBe("Empresa Ficticia");
    expect(r.location).toBe("Buenos Aires, Argentina");
    expect(r.modality).toBe("remoto");
    expect(r.url).toBeNull();
  });

  it("2) etiquetas en español", () => {
    const text = [
      "Puesto: Analista de Datos",
      "Empresa: Acme Ficticia S.A.",
      "Ubicación: Córdoba, Argentina",
      "Modalidad: Híbrido",
      "Responsabilidades: armar tableros.",
    ].join("\n");
    const r = extractPastedJob(text);
    expect(r).toMatchObject({
      title: "Analista de Datos",
      company: "Acme Ficticia S.A.",
      location: "Córdoba, Argentina",
      modality: "hibrido",
    });
  });

  it("3) inglés con 'at'", () => {
    const text = "Senior QA Engineer at Beta Ficticia\nWe are looking for someone to join.";
    const r = extractPastedJob(text);
    expect(r.title).toBe("Senior QA Engineer");
    expect(r.company).toBe("Beta Ficticia");
    expect(r.modality).toBe("desconocida");
  });

  it("3b) etiquetas en inglés y 'is hiring a'", () => {
    const a = extractPastedJob("Job title: Data Analyst\nCompany: Gamma Ficticia\nLocation: Chile");
    expect(a).toMatchObject({
      title: "Data Analyst",
      company: "Gamma Ficticia",
      location: "Chile",
    });
    const b = extractPastedJob("Delta Ficticia is hiring a Product Designer\nRemote role.");
    expect(b).toMatchObject({ title: "Product Designer", company: "Delta Ficticia" });
    expect(b.modality).toBe("remoto");
  });

  it("4) 'X está buscando Y'", () => {
    const r = extractPastedJob(
      "Omega Ficticia está buscando Ingeniera de Software\nDetalle del rol.",
    );
    expect(r.title).toBe("Ingeniera de Software");
    expect(r.company).toBe("Omega Ficticia");
  });

  it("5) solo descripción: sin datos inventados", () => {
    const text =
      "Se requiere experiencia previa en tareas administrativas, manejo de planillas y atención al público durante la jornada.\nTambién se valora la buena predisposición para el trabajo en equipo.";
    const r = extractPastedJob(text);
    expect(r.company).toBeNull();
    expect(r.modality).toBe("desconocida");
    expect(r.location).toBeNull();
    expect(r.url).toBeNull();
    expect(r.jdText).toBe(text);
  });

  it("6) modalidad en conflicto; link público sí, localhost no", () => {
    const text = [
      "Puesto: Soporte Técnico",
      "Empresa: Zeta Ficticia",
      "Puede ser remoto o híbrido según el equipo.",
      "Postulate en http://localhost:3000/aviso/1 o en https://example.com/empleos/123.",
    ].join("\n");
    const r = extractPastedJob(text);
    expect(r.modality).toBe("desconocida");
    expect(r.url).toBe("https://example.com/empleos/123");
  });

  it("una etiqueta explícita de modalidad gana sobre el texto", () => {
    const r = extractPastedJob(
      "Puesto: X\nModalidad: Presencial\nTambién hay días de trabajo remoto.",
    );
    expect(r.modality).toBe("presencial");
  });

  it("texto vacío", () => {
    expect(extractPastedJob("   \n ")).toEqual({
      title: null,
      company: null,
      location: null,
      modality: "desconocida",
      url: null,
      jdText: "",
    });
  });

  it("jdText conserva el texto entero con saltos normalizados", () => {
    const r = extractPastedJob("  Puesto: A\r\nlinea dos\r\n\r\nlinea tres  ");
    expect(r.jdText).toBe("Puesto: A\nlinea dos\n\nlinea tres");
  });

  it("recorta título y ubicación", () => {
    const r = extractPastedJob(`Puesto: ${"t".repeat(500)}\nUbicación: ${"u".repeat(500)}`);
    expect(r.title?.length).toBe(200);
    expect(r.location?.length).toBe(120);
  });

  it("texto gigante: trunca y termina rápido", () => {
    const big = "a".repeat(100_000) + "\n" + "b ".repeat(50_000);
    const t0 = performance.now();
    const r = extractPastedJob(big);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(r.jdText.length).toBeLessThanOrEqual(MAX_PASTE_CHARS);
  });

  it("texto gigante con muchas líneas y separadores patológicos", () => {
    const big = (" en at ·:".repeat(30) + "\n").repeat(5000);
    const t0 = performance.now();
    extractPastedJob(big);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
