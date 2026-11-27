"use client";

import { CV_CHAT_MAX_WORKS, type CvChatState } from "@job-search-os/pipeline";
import { useId, useState } from "react";
import { VoiceInput } from "@/components/voice-input-lazy";
import { Badge, buttonClasses, cardClasses, inputClasses } from "@/components/ui";
import { CV_CALIDAD_TEXTOS } from "@/lib/textos-rediseno";

/**
 * «Esto es lo que entendí» (R33-05, C-26 a C-35). Cliente: edita el estado de la charla en memoria; nada se
 * guarda hasta «Guardar y ver mi CV». Lo vacío queda vacío: los ejemplos son `placeholder` (gris, con
 * contraste), nunca un valor, y cada campo vacío dice «Sin completar». Las filas que todavía no son válidas
 * para el servidor (estudio sin título, link sin https) viven acá y no entran al estado hasta completarse:
 * el esquema de `/api/cv-chat` rechaza el estado entero si una fila viene a medias.
 */
const T = CV_CALIDAD_TEXTOS.revision;

const SECONDARY = buttonClasses({ variant: "secondary" });
const SECONDARY_SM = buttonClasses({ variant: "secondary", size: "sm" });
const FIELD = inputClasses();
const TEXTAREA = inputClasses({ multiline: true });
const FIELDSET = cardClasses({ padding: "none", className: "flex flex-col gap-3 p-4 sm:p-5" });
// `float-left w-full`: la leyenda queda dentro del panel (sin borde, una leyenda normal se pega arriba)
const LEGEND = "float-left w-full text-base font-bold text-fg";
const HTTPS = /^https:\/\/\S+$/i;

const lines = (s: string, max: number): string[] =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, max);

type Work = CvChatState["works"][number];

const EMPTY_WORK: Work = {
  organization: null,
  title: null,
  startMonth: null,
  endMonth: null,
  isCurrent: false,
  duties: [],
  achievement: null,
};

