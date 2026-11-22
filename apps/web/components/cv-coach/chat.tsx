"use client";

import {
  CV_COACH_API,
  CV_COACH_PAGES,
  type CoachConflictQuestion,
  type CoachQuestion,
  type CvCoachCard,
  type CvCoachState,
} from "@job-search-os/pipeline";
import { domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Dictar } from "@/components/dictar";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";
import {
  parseCoachSnapshot,
  readProfileTicket,
  saveCoachState,
  useCoachSnapshot,
  writeProfileTicket,
} from "@/lib/cv-coach/storage";
import { isInternalPath } from "@/lib/internal-path";

type Notice = { message: string; links: { label: string; href: string }[] };
type Line = { id: number; who: "coach" | "me" | "ack"; text: string };
type CardStatus = "pending" | "saving" | "saved" | "discarded" | "manual";
type CardRow = { card: CvCoachCard; status: CardStatus };
type Api = Record<string, unknown>;

const FALLBACK = "No pudimos completar el pedido. Probá de nuevo en un rato.";
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
const month = (v: string | null): string => {
  if (!v) return "sin fecha";
  const [y, mm] = v.split("-");
  return `${MONTHS[Number(mm) - 1] ?? ""} de ${y}`;
};

/** Qué dice la tarjeta, en una línea. Todo sale de la tarjeta (ya verificada por el servidor). */
function cardText(card: CvCoachCard, anchor: string | null): string {
  const where = anchor ? ` (${anchor})` : "";
  switch (card.kind) {
    case "bullets":
      return `Sumar al CV${where}: ${card.bullets.join(" · ")}`;
    case "dates":
      return `Fechas${where}: ${month(card.startMonth)} a ${card.isCurrent ? "hoy" : month(card.endMonth)}`;
    case "names":
      return `Datos${where}: ${[card.title, card.organization].filter(Boolean).join(" en ")}`;
    case "link":
      return `Link del proyecto${where}: ${card.link}`;
    case "stack":
      return `Herramientas${where}: ${card.stack.join(", ")}`;
    case "new_item":
      return `Algo nuevo para tu CV (${card.itemKind}): ${card.text}`;
    case "note":
      return `Para ubicar en tu CV: ${card.text}`;
  }
}

/**
 * Charla del coach de CV (ADR-038 §5, R12-10). El temario es la lista firmada del diagnóstico; cada respuesta
 * es un turno en `/api/cv-coach/turno` (como mucho una llamada al modelo). Lo que la persona dice vuelve como
 * tarjetas: nada entra al CV sin su clic. El avance (`jso:coach:state`) queda en la pestaña; la charla no se
 * guarda en ningún lado. «Ya está, armalo» lleva al cierre con lo confirmado.
 */
