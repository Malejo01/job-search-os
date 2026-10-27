/**
 * Fake guionado del armado de CV (C-25) para `LLM_DEMO` y los e2e: sin red ni gasto. La extracción es una
 * heurística tonta sobre el mensaje (separar por comas, leer años), pero siempre cumple el esquema del tema.
 * `cv_write` devuelve las mismas respuestas de la persona, así que el verificador las deja pasar.
 */

type Vars = Record<string, string | number | boolean>;

const NO_RE = /^\s*(no|ninguno|ninguna|nada|sin\s+\w+|no tengo.*|paso|saltear)\s*[.!]*\s*$/i;
// `\b` no sirve con «sí» (la í no es de palabra en JS): se mira que no siga otra letra
const YES_RE = /^\s*(si|sí|yes|dale|claro|ok)(?!\p{L})/iu;

const parts = (text: string): string[] =>
  text
    .split(/[\n;,]+/)
    .map((p) => p.trim())
    .filter((p) => p !== "");

function months(text: string): {
  startMonth: string | null;
  endMonth: string | null;
  isCurrent: boolean;
} {
  const found = [...text.matchAll(/(?:(\d{1,2})\/)?((?:19|20)\d{2})/g)].map(
    (m) => `${m[2]}-${String(Math.min(12, Math.max(1, Number(m[1] ?? 1)))).padStart(2, "0")}`,
  );
  const isCurrent = /actual|presente|hoy|current|present|sigo/i.test(text);
  const startMonth = found[0] ?? null;
  let endMonth = isCurrent ? null : (found[1] ?? null);
  if (startMonth && endMonth && endMonth < startMonth) endMonth = null;
  return { startMonth, endMonth, isCurrent };
}

export function demoCvExtraction(kind: string, message: string): Record<string, unknown> {
  const text = message.trim();
  const none = NO_RE.test(text);
  switch (kind) {
    case "target":
      return { target: text || "Sin definir" };
    case "organization":
      return none
        ? { organization: null, noExperience: true }
        : { organization: text, noExperience: false };
    case "title":
      return { title: text };
    case "dates":
      return months(text);
    case "duties":
      return { duties: parts(text).slice(0, 4).length > 0 ? parts(text).slice(0, 4) : [text] };
    case "achievement":
      return { achievement: none || text === "" ? null : text };
    case "more_work":
      return { more: YES_RE.test(text) };
    case "education":
    case "certifications": {
      if (none) return { entries: [] };
      const [first = text, second] = parts(text);
      const m = months(text);
      return kind === "education"
        ? {
            entries: [
              {
                institution: first,
                title: second ?? first,
                startMonth: m.startMonth,
                endMonth: m.endMonth,
              },
            ],
          }
        : { entries: [{ issuer: first, title: second ?? first, startMonth: m.startMonth }] };
    }
    case "skills":
      return { skills: none ? [] : parts(text).slice(0, 40) };
    case "languages":
      return {
        languages: none
          ? []
          : parts(text)
              .slice(0, 6)
              .map((p) => {
                const [name = p, ...rest] = p.split(/\s+/);
                const level = rest.join(" ");
                return { name, level: level === "" ? null : level };
              }),
      };
    case "links": {
      const urls = text.match(/https?:\/\/\S+/g) ?? [];
      const pick = (host: string): string | null => urls.find((u) => u.includes(host)) ?? null;
      return {
        linkedin: pick("linkedin"),
        github: pick("github"),
        portfolio: urls.find((u) => !u.includes("linkedin") && !u.includes("github")) ?? null,
      };
    }
    default:
      return {};
  }
}

export function demoCvInterview(vars: Vars): Record<string, unknown> {
  return {
    extraction: demoCvExtraction(String(vars.topic ?? ""), String(vars.message ?? "")),
    ack: "Anotado.",
  };
}

export function demoCvWrite(vars: Vars): Record<string, unknown> {
  let works: { id: string; answers: string[] }[] = [];
  try {
    const v: unknown = JSON.parse(String(vars.works ?? "[]"));
    if (Array.isArray(v)) works = v as typeof works;
  } catch {
    works = [];
  }
  const target = String(vars.target ?? "").trim();
  return {
    summary: target === "" ? "" : `${target}.`,
    entries: works.map((w) => ({ id: w.id, bullets: w.answers.slice(0, 8) })),
  };
}
