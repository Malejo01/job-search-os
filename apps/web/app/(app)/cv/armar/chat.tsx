"use client";

import type { CvChatState, CvDocument, CvHistoryInput } from "@job-search-os/pipeline";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CvPreview } from "@/components/cv-preview";

/**
 * Chat de CV (C-25, CVC-5). Cliente: lleva el estado de la charla en memoria y lo manda en cada pedido a
 * `/api/cv-chat`; no se guarda nada hasta que la persona confirma al final. Ningún secreto acá: el ticket
 * es solo una prueba firmada por el servidor del id de la charla y de los turnos.
 */
type Msg = { role: "assistant" | "user"; text: string };
type Phase = "intro" | "chat" | "review" | "preview" | "done";
type Notice = { message: string; links?: { label: string; href: string }[] };
type Written = { history: CvHistoryInput[]; summary: string | null };

type ApiOk = Record<string, unknown> & { ok: true };
type ApiErr = {
  ok: false;
  error: string;
  message: string;
  links?: { label: string; href: string }[];
};

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50";
const PRIMARY = `${BUTTON} bg-brand text-brand-contrast hover:bg-brand-hover`;
const SECONDARY = `${BUTTON} border border-line-strong text-fg hover:bg-surface-muted`;
const FIELD =
  "min-h-11 w-full rounded-control border border-line-control bg-surface px-3 py-2 text-base text-fg focus-visible:outline-focus";

async function post(body: Record<string, unknown>): Promise<ApiOk | ApiErr> {
  try {
    const res = await fetch("/api/cv-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as ApiOk | ApiErr;
  } catch {
    return { ok: false, error: "network", message: "No hay conexión. Probá de nuevo." };
  }
}

const lines = (s: string, max: number): string[] =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, max);

const csv = (s: string, max: number): string[] =>
  s
    .split(",")
    .map((l) => l.trim().slice(0, 60))
    .filter((l) => l !== "")
    .slice(0, max);

