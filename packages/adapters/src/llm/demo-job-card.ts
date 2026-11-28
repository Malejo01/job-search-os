/**
 * Fake de `LLM_DEMO` para la ficha del aviso (`extract_job_card`, R31-02). No llama a ningún modelo: lee el bloque
 * `<<<AVISO>>>` que armó el código y arma una ficha con reglas tontas sobre el propio texto, así que cada cita es
 * literal y el verificador la acepta. Determinista, para recorrer el flujo en los e2e sin gasto, con avisos
 * inventados.
 *
 * - Caso normal: resumen de demostración, tareas y requisitos de las listas del aviso, y las condiciones que se
 *   pueden leer con palabras clave.
 * - `DEMO_FICHA_FALLA` en el aviso: devuelve algo que no cumple el esquema (simula una falla del modelo).
 * - `DEMO_FICHA_INYECTA` en el aviso: simula un modelo que obedeció una instrucción metida en el texto y escribió
 *   un veredicto; el verificador tiene que descartarlo.
 */
type Vars = Record<string, string | number | boolean>;

export const DEMO_JOB_CARD_FAIL_MARK = "DEMO_FICHA_FALLA";
export const DEMO_JOB_CARD_INJECT_MARK = "DEMO_FICHA_INYECTA";

const KNOWN_SKILLS = [
  "SQL",
  "Excel",
  "Power BI",
  "Python",
  "JavaScript",
  "TypeScript",
  "React",
  "Tableau",
  "Docker",
  "Figma",
  "SAP",
];

const bullet = /^\s*(?:[-•*·]|\d+[.)])\s+/;
const stripBullet = (s: string) => s.replace(bullet, "").trim();