/** Campo de una línea: etiqueta, ejemplo en gris y el estado «Sin completar» cuando está vacío. */
function TextField({
  label,
  value,
  onChange,
  maxLength,
  example,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
  example?: string;
}) {
  const id = useId();
  const empty = value.trim() === "";
  return (
    <div className="flex flex-col gap-1 text-sm text-fg">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        placeholder={example ? `${T.ejemplo}${example}` : undefined}
        aria-describedby={empty ? `${id}-vacio` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      />
      {empty ? (
        <span id={`${id}-vacio`} className="self-start">
          <Badge tone="neutral">{T.sinCompletar}</Badge>
        </span>
      ) : null}
    </div>
  );
}

/** Igual que las skills: el texto crudo vive acá, el estado recibe las líneas ya limpias. */
function DutiesField({
  n,
  duties,
  onChange,
  serverTranscribe,
}: {
  n: number;
  duties: string[];
  onChange: (duties: string[]) => void;
  serverTranscribe: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(duties.join("\n"));
  const update = (next: string) => {
    setText(next);
    onChange(lines(next, 4).map((l) => l.slice(0, 220)));
  };
  const empty = text.trim() === "";
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-fg">
        Qué hacías {n} (una por línea)
      </label>
      <textarea
        id={id}
        rows={3}
        value={text}
        placeholder={`${T.ejemplo}Armaba reportes semanales para el equipo`}
        aria-describedby={empty ? `${id}-vacio` : undefined}
        onChange={(e) => update(e.target.value)}
        className={TEXTAREA}
      />
      {empty ? (
        <span id={`${id}-vacio`} className="self-start">
          <Badge tone="neutral">{T.sinCompletar}</Badge>
        </span>
      ) : null}
      {/* Una tarea por línea: lo dictado entra como línea nueva, no pegado con espacio */}
      <VoiceInput
        serverTranscribe={serverTranscribe}
        label={`Dictar tareas ${n}`}
        // C-33: el aviso de privacidad una sola vez (en el primero), en un ⓘ; en los demás, oculto
        privacy={n === 1 ? "info" : "hidden"}
        onText={(spoken) => {
          const said = spoken.trim();
          if (said === "") return;
          update(text.trim() === "" ? said : `${text.replace(/\s+$/, "")}\n${said}`);
        }}
      />
    </div>
  );
}

/** Skills como chips que se quitan, con campo libre y sugerencias opcionales para marcar (C-30). */
function SkillsField({
  skills,
  suggestions,
  onChange,
}: {
  skills: string[];
  suggestions: readonly string[];
  onChange: (skills: string[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const has = (s: string) => skills.some((x) => x.toLowerCase() === s.toLowerCase());
  const add = (raw: string) => {
    const s = raw.trim().slice(0, 60);
    if (s === "" || has(s) || skills.length >= 40) return;
    onChange([...skills, s]);
  };
  const offered = suggestions.filter((s) => !has(s)).slice(0, 12);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-fg">
        {T.skillsTitulo}
      </label>
      {skills.length === 0 ? (
        <span className="self-start">
          <Badge tone="neutral">{T.sinCompletar}</Badge>
        </span>
      ) : (
        <ul
          aria-label="Tus habilidades"
          className="flex flex-wrap gap-2"
          data-testid="cv-skill-chips"
        >
          {skills.map((s) => (
            <li key={s}>
              <button
                type="button"
                aria-label={`Quitar la habilidad ${s}`}
                onClick={() => onChange(skills.filter((x) => x !== s))}
                className={SECONDARY_SM}
              >
                {s} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <input
          id={id}
          value={text}
          maxLength={60}
          aria-describedby={`${id}-ayuda`}
          placeholder={`${T.ejemplo}Excel`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(text);
              setText("");
            }
          }}
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button
          type="button"
          onClick={() => {
            add(text);
            setText("");
          }}
          className={SECONDARY}
        >
          {T.skillsAgregar}
        </button>
      </div>
      <p id={`${id}-ayuda`} className="text-sm text-fg-muted">
        {T.skillsAyuda}
      </p>
      {offered.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="cv-skill-sugerencias">
          <p className="text-sm font-medium text-fg">
            {T.skillsSugerencias} <span className="font-normal">({T.skillsSugerenciaAviso})</span>
          </p>
          <ul className="flex flex-wrap gap-2">
            {offered.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  aria-pressed={false}
                  onClick={() => add(s)}
                  className={SECONDARY_SM}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Estudios y certificaciones: filas locales; al estado pasan solo las que tienen institución y título. */
type StudyRow = { kind: "edu" | "cert"; place: string; title: string };

function StudiesField({
  state,
  set,
}: {
  state: CvChatState;
  set: (patch: Partial<CvChatState>) => void;
}) {
  const [rows, setRows] = useState<StudyRow[]>(() => [
    ...state.education.map((e) => ({ kind: "edu" as const, place: e.institution, title: e.title })),
    ...state.certifications.map((c) => ({
      kind: "cert" as const,
      place: c.issuer,
      title: c.title,
    })),
  ]);
  // Lo que ya tenían fechas conserva sus meses: se busca por posición dentro de cada tipo
  const push = (next: StudyRow[]) => {
    setRows(next);
    const valid = (r: StudyRow) => r.place.trim() !== "" && r.title.trim() !== "";
    const edu = next.filter((r) => r.kind === "edu" && valid(r));
    const cert = next.filter((r) => r.kind === "cert" && valid(r));
    set({
      education: edu.slice(0, 5).map((r, i) => ({
        institution: r.place.trim(),
        title: r.title.trim(),
        startMonth: state.education[i]?.startMonth ?? null,
        endMonth: state.education[i]?.endMonth ?? null,
      })),
      certifications: cert.slice(0, 8).map((r, i) => ({
        issuer: r.place.trim(),
        title: r.title.trim(),
        startMonth: state.certifications[i]?.startMonth ?? null,
      })),
    });
  };
  const change = (i: number, patch: Partial<StudyRow>) =>
    push(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const eduCount = rows.filter((r) => r.kind === "edu").length;
  const certCount = rows.filter((r) => r.kind === "cert").length;
  const canAdd = eduCount < 5 || certCount < 8;

  return (
    <fieldset className={FIELDSET}>
      <legend className={LEGEND}>Estudios y certificaciones</legend>
      {rows.length === 0 ? <p className="text-sm text-fg-muted">{T.estudiosVacio}</p> : null}
      {rows.map((r, i) => {
        const n = i + 1;
        const incomplete = r.place.trim() === "" || r.title.trim() === "";
        return (
          <div key={i} className="flex flex-col gap-2 border-b border-line pb-3 last:border-0">
            <label className="flex flex-col gap-1 text-sm text-fg">
              Tipo {n}
              <select
                aria-label={`Tipo ${n}`}
                value={r.kind}
                onChange={(e) => change(i, { kind: e.target.value === "cert" ? "cert" : "edu" })}
                className={FIELD}
              >
                <option value="edu">{T.tipoEstudio}</option>
                <option value="cert">{T.tipoCertificacion}</option>
              </select>
            </label>
            <TextField
              label={`${r.kind === "edu" ? "Institución" : "Emisor"} ${n}`}
              value={r.place}
              maxLength={120}
              example={r.kind === "edu" ? "Instituto A" : "Organismo A"}
              onChange={(v) => change(i, { place: v })}
            />
            <TextField
              label={`Título ${n}`}
              value={r.title}
              maxLength={120}
              example="Tecnicatura en Administración"
              onChange={(v) => change(i, { title: v })}
            />
            {incomplete ? <p className="text-sm text-fg-muted">{T.estudioIncompleto}</p> : null}
            <button
              type="button"
              onClick={() => push(rows.filter((_, j) => j !== i))}
              className={`${SECONDARY_SM} self-start`}
            >
              {r.kind === "edu" ? "Quitar estudio" : "Quitar certificación"} {n}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        disabled={!canAdd}
        onClick={() =>
          push([...rows, { kind: eduCount < 5 ? "edu" : "cert", place: "", title: "" }])
        }
        className={`${SECONDARY} self-start`}
      >
        {T.agregarEstudio}
      </button>
    </fieldset>
  );
}

/** Idiomas con el nivel explicado (C-31); el estado guarda solo el código («A2»). */
function LanguagesField({
  languages,
  onChange,
}: {
  languages: CvChatState["languages"];
  onChange: (l: CvChatState["languages"]) => void;
}) {
  const [rows, setRows] = useState<{ name: string; level: string | null }[]>(() =>
    languages.map((l) => ({ ...l })),
  );
  const push = (next: typeof rows) => {
    setRows(next);
    // El esquema pide nombre; un idioma sin nombre queda local hasta que se escribe
    onChange(
      next
        .filter((r) => r.name.trim() !== "")
        .slice(0, 6)
        .map((r) => ({ name: r.name.trim().slice(0, 40), level: r.level })),
    );
  };
  const known = new Set<string>(T.niveles.map((n) => n.value));
  return (
    <div className="flex flex-col gap-3" data-testid="cv-idiomas">
      <p className="text-sm font-medium text-fg">{T.idiomasTitulo}</p>
      {rows.length === 0 ? (
        <span className="self-start">
          <Badge tone="neutral">{T.sinCompletar}</Badge>
        </span>
      ) : null}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label={`${T.idiomaNombre} ${i + 1}`}
              value={r.name}
              maxLength={40}
              example="Inglés"
              onChange={(v) => push(rows.map((x, j) => (j === i ? { ...x, name: v } : x)))}
            />
          </div>
          <label className="flex flex-col gap-1 text-sm text-fg">
            {T.idiomaNivel} {i + 1}
            <select
              // El nombre accesible es solo «Nivel N»: sin esto incluye el texto de todas las opciones
              aria-label={`${T.idiomaNivel} ${i + 1}`}
              value={r.level ?? ""}
              onChange={(e) =>
                push(rows.map((x, j) => (j === i ? { ...x, level: e.target.value || null } : x)))
              }
              className={FIELD}
            >
              <option value="">{T.idiomaSinNivel}</option>
              {r.level && !known.has(r.level) ? <option value={r.level}>{r.level}</option> : null}
              {T.niveles.map((n) => (
                <option key={n.value} value={n.value}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => push(rows.filter((_, j) => j !== i))}
            className={SECONDARY_SM}
          >
            {T.idiomaQuitar} {i + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={rows.length >= 6}
        onClick={() => setRows([...rows, { name: "", level: null }])}
        className={`${SECONDARY} self-start`}
      >
        {T.idiomaAgregar}
      </button>
    </div>
  );
}

/** Link con https obligatorio: un valor a medias o con otro esquema no entra al estado (queda el anterior). */
function LinkField({
  label,
  value,
  onValid,
}: {
  label: string;
  value: string | null | undefined;
  onValid: (v: string | null) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? "");
  const t = text.trim();
  const invalid = t !== "" && (!HTTPS.test(t) || t.length > 200);
  return (
    <div className="flex flex-col gap-1 text-sm text-fg">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="url"
        inputMode="url"
        value={text}
        maxLength={200}
        placeholder={`${T.ejemplo}https://www.example.com/tu-perfil`}
        aria-invalid={invalid}
        aria-describedby={`${id}-ayuda`}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.trim();
          if (v === "") onValid(null);
          else if (HTTPS.test(v) && v.length <= 200) onValid(v);
        }}
        className={FIELD}
      />
      <span
        id={`${id}-ayuda`}
        role={invalid ? "alert" : undefined}
        className={invalid ? "text-danger" : "text-fg-muted"}
      >
        {invalid ? T.linkError : T.linkAyuda}
      </span>
    </div>
  );
}

export function ReviewEditor({
  state,
  onChange,
  serverTranscribe,
  skillSuggestions = [],
}: {
  state: CvChatState;
  onChange: (s: CvChatState) => void;
  serverTranscribe: boolean;
  /** Sugerencias para marcar (R33-05, C-30). Vacío: solo chips y campo libre. */
  skillSuggestions?: readonly string[];
}) {
  // Al quitar o deshacer un trabajo se vuelven a montar los campos con texto propio (tareas)
  const [version, setVersion] = useState(0);
  const [asking, setAsking] = useState<number | null>(null);
  const [undo, setUndo] = useState<{ index: number; work: Work } | null>(null);
  const set = (patch: Partial<CvChatState>) => onChange({ ...state, ...patch });
  const setWork = (i: number, patch: Partial<Work>) =>
    set({ works: state.works.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const canAddWork = state.works.length < CV_CHAT_MAX_WORKS;

  function removeWork(i: number) {
    const work = state.works[i];
    if (!work) return;
    set({ works: state.works.filter((_, j) => j !== i) });
    setUndo({ index: i, work });
    setAsking(null);
    setVersion((v) => v + 1);
  }

  function undoRemove() {
    if (!undo || !canAddWork) return;
    const at = Math.min(undo.index, state.works.length);
    set({ works: [...state.works.slice(0, at), undo.work, ...state.works.slice(at)] });
    setUndo(null);
    setVersion((v) => v + 1);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="cv-card">
      <p className="text-sm text-fg-muted">{T.ejemploAviso}</p>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Puesto objetivo</legend>
        <TextField
          label="Puesto"
          value={state.target ?? ""}
          maxLength={120}
          example="Analista administrativo"
          onChange={(v) => set({ target: v === "" ? null : v })}
        />
      </fieldset>

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Experiencia</legend>
        {state.works.length === 0 ? (
          <p className="text-sm text-fg-muted">Nada cargado todavía.</p>
        ) : null}
        {undo ? (
          <div
            role="status"
            data-testid="cv-trabajo-quitado"
            className="flex flex-wrap items-center gap-3 text-sm text-fg"
          >
            {T.trabajoQuitado}
            <button
              type="button"
              onClick={undoRemove}
              disabled={!canAddWork}
              className={SECONDARY_SM}
            >
              {T.deshacer}
            </button>
          </div>
        ) : null}
        {state.works.map((w, i) => (
          <div
            key={`${version}-${i}`}
            className="flex flex-col gap-2 border-b border-line pb-4 last:border-0"
          >
            <TextField
              label={`Empresa ${i + 1}`}
              value={w.organization ?? ""}
              maxLength={120}
              example="Empresa A"
              onChange={(v) => setWork(i, { organization: v || null })}
            />
            <TextField
              label={`Cargo ${i + 1}`}
              value={w.title ?? ""}
              maxLength={120}
              example="Analista administrativo"
              onChange={(v) => setWork(i, { title: v || null })}
            />
            <DutiesField
              n={i + 1}
              duties={w.duties}
              onChange={(duties) => setWork(i, { duties })}
              serverTranscribe={serverTranscribe}
            />
            <TextField
              label={`Logro ${i + 1}`}
              value={w.achievement ?? ""}
              maxLength={220}
              example="Reduje a la mitad el tiempo de carga de pedidos"
              onChange={(v) => setWork(i, { achievement: v || null })}
            />
            {/* C-27: «Quitar» lejos de los campos, aparte y con confirmación */}
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
              {asking === i ? (
                <div
                  role="group"
                  aria-label={`${T.quitarPregunta} ${i + 1}`}
                  className="flex flex-wrap items-center gap-3"
                >
                  <p className="text-sm font-medium text-fg">
                    {T.quitarPregunta} ({i + 1})
                  </p>
                  <button
                    type="button"
                    onClick={() => removeWork(i)}
                    className={buttonClasses({ variant: "danger", size: "sm" })}
                  >
                    {T.quitar}
                  </button>
                  <button type="button" onClick={() => setAsking(null)} className={SECONDARY_SM}>
                    {T.cancelar}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAsking(i)}
                  aria-label={`${T.quitarTrabajo} ${i + 1}`}
                  className={buttonClasses({ variant: "ghost", size: "sm" })}
                >
                  {T.quitarTrabajo} {i + 1}
                </button>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          disabled={!canAddWork}
          onClick={() => {
            set({ works: [...state.works, { ...EMPTY_WORK }] });
            setVersion((v) => v + 1);
          }}
          className={`${SECONDARY} self-start`}
        >
          {T.agregarTrabajo}
        </button>
      </fieldset>

      {state.projects.length > 0 ? (
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>Proyectos</legend>
          {state.projects.map((p, i) => (
            <div
              key={`p${i}`}
              className="flex flex-col gap-2 border-b border-line pb-3 last:border-0"
            >
              <TextField
                label={`Proyecto ${i + 1}`}
                value={p.name}
                maxLength={120}
                example="Tablero de ventas"
                onChange={(v) =>
                  set({ projects: state.projects.map((x, j) => (j === i ? { ...x, name: v } : x)) })
                }
              />
              <TextField
                label={`Qué es ${i + 1}`}
                value={p.description ?? ""}
                maxLength={220}
                example="Un tablero que resume las ventas por mes"
                onChange={(v) =>
                  set({
                    projects: state.projects.map((x, j) =>
                      j === i ? { ...x, description: v || null } : x,
                    ),
                  })
                }
              />
              {/* Detalle del proyecto: un link largo se corta en cualquier punto para no desbordar a 360 px */}
              {p.role || p.link || p.stack.length > 0 ? (
                <p className="text-sm text-fg-muted [overflow-wrap:anywhere]">
                  {[p.role, p.link, p.stack.length > 0 ? `Stack: ${p.stack.join(", ")}` : null]
                    .filter(Boolean)
                    .join(" | ")}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => set({ projects: state.projects.filter((_, j) => j !== i) })}
                className={`${SECONDARY_SM} self-start`}
              >
                Quitar proyecto {i + 1}
              </button>
            </div>
          ))}
        </fieldset>
      ) : null}

      <StudiesField state={state} set={set} />

      <fieldset className={FIELDSET}>
        <legend className={LEGEND}>Skills, idiomas y links</legend>
        <SkillsField
          skills={state.skills}
          suggestions={skillSuggestions}
          onChange={(skills) => set({ skills })}
        />
        <LanguagesField languages={state.languages} onChange={(languages) => set({ languages })} />
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-fg">{T.linksTitulo}</p>
          <LinkField
            label={T.linkLinkedin}
            value={state.links.linkedin}
            onValid={(v) => set({ links: { ...state.links, linkedin: v } })}
          />
          <LinkField
            label={T.linkGithub}
            value={state.links.github}
            onValid={(v) => set({ links: { ...state.links, github: v } })}
          />
          <LinkField
            label={T.linkPortfolio}
            value={state.links.portfolio}
            onValid={(v) => set({ links: { ...state.links, portfolio: v } })}
          />
        </div>
      </fieldset>
    </div>
  );
}