export function CvChat() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [ticket, setTicket] = useState("");
  const [state, setState] = useState<CvChatState | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [lang, setLang] = useState<"es" | "en">("es");
  const [doc, setDoc] = useState<CvDocument | null>(null);
  const [written, setWritten] = useState<Written | null>(null);
  const [usedModel, setUsedModel] = useState(false);
  const [saved, setSaved] = useState<{ inserted: number; updated: number } | null>(null);

  const answerRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Foco: al cambiar de etapa, al título de la etapa; en el chat, al cuadro de respuesta
  useEffect(() => {
    if (phase === "chat") answerRef.current?.focus();
    else if (phase !== "intro") headingRef.current?.focus();
  }, [phase]);

  function fail(r: ApiErr) {
    setNotice({ message: r.message, links: r.links });
  }

  async function start() {
    setBusy(true);
    setNotice(null);
    const r = await post({ action: "start" });
    setBusy(false);
    if (!r.ok) return fail(r);
    setTicket(String(r.ticket));
    setState(r.state as CvChatState);
    setProgress(r.progress as { done: number; total: number });
    setMessages([{ role: "assistant", text: String(r.question ?? "") }]);
    setPhase("chat");
  }

  async function send(action: "turn" | "skip") {
    if (!state || busy) return;
    const message = draft.trim();
    if (action === "turn" && message === "") {
      setNotice({ message: "Escribí una respuesta o tocá «Saltear»." });
      answerRef.current?.focus();
      return;
    }
    setBusy(true);
    setNotice(null);
    const r = await post(
      action === "turn" ? { action, ticket, state, message } : { action, ticket, state },
    );
    setBusy(false);
    if (!r.ok) {
      fail(r);
      answerRef.current?.focus();
      return;
    }
    const added: Msg[] = [
      { role: "user", text: action === "turn" ? message : "(salteado)" },
      ...(r.ack ? [{ role: "assistant" as const, text: String(r.ack) }] : []),
      ...(r.question ? [{ role: "assistant" as const, text: String(r.question) }] : []),
    ];
    setMessages((m) => [...m, ...added]);
    setTicket(String(r.ticket));
    setState(r.state as CvChatState);
    setProgress(r.progress as { done: number; total: number });
    setDraft("");
    if (r.closed) setPhase("review");
    else answerRef.current?.focus();
  }

  async function write() {
    if (!state || busy) return;
    setBusy(true);
    setNotice(null);
    const r = await post({ action: "write", ticket, state, lang });
    setBusy(false);
    if (!r.ok) return fail(r);
    setTicket(String(r.ticket));
    setDoc(r.doc as CvDocument);
    setWritten(r.written as Written);
    setUsedModel(Boolean(r.usedModel));
    setPhase("preview");
  }

  async function confirm() {
    if (!written || busy) return;
    setBusy(true);
    setNotice(null);
    const r = await post({ action: "confirm", ticket, history: written.history });
    setBusy(false);
    if (!r.ok) return fail(r);
    setSaved(r.saved as { inserted: number; updated: number });
    setPhase("done");
  }

  const alert = notice ? (
    <div role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
      <p>{notice.message}</p>
      {notice.links && notice.links.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {notice.links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="underline">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  ) : null;

  if (phase === "intro") {
    return (
      <section className="flex flex-col gap-3" aria-label="Cómo funciona">
        <p className="text-sm text-fg-muted">
          Te hago preguntas de a una (puesto, experiencia, estudios, skills, idiomas y links), vos
          corregís lo que entendí y al final armo un CV en formato ATS. La IA redacta las viñetas,
          pero un control descarta cualquier cifra, nombre o tecnología que vos no hayas dicho. Nada
          se guarda hasta que lo confirmes.
        </p>
        <p className="text-sm text-fg-muted">
          Si tenés un CV hecho, no lo pegues acá: cargá tu historial a mano.
        </p>
        {alert}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={start} disabled={busy} className={PRIMARY}>
            Empezar
          </button>
          <Link href="/cv" className={SECONDARY}>
            Volver a Tu CV
          </Link>
        </div>
      </section>
    );
  }

  if (phase === "chat" && state) {
    return (
      <section className="flex flex-col gap-3" aria-label="Charla">
        {progress ? (
          <p className="text-sm text-fg-muted" data-testid="cv-progress">
            Avance: {progress.done} de {progress.total} temas
          </p>
        ) : null}
        <div
          role="log"
          aria-live="polite"
          aria-label="Mensajes"
          data-testid="cv-messages"
          className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-card border border-line bg-surface p-3"
        >
          {messages.map((m, i) => (
            <p
              key={i}
              className={
                m.role === "assistant"
                  ? "max-w-[90%] self-start break-words rounded-control bg-surface-muted px-3 py-2 text-sm text-fg"
                  : "max-w-[90%] self-end break-words rounded-control bg-brand px-3 py-2 text-sm text-brand-contrast"
              }
            >
              <span className="sr-only">{m.role === "assistant" ? "Asistente: " : "Vos: "}</span>
              {m.text}
            </p>
          ))}
        </div>
        {alert}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send("turn");
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="cv-answer" className="text-sm font-medium text-fg">
            Tu respuesta
          </label>
          <textarea
            id="cv-answer"
            ref={answerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            disabled={busy}
            className={FIELD}
          />
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className={PRIMARY}>
              Enviar
            </button>
            <button
              type="button"
              onClick={() => void send("skip")}
              disabled={busy}
              className={SECONDARY}
            >
              Saltear
            </button>
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                setPhase("review");
              }}
              disabled={busy}
              className={SECONDARY}
            >
              Terminar y armar
            </button>
          </div>
        </form>
      </section>
    );
  }

  if (phase === "review" && state) {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="cv-review">
        <h2 id="cv-review" ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-fg">
          Esto es lo que entendí
        </h2>
        <p className="text-sm text-fg-muted">
          Corregí lo que haga falta. Si algo está vacío, queda vacío: no lo completo yo.
        </p>
        <ReviewEditor state={state} onChange={setState} />
        {alert}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-fg">
            Idioma del CV
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value === "en" ? "en" : "es")}
              className="min-h-11 rounded-control border border-line-control bg-surface px-2 text-base text-fg focus-visible:outline-focus"
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </label>
          <button type="button" onClick={write} disabled={busy} className={PRIMARY}>
            {busy ? "Armando…" : "Armar mi CV"}
          </button>
          <button
            type="button"
            onClick={() => setPhase("chat")}
            disabled={busy}
            className={SECONDARY}
          >
            Seguir charlando
          </button>
        </div>
      </section>
    );
  }

  if (phase === "preview" && doc && written) {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="cv-preview-title">
        <h2
          id="cv-preview-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold text-fg"
        >
          Así queda tu CV
        </h2>
        <p className="text-sm text-fg-muted" data-testid="cv-verify-note">
          {usedModel
            ? "Redactado por IA y verificado contra tus respuestas: lo que traía cifras, nombres o tecnologías que no dijiste se reemplazó por tus palabras."
            : "Va con tus palabras, sin redacción de IA."}{" "}
          Al confirmar se guarda tu historial (trabajos, estudios y certificaciones). El resumen,
          las skills, los idiomas y los links de esta charla se ven acá pero todavía no se guardan.
        </p>
        <CvPreview doc={doc} />
        {alert}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={confirm} disabled={busy} className={PRIMARY}>
            Confirmar y guardar en mi historial
          </button>
          <Link href="/cv" className={SECONDARY}>
            Descartar
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="cv-done">
      <h2 id="cv-done" ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-fg">
        Listo
      </h2>
      <p role="status" className="text-sm text-fg-muted" data-testid="cv-saved">
        Guardamos {saved?.inserted ?? 0}{" "}
        {saved?.inserted === 1 ? "entrada nueva" : "entradas nuevas"}
        {saved && saved.updated > 0 ? ` y actualizamos ${saved.updated}` : ""} en tu historial.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/cv" className={PRIMARY}>
          Ver mi CV
        </Link>
        <a href={`/api/cv/docx?lang=${lang}`} download className={SECONDARY}>
          Descargar DOCX
        </a>
      </div>
    </section>
  );
}

