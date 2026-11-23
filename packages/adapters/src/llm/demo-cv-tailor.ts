/**
 * Fake de `LLM_DEMO` para la versión del CV adaptada (`cv_tailor`, R20-04). No llama a ningún modelo: lee el
 * bloque del CV que armó el código y devuelve algo coherente con el esquema y determinista, para recorrer el
 * flujo en los e2e sin gasto.
 *
 * - Caso normal: cada entrada con más de una viñeta devuelve las suyas **en orden inverso** (así se ve el
 *   reordenamiento) y las skills también al revés. Todo sale del propio CV, así que la verificación lo acepta.
 * - Caso «inventa»: si la oferta trae la marca `DEMO_INVENTA`, la primera entrada suma una viñeta con un número
 *   y una empresa que el CV no tiene. La verificación la tiene que descartar: sirve para probar la caída a la
 *   versión por código.
 */
type Vars = Record<string, string | number | boolean>;

export const DEMO_TAILOR_INVENTS_MARK = "DEMO_INVENTA";

export function demoCvTailor(vars: Vars): Record<string, unknown> {
  const cv = String(vars.cv ?? "");
  const job = String(vars.job ?? "");
  const entries: { ref: string; bullets: string[] }[] = [];
  let skills: string[] = [];
  let current: { ref: string; bullets: string[] } | null = null;
  for (const line of cv.split("\n")) {
    const head = /^\[([a-z]+-\d+)\] /.exec(line);
    if (head) {
      current = { ref: head[1]!, bullets: [] };
      entries.push(current);
    } else if (line.startsWith("- ") && current) {
      current.bullets.push(line.slice(2).trim());
    } else if (line.startsWith("Skills confirmadas: ")) {
      const list = line.slice("Skills confirmadas: ".length);
      skills = list === "(ninguna)" ? [] : list.split("; ").map((x) => x.trim());
    }
  }
  const reordered = entries
    .filter((e) => e.bullets.length > 1)
    .map((e) => ({ ref: e.ref, bullets: [...e.bullets].reverse() }));
  if (job.includes(DEMO_TAILOR_INVENTS_MARK)) {
    const first = entries.find((e) => e.bullets.length > 0);
    if (first) {
      const target = reordered.find((e) => e.ref === first.ref);
      const invented = "Lideré un equipo de 50 personas en Empresa Zeta";
      if (target) target.bullets = [invented, ...target.bullets.slice(1)];
      else reordered.push({ ref: first.ref, bullets: [invented, ...first.bullets.slice(1)] });
    }
  }
  return {
    entries: reordered,
    skills: [...skills].reverse(),
    changes: [
      {
        what: "DEMO: puse las viñetas en otro orden.",
        why: "DEMO: es una versión de prueba, sin modelo, para ver cómo se muestra.",
      },
    ],
  };
}
