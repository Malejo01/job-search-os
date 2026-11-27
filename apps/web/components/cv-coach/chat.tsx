"use client";

import {
  CV_COACH_API,
  CV_COACH_PAGES,
  type CoachConflictQuestion,
  type CoachQuestion,
  type CvCoachCard,
  type CvCoachState,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AfiEspera } from "@/components/afi-espera";
import { joinDictated } from "@/components/dictar-engine";
import { VoiceInput } from "@/components/voice-input-lazy";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";
import {
  parseCoachSnapshot,
  readProfileTicket,
  saveCoachState,
  useCoachSnapshot,
  writeProfileTicket,
} from "@/lib/cv-coach/storage";
import { marcarFestejoPendiente } from "@/lib/festejo-pendiente";
import { isInternalPath } from "@/lib/internal-path";
import { CV_ASISTENTE_TEXTOS } from "@/lib/textos-rediseno";

const T = CV_ASISTENTE_TEXTOS.borrador;
const P = CV_ASISTENTE_TEXTOS.pregunta;
const F = CV_ASISTENTE_TEXTOS.terminar;
/** R33-02: guarda y lee las propuestas sin confirmar (`/api/cv-coach/borrador`). */
const COACH_DRAFT_API = "/api/cv-coach/borrador";

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
export function CvCoachChat({ serverTranscribe }: { serverTranscribe: boolean }) {
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
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [restored, setRestored] = useState(0);
  // R33-03: volver a la pregunta anterior, avisar tras dictar y confirmar antes de armar
  const [back, setBack] = useState<{ state: CvCoachState; lines: Line[] }[]>([]);
  const [dictated, setDictated] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const started = useRef(false);
  const nextId = useRef(0);
  const draftAsked = useRef(false);
  const lastSaved = useRef("");

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

  // R33-02: las propuestas sin confirmar de antes vuelven como tarjetas pendientes (siguen necesitando su clic)
  useEffect(() => {
    if (!stored.ready || draftAsked.current) return;
    draftAsked.current = true;
    void (async () => {
      try {
        const res = await fetch(COACH_DRAFT_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "load" }),
        });
        const data = (await res.json()) as Api;
        const old = res.ok && data.ok === true && Array.isArray(data.cards) ? data.cards : [];
        if (old.length > 0) {
          setCards((prev) => [
            ...(old as CvCoachCard[]).map((card) => ({ card, status: "pending" as const })),
            ...prev,
          ]);
          setRestored(old.length);
          lastSaved.current = JSON.stringify(old);
        }
      } catch {
        // sin borrador la charla sigue igual
      }
      setDraftLoaded(true);
    })();
  }, [stored.ready]);

  // Cada cambio en las propuestas pendientes se guarda como borrador; sin pendientes, el borrador se borra
  useEffect(() => {
    if (!draftLoaded) return;
    const pendientes = cards
      .filter((c) => c.status === "pending" || c.status === "saving")
      .map((c) => c.card);
    const json = JSON.stringify(pendientes);
    if (json === lastSaved.current || (json === "[]" && lastSaved.current === "")) return;
    lastSaved.current = json;
    void fetch(COACH_DRAFT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", cards: pendientes }),
    }).catch(() => {
      // el borrador es una ayuda: si no se guarda, la charla sigue
    });
  }, [cards, draftLoaded]);

  async function answer(body: Api, mine: string | null) {
    if (!state) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    if (mine) say("me", mine);
    const before = { state, lines };
    const data = await call({ action: "answer", state, answer: body });
    setBusy(false);
    if (!data) return;
    const s = data.state as CvCoachState;
    saveCoachState(s);
    setState(s);
    setBack((b) => [...b, before].slice(-25));
    setDictated(false);
    setConfirmFinish(false);
    if (data.finished === true) {
      marcarFestejoPendiente("cv");
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

  /** «Volver a la pregunta anterior» (C-11): se retoma el avance de antes; lo ya confirmado no se toca. */
  async function goBack() {
    const prev = back[back.length - 1];
    if (!prev || busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    const data = await call({ action: "start", state: prev.state });
    setBusy(false);
    if (!data) return;
    const s = data.state as CvCoachState;
    saveCoachState(s);
    setState(s);
    setLines(prev.lines);
    setBack((b) => b.slice(0, -1));
    setConflict(null);
    setDone(false);
    setDraft("");
    setDictated(false);
    setConfirmFinish(false);
    const q = (data.question as CoachQuestion | null) ?? null;
    setQuestion(q);
    if (q && !prev.lines.some((l) => l.who === "coach" && l.text === q.text)) say("coach", q.text);
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

  /** Lleva al cierre con lo confirmado. Si la charla seguía abierta, primero la cierra («Ya está, armalo»). */
  function finishNow() {
    if (!done && state?.stage === "chat") void answer({ kind: "finish" }, null);
    else {
      marcarFestejoPendiente("cv");
      router.push(CV_COACH_PAGES.done);
    }
  }
  const handled = (state?.resolved.length ?? 0) + (state?.skipped.length ?? 0);
  const views = stored.views?.views ?? [];
  // «Falta» de «Terminar y armar»: los temas de la revisión que todavía no se hicieron
  const pendingTitles = views
    .filter((v) => !state?.resolved.includes(v.id) && !state?.skipped.includes(v.id))
    .map((v) => v.title);
  const pending = cards.some((c) => c.status === "pending" || c.status === "saving");

  return (
    <div className="flex flex-col gap-4" data-testid="coach-chat">
      {/* C-13: la honestidad, corta y arriba */}
      <p className="text-base font-semibold text-fg" data-testid="coach-honestidad">
        {CV_ASISTENTE_TEXTOS.bienvenida.honestidad}
      </p>
      {total > 0 ? (
        <p className="text-sm text-fg-muted" data-testid="coach-progress">
          {handled} de {total} revisados
        </p>
      ) : null}
      {/* C-10: el avance como lista de temas, con el actual marcado y los hechos tildados */}
      {views.length > 0 ? (
        <ol
          className="flex flex-col gap-1 text-sm text-fg-muted"
          aria-label={CV_ASISTENTE_TEXTOS.avance.titulo}
          data-testid="coach-topics"
        >
          {views.map((v) => {
            const status = state?.resolved.includes(v.id)
              ? "done"
              : state?.skipped.includes(v.id)
                ? "skipped"
                : state?.current === v.id
                  ? "current"
                  : "pending";
            return (
              <li
                key={v.id}
                data-status={status}
                aria-current={status === "current" ? "step" : undefined}
                className={status === "current" ? "font-semibold text-fg" : ""}
              >
                <span aria-hidden="true">
                  {{ done: "✓", skipped: "↺", current: "●", pending: "○" }[status]}{" "}
                </span>
                {v.title}
                <span className="sr-only">: {CV_ASISTENTE_TEXTOS.avance.estados[status]}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
      <p className="text-sm text-fg-muted" data-testid="coach-draft-note">
        {T.aviso} {T.volverAclaracion}{" "}
        <Link href="/cv" className="font-semibold underline underline-offset-2">
          {T.volver}
        </Link>
      </p>
      {restored > 0 ? (
        <p
          role="status"
          className="text-sm font-semibold text-fg"
          data-testid="coach-draft-restored"
        >
          {T.hay}{" "}
          {restored === 1
            ? T.coachPendientesUna
            : T.coachPendientes.replace("{n}", String(restored))}
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

      <ol className="flex flex-col gap-2" aria-live="polite" data-testid="coach-lines">
        {lines.map((l) => (
          <li
            key={l.id}
            className={`aparecer-subiendo ${
              l.who === "me"
                ? "self-end rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg"
                : l.who === "ack"
                  ? "text-sm text-fg-muted"
                  : "text-sm font-semibold text-fg"
            }`}
            data-testid={`coach-line-${l.who}`}
          >
            {l.text}
          </li>
        ))}
      </ol>

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

      {busy ? (
        <p role="status" data-testid="coach-espera" className="text-sm text-fg-muted">
          <AfiEspera pose="pensando">Pensando tu respuesta…</AfiEspera>
        </p>
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
          {/* C-12: el aviso de privacidad del dictado, una sola vez y detrás del ⓘ; C-09: lo dictado no se envía solo */}
          <VoiceInput
            serverTranscribe={serverTranscribe}
            privacy="info"
            onText={(spoken) => {
              setDraft((prev) => joinDictated(prev, spoken).slice(0, 2000));
              setDictated(true);
            }}
            disabled={busy}
          />
          {dictated && draft.trim() !== "" ? (
            <p
              role="status"
              className="text-sm font-semibold text-fg"
              data-testid="coach-dictado-revisar"
            >
              {P.dictadoRevisar}
            </p>
          ) : null}
          {/* C-06: una sola acción principal por pregunta */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              type="submit"
              className={buttonClasses()}
              disabled={busy || draft.trim() === ""}
              data-testid="coach-send"
            >
              {busy ? "Pensando…" : P.responder}
            </button>
            {/* C-07: «Saltear» como enlace secundario, con su apoyo */}
            <span className="flex flex-col">
              <button
                type="button"
                className="min-h-11 self-start rounded-control px-1 text-sm font-semibold text-link underline underline-offset-2 disabled:cursor-not-allowed"
                disabled={busy || !state?.current}
                onClick={() => void answer({ kind: "none", issueId: state?.current }, P.saltear)}
                data-testid="coach-none"
              >
                {P.saltear}
              </button>
              <span className="text-sm text-fg-muted">{P.salteaApoyo}</span>
            </span>
          </div>
          {/* C-11: volver a la pregunta anterior, sin reiniciar */}
          {back.length > 0 ? (
            <button
              type="button"
              onClick={() => void goBack()}
              disabled={busy}
              className="min-h-11 self-start rounded-control px-1 text-sm font-semibold text-link underline underline-offset-2 disabled:cursor-not-allowed"
              data-testid="coach-volver-pregunta"
            >
              {P.volverAnterior}
            </button>
          ) : null}
        </form>
      ) : null}

      {done ? (
        <p className="text-sm text-fg-muted" data-testid="coach-done">
          {pending
            ? "Confirmá o descartá las tarjetas de arriba y armamos tu CV."
            : "Listo: ya podemos armar tu CV con lo que confirmaste."}
        </p>
      ) : null}
      {/* C-08: «Terminar y armar» aparte; antes de que se termine la revisión, pide confirmación */}
      <div
        className="flex flex-col gap-2 border-t border-line pt-3"
        data-testid="coach-terminar-zona"
      >
        {confirmFinish && !done ? (
          <div role="group" aria-label={F.boton} className="flex flex-col gap-2">
            <p className="text-sm text-fg" data-testid="coach-terminar-confirmar">
              {pendingTitles.length > 0
                ? F.pregunta.replace("{faltan}", pendingTitles.join(", "))
                : F.preguntaSinFaltantes}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={buttonClasses()}
                disabled={busy}
                onClick={() => setConfirmFinish(false)}
              >
                {F.seguir}
              </button>
              <button
                type="button"
                className={buttonClasses({ variant: "secondary" })}
                disabled={busy}
                onClick={finishNow}
                data-testid="coach-terminar-armar"
              >
                {F.armar}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={
              done
                ? buttonClasses()
                : "min-h-11 self-start rounded-control px-1 text-sm font-semibold text-link underline underline-offset-2 disabled:cursor-not-allowed"
            }
            disabled={busy}
            onClick={done ? finishNow : () => setConfirmFinish(true)}
            data-testid="coach-chat-finish"
          >
            {F.boton}
          </button>
        )}
      </div>
    </div>
  );
}