/** Igual que las skills: el texto crudo vive acá, el estado recibe las líneas ya limpias. */
function DutiesField({
  n,
  duties,
  onChange,
}: {
  n: number;
  duties: string[];
  onChange: (duties: string[]) => void;
}) {
  const [text, setText] = useState(duties.join("\n"));
  return (
    <label className="flex flex-col gap-1 text-sm text-fg">
      Qué hacías {n} (una por línea)
      <textarea
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(lines(e.target.value, 4).map((l) => l.slice(0, 220)));
        }}
        className={FIELD}
      />
    </label>
  );
}

/** El texto se guarda aparte: con la coma al final, `join` la borraría mientras la persona escribe. */
function SkillsField({
  skills,
  onChange,
}: {
  skills: string[];
  onChange: (skills: string[]) => void;
}) {
  const [text, setText] = useState(skills.join(", "));
  return (
    <label className="flex flex-col gap-1 text-sm text-fg">
      Skills (separadas por coma)
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(csv(e.target.value, 40));
        }}
        className={FIELD}
      />
    </label>
  );
}

function ReviewEditor({
  state,
  onChange,
}: {
  state: CvChatState;
  onChange: (s: CvChatState) => void;
}) {
  // Al quitar un trabajo se vuelven a montar los campos con texto propio (tareas), para no mezclarlos
  const [version, setVersion] = useState(0);
  const set = (patch: Partial<CvChatState>) => onChange({ ...state, ...patch });
  const setWork = (i: number, patch: Partial<CvChatState["works"][number]>) =>
    set({ works: state.works.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const empty = <p className="text-sm text-fg-subtle">Nada cargado.</p>;

  return (
    <div className="flex flex-col gap-4" data-testid="cv-card">
      <fieldset className="flex flex-col gap-2 rounded-card border border-line p-3">
        <legend className="px-1 text-base font-medium text-fg">Puesto objetivo</legend>
        <label className="flex flex-col gap-1 text-sm text-fg">
          Puesto
          <input
            value={state.target ?? ""}
            maxLength={120}
            onChange={(e) => set({ target: e.target.value === "" ? null : e.target.value })}
            className={FIELD}
          />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-card border border-line p-3">
        <legend className="px-1 text-base font-medium text-fg">Experiencia</legend>
        {state.works.length === 0 ? empty : null}
        {state.works.map((w, i) => (
          <div
            key={`${version}-${i}`}
            className="flex flex-col gap-2 border-b border-line pb-3 last:border-0"
          >
            <label className="flex flex-col gap-1 text-sm text-fg">
              Empresa {i + 1}
              <input
                value={w.organization ?? ""}
                maxLength={120}
                onChange={(e) => setWork(i, { organization: e.target.value || null })}
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg">
              Cargo {i + 1}
              <input
                value={w.title ?? ""}
                maxLength={120}
                onChange={(e) => setWork(i, { title: e.target.value || null })}
                className={FIELD}
              />
            </label>
            <DutiesField
              n={i + 1}
              duties={w.duties}
              onChange={(duties) => setWork(i, { duties })}
            />
            <label className="flex flex-col gap-1 text-sm text-fg">
              Logro {i + 1}
              <input
                value={w.achievement ?? ""}
                maxLength={220}
                onChange={(e) => setWork(i, { achievement: e.target.value || null })}
                className={FIELD}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                set({ works: state.works.filter((_, j) => j !== i) });
                setVersion((v) => v + 1);
              }}
              className={`${SECONDARY} self-start`}
            >
              Quitar trabajo {i + 1}
            </button>
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-card border border-line p-3">
        <legend className="px-1 text-base font-medium text-fg">Estudios y certificaciones</legend>
        {state.education.length + state.certifications.length === 0 ? empty : null}
        {state.education.map((e, i) => (
          <div key={`e${i}`} className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm text-fg">
              Institución {i + 1}
              <input
                value={e.institution}
                maxLength={120}
                onChange={(ev) =>
                  set({
                    education: state.education.map((x, j) =>
                      j === i ? { ...x, institution: ev.target.value } : x,
                    ),
                  })
                }
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg">
              Título {i + 1}
              <input
                value={e.title}
                maxLength={120}
                onChange={(ev) =>
                  set({
                    education: state.education.map((x, j) =>
                      j === i ? { ...x, title: ev.target.value } : x,
                    ),
                  })
                }
                className={FIELD}
              />
            </label>
            <button
              type="button"
              onClick={() => set({ education: state.education.filter((_, j) => j !== i) })}
              className={`${SECONDARY} self-start`}
            >
              Quitar estudio {i + 1}
            </button>
          </div>
        ))}
        {state.certifications.map((c, i) => (
          <div key={`c${i}`} className="flex items-center justify-between gap-2 text-sm text-fg">
            <span className="break-words">
              {c.title} ({c.issuer})
            </span>
            <button
              type="button"
              onClick={() =>
                set({ certifications: state.certifications.filter((_, j) => j !== i) })
              }
              className={SECONDARY}
            >
              Quitar certificación {i + 1}
            </button>
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-card border border-line p-3">
        <legend className="px-1 text-base font-medium text-fg">Skills, idiomas y links</legend>
        <SkillsField skills={state.skills} onChange={(skills) => set({ skills })} />
        <p className="text-sm text-fg-muted">
          Idiomas:{" "}
          {state.languages.length === 0
            ? "ninguno"
            : state.languages.map((l) => (l.level ? `${l.name} ${l.level}` : l.name)).join(", ")}
        </p>
        <p className="text-sm text-fg-muted">
          Links:{" "}
          {[state.links.linkedin, state.links.github, state.links.portfolio]
            .filter(Boolean)
            .join(" | ") || "ninguno"}
        </p>
      </fieldset>
    </div>
  );
}
