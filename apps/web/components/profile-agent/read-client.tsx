"use client";

import {
  CV_MAX_FILE_BYTES,
  PROFILE_AGENT_API,
  PROFILE_AGENT_STORAGE_KEYS,
  checkProfileReadText,
  initialProfileAgentState,
  parseStoredRead,
  profileReadFallbacks,
  profileReadInputNotice,
  pruneStoredRead,
  type ProfileAgentBase,
  type ProfileReadFallback,
  type ProfileReadInputProblem,
  type ProfileReadProposal,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { useId, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";
import { ProfileCards } from "./cards";
import { extractCvText } from "./extract-text";

/**
 * Subir el CV y leerlo (ADR-034 §9, R10-1). Cliente: el archivo se lee en el navegador y no se sube; al
 * servidor va solo el texto que la persona ve y confirma en el cuadro. Nada se guarda: el texto no se
 * conserva después de leer, y el ticket de la charla vive en `sessionStorage` (nunca `localStorage`).
 * R10-2: con la lectura hecha, esta misma pantalla muestra las tarjetas editables (`cards.tsx`).
 */
type Summary = {
  experience: number;
  education: number;
  skills: number;
  languages: number;
  dropped: number;
  suggestedRoles: string[];
};

type Notice = { message: string; fallbacks: ProfileReadFallback[] };

type ApiResponse =
  | { ok: true; ticket: string; summary: Summary; proposal: ProfileReadProposal }
  | { ok: false; error: string; message: string; links?: ProfileReadFallback[] };

type Done = {
  ticket: string;
  summary: Summary;
  proposal: ProfileReadProposal;
  settled: boolean;
};

/** Lo que la pestaña guardó de la lectura (ticket y propuesta), como un solo texto que se compara por valor. */
const EMPTY_STORED = JSON.stringify([null, null]);
const subscribeNothing = (): (() => void) => () => {};
const serverStored = (): string => EMPTY_STORED;
function readStored(): string {
  try {
    return JSON.stringify([
      window.sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.ticket),
      window.sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.read),
    ]);
  } catch {
    // sessionStorage bloqueado: la persona vuelve a leer
    return EMPTY_STORED;
  }
}

const MAX_MB = Math.round(CV_MAX_FILE_BYTES / (1024 * 1024));
const PRIMARY = buttonClasses();
const SECONDARY = buttonClasses({ variant: "secondary" });
const TEXTAREA = inputClasses({ multiline: true });

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Qué se encontró, en una frase. Solo conteos: nada del texto del CV. */
export function summaryLine(s: Summary): string {
  return [
    plural(s.experience, "trabajo", "trabajos"),
    plural(s.education, "estudio", "estudios"),
    plural(s.skills, "skill", "skills"),
    plural(s.languages, "idioma", "idiomas"),
  ].join(", ");
}

