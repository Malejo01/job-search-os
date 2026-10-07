import { describe, expect, it } from "vitest";
import { looksLikeHtml, parseApplicationForm } from "./form-parser";

// Formularios inventados: empresa de ejemplo, preguntas genéricas.
const HTML_FORM = `
<form action="/apply" method="post">
  <h1>Postulación · Empresa Ejemplo</h1>
  <input type="hidden" name="token" value="x">
  <label for="why">¿Por qué querés trabajar acá? *</label>
  <textarea id="why" name="why" required></textarea>

  <label for="years">Años de experiencia con TypeScript</label>
  <input id="years" name="years" type="number">

  <label for="pay">Pretensión salarial</label>
  <input id="pay" name="pay" type="text">

  <label for="avail">Disponibilidad</label>
  <select id="avail" name="avail" required>
    <option value="">Elegí una opción</option>
    <option value="now">Inmediata</option>
    <option value="2w">En 2 semanas</option>
    <option value="1m">En un mes</option>
  </select>
  <button type="submit">Enviar</button>
</form>`;

describe("parseApplicationForm · HTML", () => {
  it("separa preguntas, tipos, opciones y obligatoriedad", () => {
    const r = parseApplicationForm(HTML_FORM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.questions).toEqual([
      { id: "q1", label: "¿Por qué querés trabajar acá?", kind: "texto", required: true },
      { id: "q2", label: "Años de experiencia con TypeScript", kind: "numero", required: false },
      { id: "q3", label: "Pretensión salarial", kind: "texto", required: false },
      {
        id: "q4",
        label: "Disponibilidad",
        kind: "opcion",
        options: ["Inmediata", "En 2 semanas", "En un mes"],
        required: true,
      },
    ]);
  });

  it("label envolvente, aria-label y grupo de radios con leyenda", () => {
    const r = parseApplicationForm(`
      <form>
        <label>Link a tu portfolio <input type="url" name="p"></label>
        <input type="text" aria-label="Zona horaria" required>
        <fieldset>
          <legend>¿Necesitás visa?</legend>
          <label><input type="radio" name="visa" value="si"> Sí</label>
          <label><input type="radio" name="visa" value="no"> No</label>
        </fieldset>
      </form>`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.questions).toEqual([
      { id: "q1", label: "Link a tu portfolio", kind: "texto", required: false },
      { id: "q2", label: "Zona horaria", kind: "texto", required: true },
      {
        id: "q3",
        label: "¿Necesitás visa?",
        kind: "opcion",
        options: ["Sí", "No"],
        required: false,
      },
    ]);
  });

  it("ignora script, style y comentarios sin romper, y no toma texto de ahí", () => {
    const r = parseApplicationForm(`
      <style>label::after { content: "<label>falso</label>"; }</style>
      <script>document.write('<label for="z">Pregunta inyectada</label><input id="z">');</script>
      <!-- <label for="c">Comentada</label><input id="c"> -->
      <label for="a">Nombre del equipo en el que trabajaste</label><input id="a" type="text">`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.questions.map((q) => q.label)).toEqual([
      "Nombre del equipo en el que trabajaste",
    ]);
  });

  it("un campo sin ninguna etiqueta no se inventa", () => {
    const r = parseApplicationForm(
      `<label for="a">Con etiqueta</label><input id="a"><input type="text" name="sin_etiqueta">`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.questions.map((q) => q.label)).toEqual(["Con etiqueta"]);
  });

  it("HTML sin campos con etiqueta → no_reconocido", () => {
    const r = parseApplicationForm(`<div><p>Gracias por tu interés</p><input type="text"></div>`);
    expect(r).toEqual({ ok: false, error: { reason: "no_reconocido" } });
  });
});

describe("parseApplicationForm · texto plano", () => {
  it("preguntas con ?, marca de obligatoria y opciones en viñetas", () => {
    const r = parseApplicationForm(`
Formulario de Empresa Ejemplo

1. ¿Por qué querés trabajar acá? *
2. Años de experiencia con Python ______
3. ¿Cuándo podrías empezar?
   - Inmediato
   - En 2 semanas
   - En un mes
4. Pretensión salarial (número) *
`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.questions).toEqual([
      { id: "q1", label: "¿Por qué querés trabajar acá?", kind: "texto", required: true },
      { id: "q2", label: "Años de experiencia con Python", kind: "numero", required: false },
      {
        id: "q3",
        label: "¿Cuándo podrías empezar?",
        kind: "opcion",
        options: ["Inmediato", "En 2 semanas", "En un mes"],
        required: false,
      },
      { id: "q4", label: "Pretensión salarial", kind: "numero", required: true },
    ]);
  });

  it("texto sin estructura de formulario → no_reconocido (no inventa)", () => {
    const r = parseApplicationForm("Buscamos gente con ganas de aprender.\nSumate al equipo.");
    expect(r).toEqual({ ok: false, error: { reason: "no_reconocido" } });
  });

  it("vacío o solo espacios → no_reconocido", () => {
    expect(parseApplicationForm("   \n ")).toEqual({
      ok: false,
      error: { reason: "no_reconocido" },
    });
  });
});

describe("parseApplicationForm · entrada hostil", () => {
  it("40.000 caracteres de comentarios sin cerrar terminan rápido", () => {
    const t0 = Date.now();
    const r = parseApplicationForm(
      `<label for="a">Pregunta</label><input id="a">${"<!--".repeat(10_000)}`,
    );
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.ok === false || r.value.questions.length >= 0).toBe(true);
  }, 2000);

  it("script sin cierre y comillas sin cerrar repetidos no se cuelgan", () => {
    const t0 = Date.now();
    parseApplicationForm(`<input id="a">${"<script ".repeat(5_000)}${'<input x="'.repeat(1_000)}`);
    expect(Date.now() - t0).toBeLessThan(2000);
  }, 2000);

  it("más de 50.000 caracteres → no_reconocido", () => {
    expect(parseApplicationForm(`¿Algo?${" ".repeat(50_000)}x`)).toEqual({
      ok: false,
      error: { reason: "no_reconocido" },
    });
  });
});

describe("looksLikeHtml", () => {
  it("detecta etiquetas de formulario", () => {
    expect(looksLikeHtml(HTML_FORM)).toBe(true);
    expect(looksLikeHtml("1. ¿Algo?")).toBe(false);
  });
});