export function CvCoachChat() {
  const reduce = useReducedMotion();
  const router = useRouter();
  const stored = parseCoachSnapshot(useCoachSnapshot());
  const [state, setState] = useState<CvCoachState | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [question, setQuestion] = useState<CoachQuestion | null>(null);
  const [conflict, setConflict] = useState<CoachConflictQuestion | null>(null);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);
  const started = useRef(false);
  const nextId = useRef(0);

  const say = (who: Line["who"], text: string) =>
    setLines((prev) => [...prev, { id: nextId.current++, who, text }]);

  const anchorOf = (historyId: string | null): string | null => {
    const item = stored.before?.items.find((i) => i.historyId === historyId);
    return item ? `${item.title}, ${item.organization}` : null;
  };

  async function call(body: Api): Promise<Api | null> {
    const ticket = readProfileTicket();
    if (!ticket || !stored.issues) {
      setExpired(true);
      return null;
    }
    try {
      const res = await fetch(CV_COACH_API.turn, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, issues: stored.issues, ...body }),
      });
      const data = (await res.json()) as Api;
      if (typeof data.ticket === "string") writeProfileTicket(data.ticket);
      if (res.ok && data.ok === true) return data;
      if (data.error === "bad_ticket" || data.error === "bad_issues") {
        setExpired(true);
        return null;
      }
      if (data.error === "capped") {
        // Un tope: mensaje fijo y la charla pasa al cierre con lo que confirmó
        const s = data.state as CvCoachState | undefined;
        if (s) {
          saveCoachState(s);
          setState(s);
        }
        setQuestion(null);
        setDone(true);
      }
      if (Array.isArray(data.links)) {
        setNotice({
          message: typeof data.message === "string" ? data.message : FALLBACK,
          links: (data.links as { label: string; href: string }[]).filter((l) =>
            isInternalPath(l.href),
          ),
        });
      } else {
        setError(typeof data.message === "string" ? data.message : FALLBACK);
      }
      return null;
    } catch {
      setError(FALLBACK);
      return null;
    }
  }

  useEffect(() => {
    if (!stored.ready || started.current) return;
    started.current = true;
    void (async () => {
      const data = await call({ action: "start", state: stored.state ?? undefined });
      setBusy(false);
      if (!data) return;
      const s = data.state as CvCoachState;
      saveCoachState(s);
      setState(s);
      setTotal(Number(data.total ?? 0));
      const q = (data.question as CoachQuestion | null) ?? null;
      setQuestion(q);
      if (q) say("coach", q.text);
      else setDone(true);
    })();
    // `call` y `say` son estables a los fines de este arranque único
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored.ready]);

  async function answer(body: Api, mine: string | null) {
    if (!state) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    if (mine) say("me", mine);
    const data = await call({ action: "answer", state, answer: body });
    setBusy(false);
    if (!data) return;
    const s = data.state as CvCoachState;
    saveCoachState(s);
    setState(s);
    if (data.finished === true) {
      router.push(CV_COACH_PAGES.done);
      return;
    }
    if (typeof data.ack === "string") say("ack", data.ack);
    const fresh = (data.cards as CvCoachCard[] | undefined) ?? [];
    if (fresh.length > 0) {
      setCards((prev) => [...prev, ...fresh.map((card) => ({ card, status: "pending" as const }))]);
    }
    setConflict((data.conflict as CoachConflictQuestion | null) ?? null);
    const q = (data.question as CoachQuestion | null) ?? null;
    setQuestion(q);
    if (q) say("coach", q.text);
    if (data.closeReason) setDone(true);
  }

  async function send() {
    const text = draft.trim();
    if (!text || !state?.current) return;
    setDraft("");
    await answer({ kind: "text", issueId: state.current, text }, text);
  }

  async function confirm(index: number) {
    const row = cards[index];
    if (!row) return;
    setCards((prev) => prev.map((r, i) => (i === index ? { ...r, status: "saving" } : r)));
    const ticket = readProfileTicket();
    let status: CardStatus = "pending";
    try {
      const res = await fetch(CV_COACH_API.turn, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", ticket, issues: stored.issues, card: row.card }),
      });
      const data = (await res.json()) as Api;
      if (res.ok && data.ok === true) status = "saved";
      else if (data.error === "unsupported_card") status = "manual";
      else setError(typeof data.message === "string" ? data.message : FALLBACK);
    } catch {
      setError(FALLBACK);
    }
    setCards((prev) => prev.map((r, i) => (i === index ? { ...r, status } : r)));
  }

  if (expired || (stored.ready && !stored.issues)) {
    return (
      <Alert tone="warning" role="alert" data-testid="coach-chat-expired">
        Esta revisión venció o no empezó. Volvé al diagnóstico; lo que ya confirmaste sigue en tu
        perfil.{" "}
        <Link href={CV_COACH_PAGES.diagnosis} className="font-semibold underline">
          Volver al diagnóstico
        </Link>
      </Alert>
    );
  }

  const handled = (state?.resolved.length ?? 0) + (state?.skipped.length ?? 0);
  const pending = cards.some((c) => c.status === "pending" || c.status === "saving");

  return (
    <div className="flex flex-col gap-4" data-testid="coach-chat">
      {total > 0 ? (
        <p className="text-sm text-fg-muted" data-testid="coach-progress">
          {handled} de {total} revisados
        </p>
      ) : null}
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="warning" role="alert" data-testid="coach-chat-capped">
          {notice.message}{" "}
          {notice.links.map((l) => (
            <Link key={l.href} href={l.href} className="mr-2 font-semibold underline">
              {l.label}
            </Link>
          ))}
        </Alert>
      ) : null}

      <LazyMotion features={domAnimation}>
        <ol className="flex flex-col gap-2" aria-live="polite" data-testid="coach-lines">
          {lines.map((l) => (
            <m.li
              key={l.id}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={
                l.who === "me"
                  ? "self-end rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg"
                  : l.who === "ack"
                    ? "text-sm text-fg-muted"
                    : "text-sm font-semibold text-fg"
              }
              data-testid={`coach-line-${l.who}`}
            >
              {l.text}
            </m.li>
          ))}
        </ol>
      </LazyMotion>

      {cards.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="Para confirmar">
          {cards.map((row, i) => (
            <div
              key={`${row.card.key}-${i}`}
              className={cardClasses({ padding: "md", className: "flex flex-col gap-2" })}
              data-testid="coach-card"
            >
              <p className="text-sm text-fg">
                {cardText(row.card, "historyId" in row.card ? anchorOf(row.card.historyId) : null)}
              </p>
              {row.status === "pending" || row.status === "saving" ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={buttonClasses({ size: "sm" })}
                    disabled={row.status === "saving"}
                    onClick={() => void confirm(i)}
                  >
                    {row.status === "saving" ? "Guardando…" : "Confirmar"}
                  </button>
                  <button
                    type="button"
                    className={buttonClasses({ size: "sm", variant: "ghost" })}
                    onClick={() =>
                      setCards((prev) =>
                        prev.map((r, j) => (j === i ? { ...r, status: "discarded" } : r)),
                      )
                    }
                  >
                    Descartar
                  </button>
                </div>
              ) : (
                <p className="text-xs text-fg-muted">
                  {row.status === "saved"
                    ? "Guardado en tu perfil."
                    : row.status === "discarded"
                      ? "Descartado."
                      : "Esto lo podés sumar a mano desde "}
                  {row.status === "manual" ? (
                    <Link href="/settings/historial" className="underline">
                      Historial
                    </Link>
                  ) : null}
                </p>
              )}
            </div>
          ))}
        </section>
      ) : null}

      {conflict ? (
        <div
          className={cardClasses({ padding: "md", className: "flex flex-col gap-2" })}
          data-testid="coach-conflict"
        >
          <p className="text-sm text-fg">{conflict.text}</p>
          <div className="flex flex-wrap gap-2">
            {conflict.options.map((o, n) => (
              <button
                key={o}
                type="button"
                className={buttonClasses({ size: "sm", variant: "secondary" })}
                disabled={busy || !state?.current}
                onClick={() =>
                  void answer({ kind: "choice", issueId: state?.current, choice: n }, o)
                }
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!done && question ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor="coach-answer">
            Tu respuesta
          </label>
          <textarea
            id="coach-answer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            rows={3}
            className={inputClasses({ multiline: true })}
            disabled={busy}
            data-testid="coach-answer"
          />
          <Dictar value={draft} onChange={setDraft} disabled={busy} maxLength={2000} />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={buttonClasses()}
              disabled={busy || draft.trim() === ""}
              data-testid="coach-send"
            >
              {busy ? "Pensando…" : "Responder"}
            </button>
            <button
              type="button"
              className={buttonClasses({ variant: "secondary" })}
              disabled={busy || !state?.current}
              onClick={() => void answer({ kind: "none", issueId: state?.current }, "No tengo")}
              data-testid="coach-none"
            >
              No tengo
            </button>
          </div>
        </form>
      ) : null}

      {done ? (
        <p className="text-sm text-fg-muted" data-testid="coach-done">
          {pending
            ? "Confirmá o descartá las tarjetas de arriba y armamos tu CV."
            : "Listo: ya podemos armar tu CV con lo que confirmaste."}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonClasses({ variant: done ? "primary" : "ghost" })}
          disabled={busy}
          onClick={() => {
            if (!done && state?.stage === "chat") void answer({ kind: "finish" }, null);
            else router.push(CV_COACH_PAGES.done);
          }}
          data-testid="coach-chat-finish"
        >
          Ya está, armalo
        </button>
      </div>
    </div>
  );
}
