"use client";

import {
  PROFILE_AGENT_API,
  PROFILE_AGENT_STORAGE_KEYS,
  SELF_LEVELS,
  initialProfileAgentState,
  parseProfileAgentState,
  profileAgentPath,
  type ProfileAgentBase,
  type ProfileGapCard,
  type ProfileGapQuestion,
  type ProfileGapState,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";

/**
 * Charla de huecos del agente de perfil (ADR-034, R10-3). Una pregunta por vez, tomada de las plantillas
 * por carrera (el modelo no las redacta). Cada respuesta que cambia el perfil vuelve como tarjeta y solo se
 * guarda con «Confirmar». La charla no se guarda: el ticket y el estado viven en `sessionStorage` (nunca
 * `localStorage`) y el estado no tiene dónde llevar el texto del CV ni las respuestas. Sin secretos acá.
 */
type Notice = { message: string; links?: { label: string; href: string }[] };
type ApiOk = Record<string, unknown> & { ok: true };
type ApiErr = {
  ok: false;
  error: string;
  message: string;
  links?: { label: string; href: string }[];
  href?: string;
};

const PRIMARY = buttonClasses();
const SECONDARY = buttonClasses({ variant: "secondary" });
const TEXTAREA = inputClasses({ multiline: true });
const PANEL = cardClasses({ padding: "none", className: "flex flex-col gap-3 p-4 sm:p-5" });

async function post(body: Record<string, unknown>): Promise<ApiOk | ApiErr> {
  try {
    const res = await fetch(PROFILE_AGENT_API.gaps, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as ApiOk | ApiErr;
  } catch {
    return { ok: false, error: "network", message: "No hay conexión. Probá de nuevo." };
  }
}

function readSession(): { ticket: string | null; gaps: ProfileGapState | null } {
  try {
    const ticket = window.sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.ticket);
    const raw = window.sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.state);
    const state = raw ? parseProfileAgentState(JSON.parse(raw)) : null;
    return { ticket, gaps: state?.gaps ?? null };
  } catch {
    return { ticket: null, gaps: null };
  }
}

function writeSession(ticket: string, gaps: ProfileGapState): void {
  try {
    const raw = window.sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.state);
    let current = null;
    try {
      current = raw ? parseProfileAgentState(JSON.parse(raw)) : null;
    } catch {
      current = null;
    }
    const next = { ...(current ?? initialProfileAgentState()), stage: "gaps" as const, gaps };
    window.sessionStorage.setItem(PROFILE_AGENT_STORAGE_KEYS.ticket, ticket);
    window.sessionStorage.setItem(PROFILE_AGENT_STORAGE_KEYS.state, JSON.stringify(next));
  } catch {
    // sin almacenamiento de sesión: la charla sigue en memoria
  }
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const monthLabel = (m: string | null): string => {
  const match = m ? /^(\d{4})-(\d{2})$/.exec(m) : null;
  return match ? `${MONTHS[Number(match[2]) - 1] ?? match[2]} de ${match[1]}` : "sin dato";
};

/** Qué cambiaría la tarjeta, en palabras; el texto de la persona va como texto de React, nunca como HTML. */
function describeCard(card: ProfileGapCard): { title: string; lines: string[] } {
  switch (card.field) {
    case "achievement":
      return { title: "Sumar este logro", lines: [card.bullet] };
    case "duties":
      return { title: "Sumar estas tareas", lines: card.bullets };
    case "dates":
      return {
        title: "Guardar estas fechas",
        lines: [
          `Desde: ${monthLabel(card.startMonth)}`,
          card.isCurrent ? "Hasta: sigo en este trabajo" : `Hasta: ${monthLabel(card.endMonth)}`,
        ],
      };
    case "skill_level": {
      const label = SELF_LEVELS.find((l) => l.level === card.level)?.label ?? "";
      return { title: "Guardar este nivel", lines: [`${card.name}: ${label}`] };
    }
  }
}

type Phase = "loading" | "question" | "card" | "done";

