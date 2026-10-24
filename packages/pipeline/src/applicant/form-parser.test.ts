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

const labels = (html: string) => {
  const r = parseApplicationForm(html);
  return r.ok ? r.value.questions : null;
};

describe("parseApplicationForm · HTML · entidades y casos de borde", () => {
  it("decodifica entidades numéricas, hexadecimales y con nombre", () => {
    const q = labels(
      '<label for="a">&#191;Edad&#x3F; &amp; m&aacute;s &#0; &#x110000; &#xZZ;</label><input id="a">',
    );
    expect(q?.[0]?.label).toBe("¿Edad? & m&aacute;s &#0; &#x110000; &#xZZ;");
  });

  it("entidad con mayúscula en la X (&#X41;) y nombre en mayúsculas (&AMP;)", () => {
    const q = labels('<label for="a">&#X41; &AMP; B</label><input id="a">');
    expect(q?.[0]?.label).toBe("A & B");
  });

  it("otra etiqueta dentro de un option corta la recolección de texto", () => {
    const q = labels(
      '<label for="s">Turno</label><select id="s"><option value="m">Mañana<b>!</b> tarde</option><option value="n">Noche</option></select>',
    );
    expect(q?.[0]).toMatchObject({
      label: "Turno",
      kind: "opcion",
      options: ["Mañana", "Noche"],
      required: false,
    });
  });

  it("option fuera de un select se ignora", () => {
    expect(
      labels('<option value="x">Suelta</option><label for="a">Nombre</label><input id="a">'),
    ).toEqual([{ id: "q1", label: "Nombre", kind: "texto", required: false }]);
  });

  it("radio suelto: la etiqueta propia es la pregunta", () => {
    const q = labels('<label><input type="radio" name="r1"> Acepto condiciones *</label>');
    expect(q).toEqual([{ id: "q1", label: "Acepto condiciones", kind: "opcion", required: true }]);
  });

  it("checkbox suelto sin etiqueta usa aria-label y respeta required del campo", () => {
    const q = labels('<input type="checkbox" aria-label="Acepto recibir novedades" required>');
    expect(q).toEqual([
      { id: "q1", label: "Acepto recibir novedades", kind: "opcion", required: true },
    ]);
  });

  it("checkbox suelto sin ninguna etiqueta se omite", () => {
    expect(labels('<input type="checkbox" name="x">')).toBeNull();
  });

  it("grupo de radios con pregunta en una etiqueta previa libre", () => {
    const q = labels(
      "<label>Modalidad preferida (obligatoria)</label>" +
        '<label><input type="radio" name="m" value="r"> Remoto</label>' +
        '<label><input type="radio" name="m" value="h"> Híbrido</label>',
    );
    expect(q).toEqual([
      {
        id: "q1",
        label: "Modalidad preferida",
        kind: "opcion",
        options: ["Remoto", "Híbrido"],
        required: true,
      },
    ]);
  });

  it("grupo de radios sin texto de pregunta no se inventa", () => {
    const q = labels(
      '<label><input type="radio" name="m"> Remoto</label><label><input type="radio" name="m"> Híbrido</label>',
    );
    expect(q).toBeNull();
  });

  it("grupo donde todos los campos tienen aria-label no toma la etiqueta previa", () => {
    const q = labels(
      "<label>Pregunta previa</label>" +
        '<input type="checkbox" name="g" aria-label="Opción uno">' +
        '<input type="checkbox" name="g" aria-label="Opción dos" required>',
    );
    expect(q).toBeNull();
  });

  it("grupo cuyo primer campo no trae texto de opción, y los siguientes sí", () => {
    const q = labels(
      '<label>¿Qué turnos?</label><input type="checkbox" name="t">' +
        '<label><input type="checkbox" name="t" required> Tarde</label>',
    );
    expect(q).toEqual([
      { id: "q1", label: "¿Qué turnos?", kind: "opcion", options: ["Tarde"], required: true },
    ]);
  });

  it("legend nombra el grupo (sin atributo for)", () => {
    const q = labels(
      "<legend>Nivel de inglés *</legend>" +
        '<label><input type="radio" name="n" value="1"> Básico</label>' +
        '<label><input type="radio" name="n" value="2"> Avanzado</label>',
    );
    expect(q?.[0]).toMatchObject({ label: "Nivel de inglés", options: ["Básico", "Avanzado"] });
  });

  it("input con aria-label, placeholder o range", () => {
    const q = labels(
      '<input aria-label="Usuario de GitHub" aria-required="true">' +
        '<input placeholder="Link al portfolio">' +
        '<input type="range" aria-label="Nivel de interés (1-10)">',
    );
    expect(q).toEqual([
      { id: "q1", label: "Usuario de GitHub", kind: "texto", required: true },
      { id: "q2", label: "Link al portfolio", kind: "texto", required: false },
      { id: "q3", label: "Nivel de interés (1-10)", kind: "numero", required: false },
    ]);
  });

  it("campo sin etiqueta, aria ni placeholder se omite; tipos no respondibles se saltan", () => {
    expect(
      labels(
        '<input name="x"><input type="file" aria-label="CV"><input type="password" aria-label="P">',
      ),
    ).toBeNull();
  });

  it("textarea envuelto por su label y atributos sin comillas / en mayúsculas", () => {
    const q = labels(
      "<LABEL>Contanos algo (required)<TEXTAREA NAME=x REQUIRED></TEXTAREA></LABEL>",
    );
    expect(q).toEqual([{ id: "q1", label: "Contanos algo", kind: "texto", required: true }]);
  });

  it("select: descarta opciones deshabilitadas sin valor y vacías; select con aria-label", () => {
    const q = labels(
      '<select aria-label="País"><option disabled>Elegí</option><option value="">-</option>' +
        '<option>Argentina</option><option value="uy">Uruguay</option><option value="x"> </option></select>',
    );
    expect(q?.[0]).toMatchObject({
      label: "País",
      kind: "opcion",
      options: ["Argentina", "Uruguay"],
      required: false,
    });
  });

  it("scripts, estilos y comentarios se descartan; script sin cierre corta hasta el final", () => {
    const q = labels(
      '<!-- <label>Oculta</label> --><style>.a{}</style><script>var x="<label>Falsa</label>";</script>' +
        '<label for="a">Real</label><input id="a"><script>alert(1)',
    );
    expect(q).toEqual([{ id: "q1", label: "Real", kind: "texto", required: false }]);
  });

  it("etiqueta con for que apunta a un id inexistente no liga; '<' suelto no rompe", () => {
    const q = labels('<label for="zz">Pregunta libre</label> 3 < 4 <input name="y">');
    expect(q).toEqual([{ id: "q1", label: "Pregunta libre", kind: "texto", required: false }]);
  });

  it("dos labels con el mismo for: gana la primera", () => {
    const q = labels('<label for="a">Primera</label><label for="a">Segunda</label><input id="a">');
    expect(q?.[0]?.label).toBe("Primera");
  });

  it("marcas de obligatorio repetidas en la etiqueta", () => {
    const q = labels('<label for="a">Nombre completo (requerido) *</label><input id="a">');
    expect(q?.[0]).toMatchObject({ label: "Nombre completo", required: true });
  });
});