export function ReadClient({ base }: { base: ProfileAgentBase }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Recargar antes de guardar las tarjetas no debe gastar otra lectura del cupo: si la pestaña guardó la
  // propuesta de esta charla (atada al ticket), se vuelve a mostrar sin llamar al servidor (R11-1). En el
  // servidor y en la hidratación no hay nada guardado; después de montar, el navegador la entrega.
  const stored = useSyncExternalStore(subscribeNothing, readStored, serverStored);
  const restored = useMemo((): Done | null => {
    const [ticket, raw] = JSON.parse(stored) as [string | null, string | null];
    const saved = parseStoredRead(raw, ticket);
    if (!saved) return null;
    return {
      // el ticket vigente (las etapas siguientes lo reemiten con otro vencimiento)
      ticket: ticket ?? saved.ticket,
      summary: saved.summary,
      proposal: saved.proposal,
      settled: saved.settled === true,
    };
  }, [stored]);
  const view = done ?? restored;

  /** Las tarjetas ya resueltas no vuelven al recargar. */
  function onResolved(ids: string[]) {
    try {
      const ticket = sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.ticket);
      const saved = parseStoredRead(
        sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.read),
        ticket,
      );
      if (saved) {
        sessionStorage.setItem(
          PROFILE_AGENT_STORAGE_KEYS.read,
          JSON.stringify(pruneStoredRead(saved, ids)),
        );
      }
    } catch {
      // sin almacenamiento: al recargar se lee de nuevo
    }
  }
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileId = useId();
  const textId = useId();

  function showProblem(problem: ProfileReadInputProblem) {
    setInfo(null);
    setNotice(profileReadInputNotice(problem, base));
    if (problem === "pdf_paste" || problem === "text_too_short") textRef.current?.focus();
  }

  async function pick(file: File | undefined) {
    if (!file || busy) return;
    setNotice(null);
    setInfo(null);
    setBusy(true);
    const r = await extractCvText(file);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!r.ok) return showProblem(r.problem);
    setText(r.text);
    setInfo("Leímos el texto de tu archivo. Revisalo y tocá «Leer mi CV». El archivo no se subió.");
    textRef.current?.focus();
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragging(false);
    void pick(e.dataTransfer.files[0]);
  }

  async function read() {
    if (busy) return;
    setNotice(null);
    setInfo(null);
    const checked = checkProfileReadText(text, "paste");
    if (!checked.ok) return showProblem(checked.error);
    setBusy(true);
    let res: ApiResponse;
    try {
      const r = await fetch(PROFILE_AGENT_API.read, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: checked.value }),
      });
      res = (await r.json()) as ApiResponse;
    } catch {
      res = {
        ok: false,
        error: "network",
        message: "No hay conexión. Probá de nuevo; no se descontó de tu cupo.",
      };
    }
    setBusy(false);
    if (!res.ok) {
      const offerFallbacks =
        res.error === "unreadable_result" || res.error === "injection" || res.error === "capped";
      setNotice({
        message: res.message,
        fallbacks: res.links ?? (offerFallbacks ? profileReadFallbacks(base) : []),
      });
      return;
    }
    // El ticket y el estado inicial de la charla viven en esta pestaña; el texto no se conserva
    try {
      sessionStorage.setItem(PROFILE_AGENT_STORAGE_KEYS.ticket, res.ticket);
      sessionStorage.setItem(
        PROFILE_AGENT_STORAGE_KEYS.state,
        JSON.stringify(initialProfileAgentState()),
      );
      // La propuesta (no el texto del CV) queda en la pestaña para sobrevivir a una recarga
      sessionStorage.setItem(
        PROFILE_AGENT_STORAGE_KEYS.read,
        JSON.stringify({ ticket: res.ticket, summary: res.summary, proposal: res.proposal }),
      );
    } catch {
      // sessionStorage bloqueado: la lectura se muestra igual y las etapas que siguen vuelven a empezar
    }
    setText("");
    setDone({ ticket: res.ticket, summary: res.summary, proposal: res.proposal, settled: false });
  }

  // R10-2: las tarjetas editables sobre la misma pantalla. Nada se guardó todavía
  if (view) {
    return (
      <ProfileCards
        base={base}
        ticket={view.ticket}
        summaryLine={summaryLine(view.summary)}
        proposal={view.proposal}
        settled={view.settled}
        onResolved={onResolved}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="profile-read">
      <p className="text-sm text-fg-muted">
        Tu archivo no se sube: el texto se lee en tu navegador y solo ese texto, que vas a poder
        revisar, se manda para leerlo. No guardamos ni el archivo ni el texto: solo lo que vos
        confirmes después.
      </p>

      <label
        htmlFor={fileId}
        data-testid="profile-read-zone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cardClasses({
          padding: "md",
          surface: "none",
          className: `flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 border-dashed text-center ${
            dragging ? "border-line-ink" : ""
          }`,
        })}
      >
        <span className="text-base font-bold text-fg">Elegí o arrastrá tu CV</span>
        <span className="text-sm text-fg-muted">PDF o DOCX, hasta {MAX_MB} MB</span>
        <input
          ref={fileRef}
          id={fileId}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          disabled={busy}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={textId} className="text-sm font-medium text-fg">
          O pegá el texto de tu CV
        </label>
        <textarea
          ref={textRef}
          id={textId}
          data-testid="profile-read-text"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          className={TEXTAREA}
        />
      </div>

      {info ? (
        <Alert tone="info" role="status">
          {info}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="danger" role="alert" data-testid="profile-read-notice">
          <p>{notice.message}</p>
          {notice.fallbacks.length > 0 ? (
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {notice.fallbacks.map((f) => (
                <li key={f.href}>
                  <Link href={f.href} className="font-semibold underline underline-offset-2">
                    {f.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="profile-read-submit"
          onClick={() => void read()}
          disabled={busy || text.trim() === ""}
          className={PRIMARY}
        >
          {busy ? "Leyendo…" : "Leer mi CV"}
        </button>
        <Link href={base === "app" ? "/cv" : "/onboarding"} className={SECONDARY}>
          {base === "app" ? "Volver a Tu CV" : "Prefiero completarlo a mano"}
        </Link>
      </div>
    </div>
  );
}
