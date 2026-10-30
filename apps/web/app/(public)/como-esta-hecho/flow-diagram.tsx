/**
 * Diagrama del recorrido de una oferta (ronda 75). SVG inline, sin librerías: dos versiones, una en
 * dos filas de tres cajas desde `sm` y otra apilada en vertical a 360 px. Cada caja lleva su número
 * y su texto, así que no depende del color. La lista `<ol>` de la página repite el detalle.
 * Server Component.
 */
export const FLOW_STEPS = [
  {
    title: "Fuentes",
    text: "APIs públicas de bolsas de empleo y sitios de empleo de empresas (Greenhouse, Lever, Ashby), más las alertas que la persona reenvía por email.",
    note: "Nada de scraping de LinkedIn ni postulaciones automáticas.",
  },
  {
    title: "Normalización y duplicados",
    text: "Mismo aviso en dos fuentes → una sola oferta.",
    note: null,
  },
  {
    title: "Prefiltro (código, sin IA)",
    text: "Modalidad, disciplina, títulos fuera de perfil y país exigido. Descarta barato antes de gastar en IA.",
    note: null,
  },
  {
    title: "Evaluación con IA",
    text: "Lee el aviso completo contra el perfil y devuelve una respuesta con formato fijo y validado: puntaje, por qué sí, por qué no, lo que falta y riesgos.",
    note: null,
  },
  {
    title: "decide() (código)",
    text: "Aplica reglas verificables: años exigidos, inglés, residencia y techo por título. Así llega a la acción: aplicar, guardar o descartar.",
    note: "El modelo sugiere; el código decide.",
  },
  {
    title: "La app y el MCP",
    text: "La persona ve el porqué y decide. También se puede consultar por MCP (un protocolo para consultarlo desde un asistente de IA).",
    note: null,
  },
] as const;

export type FlowLang = "es" | "en";

export const FLOW_STEPS_EN = [
  {
    title: "Sources",
    text: "Public job-board APIs and company career sites (Greenhouse, Lever, Ashby), plus the alerts the person forwards by email.",
    note: "No LinkedIn scraping and no automatic applications.",
  },
  {
    title: "Normalization and deduplication",
    text: "The same posting from two sources becomes a single job.",
    note: null,
  },
  {
    title: "Prefilter (code, no AI)",
    text: "Work mode, discipline, off-profile titles and required country. It discards cheaply before spending on AI.",
    note: null,
  },
  {
    title: "AI evaluation",
    text: "Reads the full posting against the profile and returns a fixed, validated structure: score, pros, cons, gaps and risks.",
    note: null,
  },
  {
    title: "decide() (code)",
    text: "Applies verifiable rules: required years, English, residency and a per-title ceiling. That yields the action: apply, save or discard.",
    note: "The model suggests; the code decides.",
  },
  {
    title: "The app and MCP",
    text: "The person sees the reasoning and decides. It can also be queried over MCP, a protocol for connecting AI assistants.",
    note: null,
  },
] as const;

const TEXTS = {
  es: {
    title: "Recorrido de una oferta, de la fuente a la decisión",
    desc: "Seis pasos en orden: 1 fuentes, 2 normalización y duplicados, 3 prefiltro en código, 4 evaluación con IA, 5 decide() en código, 6 la app y el MCP, donde la persona decide.",
    labels: [
      ["1 · Fuentes", "APIs y alertas"],
      ["2 · Normalización", "y duplicados"],
      ["3 · Prefiltro", "código, sin IA"],
      ["4 · Evaluación", "con IA"],
      ["5 · decide()", "código"],
      ["6 · App y MCP", "la persona decide"],
    ],
  },
  en: {
    title: "Journey of a job posting, from source to decision",
    desc: "Six steps in order: 1 sources, 2 normalization and deduplication, 3 prefilter in code, 4 AI evaluation, 5 decide() in code, 6 the app and MCP, where the person decides.",
    labels: [
      ["1 · Sources", "APIs and alerts"],
      ["2 · Normalization", "and deduplication"],
      ["3 · Prefilter", "code, no AI"],
      ["4 · AI evaluation", "reads the posting"],
      ["5 · decide()", "code"],
      ["6 · App and MCP", "the person decides"],
    ],
  },
} as const;

const BOX = "fill-surface stroke-fg";
const HEAD = "fill-fg text-[15px] font-semibold";
const SUB = "fill-fg-muted text-[13px]";

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0 0 L10 5 L0 10 z" className="fill-fg" />
      </marker>
    </defs>
  );
}

export function FlowDiagram({ lang = "es" }: { lang?: FlowLang }) {
  const { title: TITLE, desc: DESC, labels: LABELS } = TEXTS[lang];
  return (
    <div data-testid="flow-diagram">
      {/* Desde sm: dos filas de tres cajas, la flecha de la fila 1 vuelve a la izquierda */}
      <svg
        role="img"
        viewBox="0 0 720 300"
        className="hidden h-auto w-full sm:block"
        aria-labelledby="flow-h-title flow-h-desc"
      >
        <title id="flow-h-title">{TITLE}</title>
        <desc id="flow-h-desc">{DESC}</desc>
        <Defs id="flow-h-arrow" />
        {LABELS.map(([head, sub], i) => {
          const x = 20 + (i % 3) * 240;
          const y = i < 3 ? 20 : 190;
          return (
            <g key={head}>
              <rect x={x} y={y} width={200} height={90} rx={8} strokeWidth={2} className={BOX} />
              <text x={x + 100} y={y + 40} textAnchor="middle" className={HEAD}>
                {head}
              </text>
              <text x={x + 100} y={y + 62} textAnchor="middle" className={SUB}>
                {sub}
              </text>
            </g>
          );
        })}
        {[0, 1, 3, 4].map((i) => {
          const x = 20 + (i % 3) * 240 + 200;
          const y = i < 3 ? 65 : 235;
          return (
            <line
              key={i}
              x1={x + 2}
              y1={y}
              x2={x + 38}
              y2={y}
              strokeWidth={2}
              className="stroke-fg"
              markerEnd="url(#flow-h-arrow)"
            />
          );
        })}
        <polyline
          points="600,110 600,150 120,150 120,188"
          fill="none"
          strokeWidth={2}
          className="stroke-fg"
          markerEnd="url(#flow-h-arrow)"
        />
      </svg>

      {/* Por debajo de sm: una columna */}
      <svg
        role="img"
        viewBox="0 0 320 480"
        className="block h-auto w-full sm:hidden"
        aria-labelledby="flow-v-title flow-v-desc"
      >
        <title id="flow-v-title">{TITLE}</title>
        <desc id="flow-v-desc">{DESC}</desc>
        <Defs id="flow-v-arrow" />
        {LABELS.map(([head, sub], i) => {
          const y = i * 84;
          return (
            <g key={head}>
              <rect x={10} y={y} width={300} height={60} rx={8} strokeWidth={2} className={BOX} />
              <text x={160} y={y + 26} textAnchor="middle" className={HEAD}>
                {head}
              </text>
              <text x={160} y={y + 45} textAnchor="middle" className={SUB}>
                {sub}
              </text>
              {i < LABELS.length - 1 ? (
                <line
                  x1={160}
                  y1={y + 62}
                  x2={160}
                  y2={y + 82}
                  strokeWidth={2}
                  className="stroke-fg"
                  markerEnd="url(#flow-v-arrow)"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