describe("parseApplicationForm · texto plano · borde", () => {
  it("opciones con viñetas bajo una pregunta", () => {
    const r = parseApplicationForm("¿Disponibilidad?\n- Inmediata\n• En un mes");
    expect(r.ok && r.value.questions[0]).toMatchObject({
      kind: "opcion",
      options: ["Inmediata", "En un mes"],
    });
  });

  it("línea numerada que parece viñeta no es opción sino pregunta nueva", () => {
    const r = parseApplicationForm("1. ¿Uno?\n2. ¿Dos?");
    expect(r.ok && r.value.questions.map((q) => q.label)).toEqual(["¿Uno?", "¿Dos?"]);
  });

  it("pregunta marcada con (número), (obligatorio), línea de respuesta y puntos suspensivos", () => {
    const r = parseApplicationForm(
      "Años de React (número)\nNombre del referente (obligatorio)\nLink a tu GitHub ____\nUsuario …\nTexto cualquiera",
    );
    expect(r.ok && r.value.questions).toEqual([
      { id: "q1", label: "Años de React", kind: "numero", required: false },
      { id: "q2", label: "Nombre del referente", kind: "texto", required: true },
      { id: "q3", label: "Link a tu GitHub", kind: "texto", required: false },
      { id: "q4", label: "Usuario", kind: "texto", required: false },
    ]);
  });

  it("una línea no pregunta corta la lista de opciones", () => {
    const r = parseApplicationForm("¿Turno?\n- Mañana\nTexto suelto\n- Tarde");
    expect(r.ok && r.value.questions).toHaveLength(1);
    expect(r.ok && r.value.questions[0]?.options).toEqual(["Mañana"]);
  });

  it("etiqueta numérica por contenido", () => {
    const r = parseApplicationForm("¿Cuántos años tenés de experiencia?");
    expect(r.ok && r.value.questions[0]?.kind).toBe("numero");
  });

  it("solo marcas sin texto → no_reconocido", () => {
    expect(parseApplicationForm("*")).toEqual({ ok: false, error: { reason: "no_reconocido" } });
  });
});