export function ProfileGaps({ base }: { base: ProfileAgentBase }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [ticket, setTicket] = useState("");
  const [gaps, setGaps] = useState<ProfileGapState | null>(null);
  const [question, setQuestion] = useState<ProfileGapQuestion | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [card, setCard] = useState<ProfileGapCard | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savedCount, setSavedCount] = useState(0);

  const answerRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);

  const guideHref = profileAgentPath(base, "guide");

  const apply = useCallback((r: ApiOk, extra?: { keepCard?: boolean }) => {
    const nextTicket = String(r.ticket);
    const nextGaps = r.gaps as ProfileGapState;
    setTicket(nextTicket);
    setGaps(nextGaps);
    writeSession(nextTicket, nextGaps);
    const q = (r.question ?? null) as ProfileGapQuestion | null;
    setQuestion(q);
    if (typeof r.total === "number") setTotal(r.total);
    if (!extra?.keepCard) {
      setCard(null);
      setPhase(q ? "question" : "done");
    }
  }, []);

  const fail = useCallback((r: ApiErr) => {
    setNotice({ message: r.message, links: r.links });
  }, []);

  /**
   * Retomar con el ticket guardado; sin ticket, o con uno vencido o inválido, se abre una charla nueva (el
   * servidor la cuenta en los 5 por día). Los huecos salen de la base: no se pierde nada de lo confirmado.
   */
  const open = useCallback(
    async (resume: boolean): Promise<boolean> => {
      const saved = resume ? readSession() : { ticket: null, gaps: null };
      if (saved.ticket && saved.gaps) {
        const r = await post({ action: "resume", ticket: saved.ticket, gaps: saved.gaps });
        if (r.ok) {
          apply(r);
          return true;
        }
        if (r.error !== "bad_ticket") {
          setPhase("done");
          fail(r);
          return false;
        }
      }
      const r = await post({ action: "start" });
      if (!r.ok) {
        setPhase("done");
        fail(r);
        return false;
      }
      apply(r);
      return true;
    },
    [apply, fail],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open(true);
  }, [open]);

  // Foco: a la pregunta o al título de la etapa
  useEffect(() => {
    if (phase === "question") answerRef.current?.focus();
    else if (phase === "card" || phase === "done") headingRef.current?.focus();
  }, [phase, question?.key]);

  async function send(answer: Record<string, unknown> | null, skipKey?: string) {
    if (!gaps || !question || busy) return;
    setBusy(true);
    setNotice(null);
    setInfo(null);
    const r = skipKey
      ? await post({ action: "skip", ticket, gaps, key: skipKey })
      : await post({ action: "answer", ticket, gaps, answer });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "bad_ticket") {
        // Charla vencida: lo confirmado sigue en el perfil; se abre una nueva con lo que falta
        try {
          window.sessionStorage.removeItem(PROFILE_AGENT_STORAGE_KEYS.ticket);
        } catch {
          // nada
        }
        setPhase("loading");
        const reopened = await open(false);
        if (reopened) setInfo("La charla venció. Abrimos una nueva con lo que todavía falta.");
        return;
      }
      fail(r);
      answerRef.current?.focus();
      return;
    }
    setDraft("");
    const dropped = typeof r.notice === "string" ? r.notice : null;
    const pendingCard = (r.card ?? null) as ProfileGapCard | null;
    if (pendingCard) {
      // La tarjeta se confirma antes de seguir; la próxima pregunta queda lista
      apply(r, { keepCard: true });
      setCard(pendingCard);
      setTarget(typeof r.target === "string" ? r.target : null);
      setPhase("card");
    } else {
      apply(r);
    }
    if (dropped) setInfo(dropped);
  }

  async function decide(accept: boolean) {
    if (!card || busy) return;
    if (!accept) {
      setCard(null);
      setPhase(question ? "question" : "done");
      return;
    }
    setBusy(true);
    setNotice(null);
    const r = await post({ action: "confirm", ticket, card });
    setBusy(false);
    if (!r.ok) {
      fail(r);
      return;
    }
    setSavedCount((n) => n + 1);
    setCard(null);
    setPhase(question ? "question" : "done");
  }

  const alert = notice ? (
    <Alert tone="danger" role="alert">
      <p>{notice.message}</p>
      {notice.links && notice.links.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {notice.links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="font-semibold underline underline-offset-2">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Alert>
  ) : null;

  if (phase === "loading") {
    return (
      <p role="status" className="text-sm text-fg-muted">
        Preparando las preguntas…
      </p>
    );
  }

  if (phase === "card" && card) {
    const d = describeCard(card);
    return (
      <section className="flex flex-col gap-4" aria-labelledby="gaps-card" data-testid="gaps-card">
        <h2
          id="gaps-card"
          ref={headingRef}
          tabIndex={-1}
          className="text-heading font-bold text-fg"
        >
          Confirmá este cambio
        </h2>
        <div className={PANEL}>
          <p className="text-sm font-semibold text-fg">
            {d.title}
            {target ? ` · ${target}` : ""}
          </p>
          <ul className="flex flex-col gap-1 text-sm text-fg">
            {d.lines.map((l, i) => (
              <li key={i} className="break-words">
                {l}
              </li>
            ))}
          </ul>
          <p className="text-sm text-fg-muted">
            Solo se guarda en tu perfil si lo confirmás. Después lo podés editar en tu historial.
          </p>
        </div>
        {alert}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void decide(true)}
            disabled={busy}
            className={PRIMARY}
          >
            Confirmar
          </button>
          <button
            type="button"
            onClick={() => void decide(false)}
            disabled={busy}
            className={SECONDARY}
          >
            Descartar
          </button>
        </div>
      </section>
    );
  }

  if (phase === "question" && question) {
    const isSkill = question.topic === "skill_level";
    return (
      <section className="flex flex-col gap-3" aria-label="Pregunta" data-testid="gaps-question">
        <p className="text-sm text-fg-muted" data-testid="gaps-progress">
          {total !== null && total > 0
            ? `Quedan ${question.remaining} de ${total} temas`
            : `Quedan ${question.remaining} temas`}
          {question.followUp > 0 ? " · repregunta" : ""}
        </p>
        <p
          role="status"
          aria-live="polite"
          className="rounded-control bg-surface-muted px-3 py-2 text-base text-fg"
          data-testid="gaps-question-text"
        >
          {question.question}
        </p>
        {info ? <p className="text-sm text-fg-muted">{info}</p> : null}
        {alert}
        {isSkill ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-3" role="group" aria-label="Nivel">
              {SELF_LEVELS.filter((l) => l.level >= 1).map((l) => (
                <button
                  key={l.level}
                  type="button"
                  disabled={busy}
                  onClick={() => void send({ kind: "level", key: question.key, level: l.level })}
                  className={SECONDARY}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void send({ kind: "none", key: question.key })}
                className={SECONDARY}
              >
                No tengo
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send(null, question.key)}
                className={SECONDARY}
              >
                Saltear
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if (text === "") {
                setNotice({ message: "Escribí una respuesta o tocá «No tengo»." });
                answerRef.current?.focus();
                return;
              }
              void send({ kind: "text", key: question.key, text });
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor="gaps-answer" className="text-sm font-medium text-fg">
              Tu respuesta
            </label>
            <textarea
              id="gaps-answer"
              ref={answerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={1000}
              disabled={busy}
              className={TEXTAREA}
            />
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={busy} className={PRIMARY}>
                {busy ? "Enviando…" : "Enviar"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send({ kind: "none", key: question.key })}
                className={SECONDARY}
              >
                No tengo
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send(null, question.key)}
                className={SECONDARY}
              >
                Saltear
              </button>
            </div>
          </form>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="gaps-done" data-testid="gaps-done">
      <h2 id="gaps-done" ref={headingRef} tabIndex={-1} className="text-heading font-bold text-fg">
        {notice ? "No pudimos seguir" : "Listo con las preguntas"}
      </h2>
      {notice ? (
        alert
      ) : (
        <p role="status" className="text-sm text-fg-muted">
          {savedCount > 0
            ? `Guardaste ${savedCount} ${savedCount === 1 ? "cambio" : "cambios"} en tu perfil.`
            : "No hubo cambios para guardar."}{" "}
          Lo que descartaste o dejaste sin responder queda como estaba.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Link href={guideHref} className={PRIMARY}>
          Seguir con la guía de búsqueda
        </Link>
        <Link
          href={base === "app" ? "/settings/historial" : profileAgentPath(base, "read")}
          className={SECONDARY}
        >
          {base === "app" ? "Revisar mi historial" : "Volver a las tarjetas"}
        </Link>
      </div>
    </section>
  );
}