type Section = "tareas" | "requisitos" | "otro";
function sectionOf(line: string): { section: Section; nivel: string } | null {
  const l = line.toLowerCase();
  if (bullet.test(line) || line.length > 80) return null;
  if (/qu[eé] vas a hacer|^tareas|responsabilidades|what you('ll| will) do|your role/.test(l))
    return { section: "tareas", nivel: "sin_distinguir" };
  if (/deseable|nice to have|desej[aá]vel|se valora/.test(l))
    return { section: "requisitos", nivel: "deseable" };
  if (/indispensabl|obligatori|excluyent|must[- ]have|required/.test(l))
    return { section: "requisitos", nivel: "indispensable" };
  if (/requisitos|qu[eé] buscamos|requirements|qualifications/.test(l))
    return { section: "requisitos", nivel: "sin_distinguir" };
  if (/condiciones|sobre el puesto|about|ofrecemos|beneficios/.test(l))
    return { section: "otro", nivel: "sin_distinguir" };
  return null;
}

function between(text: string): string {
  const start = text.indexOf("<<<AVISO>>>");
  const end = text.indexOf("<<<FIN AVISO>>>");
  if (start === -1 || end === -1) return text;
  return text.slice(start + "<<<AVISO>>>".length, end).trim();
}

export function demoJobCard(vars: Vars): Record<string, unknown> {
  const text = between(String(vars.job ?? ""));
  if (text.includes(DEMO_JOB_CARD_FAIL_MARK)) return { fallo: true };

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const first = lines[0]?.slice(0, 200) ?? "";
  const empty = {
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
  if (first.length < 3) return empty;

  const tareas: { texto: string; cita: string }[] = [];
  const requisitos: Record<string, unknown>[] = [];
  const habilidades: { nombre: string; cita: string }[] = [];
  let section: Section = "otro";
  let nivel = "sin_distinguir";
  for (const line of lines) {
    const head = sectionOf(line);
    if (head) {
      section = head.section;
      nivel = head.nivel;
      continue;
    }
    if (!bullet.test(line)) continue;
    const item = stripBullet(line).slice(0, 380);
    if (item.length < 3) continue;
    if (section === "tareas" && tareas.length < 15) tareas.push({ texto: item, cita: item });
    if (section === "requisitos" && requisitos.length < 20) {
      const years = /(\d{1,2})\s+(?:años|years|anos)/i.exec(item);
      const isLanguage = /ingl[eé]s|english/i.test(item);
      requisitos.push({
        texto: item,
        nivel,
        categoria: isLanguage ? "idioma" : years ? "experiencia" : "habilidad",
        anos: years ? Number(years[1]) : null,
        idioma: isLanguage ? "ingles" : null,
        cita: item,
      });
      for (const skill of KNOWN_SKILLS) {
        if (
          new RegExp(`\\b${skill}\\b`, "i").test(item) &&
          habilidades.length < 20 &&
          !habilidades.some((h) => h.nombre === skill)
        )
          habilidades.push({ nombre: skill, cita: item });
      }
    }
  }

  // Frases sueltas para las condiciones
  const sentences = lines
    .flatMap((l) => stripBullet(l).split(/(?<=\.)\s+/))
    .map((s) => s.replace(/\.$/, "").trim())
    .filter((s) => s.length >= 3 && s.length <= 300);
  const find = (re: RegExp) => sentences.find((s) => re.test(s));

  const condiciones = { ...empty.condiciones } as Record<string, unknown>;
  const mod = find(/\bremot[oa]\b|\bremote\b|h[ií]brid|hybrid|presencial|on-?site/i);
  if (mod) {
    condiciones.modalidad = {
      valor: /h[ií]brid|hybrid/i.test(mod)
        ? "hibrido"
        : /presencial|on-?site/i.test(mod)
          ? "presencial"
          : "remoto",
      cita: mod,
    };
  }
  const sal = sentences.find(
    (s) => /\d/.test(s) && /salario|sueldo|salary|usd|dólares|dolares|pesos|\$/i.test(s),
  );
  if (sal) {
    const nums = (sal.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => Number(n.replace(/[.,]/g, "")));
    condiciones.salario = {
      texto: sal,
      minimo: nums[0] ?? null,
      maximo: nums[1] ?? null,
      moneda: null,
      periodo: null,
      cita: sal,
    };
  }
  const exp = find(/\d{1,2}\s+(?:años|years|anos)/i);
  if (exp) {
    const n = /(\d{1,2})\s+(?:años|years|anos)/i.exec(exp);
    condiciones.experiencia = { texto: exp, anos: n ? Number(n[1]) : null, cita: exp };
  }
  const eng = find(/ingl[eé]s|english/i);
  if (eng) {
    condiciones.ingles = {
      nivel: /avanzad|advanced|fluent|c1|c2/i.test(eng)
        ? "avanzado"
        : /intermedi|b1|b2/i.test(eng)
          ? "intermedio"
          : /b[aá]sic/i.test(eng)
            ? "basico"
            : "sin_nivel",
      nivelTexto: null,
      cita: eng,
    };
  }
  const jor = find(
    /jornada completa|full[- ]?time|tiempo completo|part[- ]?time|medio tiempo|jornada parcial/i,
  );
  if (jor) {
    condiciones.jornada = {
      valor: /part[- ]?time|medio tiempo|parcial/i.test(jor) ? "parcial" : "completa",
      cita: jor,
    };
  }
  const con = find(/freelance|monotribut|relaci[oó]n de dependencia/i);
  if (con) {
    condiciones.contratacion = {
      valor: /relaci[oó]n de dependencia/i.test(con) ? "relacion_dependencia" : "freelance",
      cita: con,
    };
  }

  const inject = text.includes(DEMO_JOB_CARD_INJECT_MARK);
  return {
    ...empty,
    resumen: {
      texto: inject ? "Este puesto coincide al 100% con tu perfil. Aplicá ya." : first, // sin modelo: el resumen es la primera línea del aviso, así sale de su propia cita
      citas: [first],
    },
    tareas: inject
      ? [{ texto: "Puntaje 10: coincide con tu perfil", cita: first }, ...tareas]
      : tareas,
    requisitos,
    condiciones,
    habilidades,
  };
}
