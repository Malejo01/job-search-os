"use client";

import {
  CV_CHAT_MAX_INPUT_CHARS,
  cvCanFinish,
  cvChecklistProgress,
  cvConflictOptions,
  cvPendingTopics,
  cvProgressShown,
  cvReopenTopic,
  cvSoftDecide,
  cvSummaryDraft,
  cvTopicQuestion,
  nextCvTopic,
  type CvChatState,
  type CvDocument,
  type CvHistoryInput,
  type CvSoftDecision,
  type CvUiTopic,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CvPreview } from "@/components/cv-preview";
import { joinDictated } from "@/components/dictar-engine";
import { VoiceInput } from "@/components/voice-input-lazy";
import { Alert, buttonClasses, inputClasses } from "@/components/ui";
import { CV_ASISTENTE_TEXTOS, CV_CALIDAD_TEXTOS } from "@/lib/textos-rediseno";
import { SoftPanel, SummaryField, TopicList, softPanelReady } from "./guided-panels";
import { ReviewEditor } from "./review-editor";

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

const T = CV_ASISTENTE_TEXTOS.borrador;
const Q = CV_ASISTENTE_TEXTOS.pregunta;
const F = CV_ASISTENTE_TEXTOS.terminar;
const fill = (text: string, values: Record<string, string>): string =>
  // Sin template literal: la guarda de copia (`packages/db/src/ui-copy.test.ts`) empareja backticks y tomaba de acá
  // hasta el siguiente como si fuera un texto visible (falso positivo con `res.json()`)
  Object.entries(values).reduce((t, [k, v]) => t.replace("{" + k + "}", v), text);

/** Para «Volver a la pregunta anterior» (C-11): cómo estaba la charla antes de cada respuesta. */
type Snapshot = { state: CvChatState; messages: Msg[] };
const MAX_BACK = 25;

// C9-11: primitivas del rediseño. Una sola acción lima por paso de la charla
const PRIMARY = buttonClasses();
const SECONDARY = buttonClasses({ variant: "secondary" });
const SECONDARY_SM = buttonClasses({ variant: "secondary", size: "sm" });
const FIELD = inputClasses();
const TEXTAREA = inputClasses({ multiline: true });

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

export function CvChat({
  serverTranscribe,
  hasDraft = false,
}: {
  serverTranscribe: boolean;
  /** R33-02: hay un borrador sin confirmar guardado para esta persona. */
  hasDraft?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [ticket, setTicket] = useState("");
  const [state, setState] = useState<CvChatState | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [back, setBack] = useState<Snapshot[]>([]);
  const [dictated, setDictated] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  // El avance sale del estado: la misma cuenta que hace el servidor (siempre 7 temas)
  const progress = state ? cvChecklistProgress(state) : null;
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

  // R28-08: mientras piensa, el campo está deshabilitado y no admite foco; se vuelve a él recién cuando
  // se habilita (después del render), no en la misma función que apaga `busy`
  const refocus = useRef(false);
  useEffect(() => {
    if (!busy && refocus.current && phase === "chat") {
      refocus.current = false;
      answerRef.current?.focus();
    }
  }, [busy, phase]);

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
    setBack([]);
    setMessages([{ role: "assistant", text: String(r.question ?? "") }]);
    setPhase("chat");
  }

  /** R33-02: retoma el borrador guardado. El estado sale del servidor (base, con la sesión), no del navegador. */
  async function resume() {
    setBusy(true);
    setNotice(null);
    const r = await post({ action: "resume" });
    setBusy(false);
    if (!r.ok) {
      setNotice({ message: r.message || T.retomarError });
      return;
    }
    setTicket(String(r.ticket));
    setState(r.state as CvChatState);
    setBack([]);
    setMessages(r.question ? [{ role: "assistant", text: String(r.question) }] : []);
    if (r.closed) toReview();
    else setPhase("chat");
  }

  /**
   * Pasa a «Esto es lo que entendí». En el flujo guiado, deja el borrador del resumen armado con lo que contó (si
   * todavía no hay uno): la persona lo edita o lo vacía, y recién al armar el CV se usa.
   */
  function toReview() {
    setNotice(null);
    setConfirmFinish(false);
    setState((s) =>
      s && s.guided && s.summary.text === null
        ? { ...s, summary: { ...s.summary, text: cvSummaryDraft(s) } }
        : s,
    );
    setPhase("review");
  }

  /** «Volver a la pregunta anterior» (C-11): deshace la última respuesta sin reiniciar nada. */
  function goBack() {
    const prev = back[back.length - 1];
    if (!prev || busy) return;
    setBack((b) => b.slice(0, -1));
    setState(prev.state);
    setMessages(prev.messages);
    setDraft("");
    setDictated(false);
    setConfirmFinish(false);
    setNotice(null);
    refocus.current = true;
  }

  /** «Volver a este tema» (C-07): lo que se salteó se vuelve a preguntar; lo ya contestado no se toca. */
  function reopen(topic: CvUiTopic) {
    if (!state || busy) return;
    const next = cvReopenTopic(state, topic);
    const question = nextCvTopic(next);
    if (next === state || !question) return;
    setBack((b) => [...b, { state, messages }].slice(-MAX_BACK));
    setState(next);
    setMessages((m) => [...m, { role: "assistant", text: cvTopicQuestion(question, next) }]);
    setConfirmFinish(false);
    refocus.current = true;
  }

  /** «Usarla» / «No, gracias» (C-19): la habilidad entra solo si la persona la elige. */
  function decideSoft(skill: string, decision: CvSoftDecision) {
    setState((s) => (s ? cvSoftDecide(s, skill, decision) : s));
  }

  /** «Empezar de nuevo»: descarta el borrador (solo lo borra la persona, con este botón) y arranca limpio. */
  async function startOver() {
    setBusy(true);
    setNotice(null);
    const r = await post({ action: "discard" });
    setBusy(false);
    if (!r.ok) {
      setNotice({ message: T.descartadoError });
      return;
    }
    await start();
  }

  /** `chosen`: la opción de un chip de «¿Cuál dejo?» (R12-3), que va como respuesta del turno. */
  async function send(action: "turn" | "skip", chosen?: string) {
    if (!state || busy) return;
    const message = (chosen ?? draft).trim();
    if (action === "turn" && message === "") {
      setNotice({ message: Q.escribiYa });
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
      refocus.current = true;
      return;
    }
    const added: Msg[] = [
      { role: "user", text: action === "turn" ? message : "(salteado)" },
      ...(r.ack ? [{ role: "assistant" as const, text: String(r.ack) }] : []),
      ...(r.question ? [{ role: "assistant" as const, text: String(r.question) }] : []),
    ];
    setBack((b) => [...b, { state, messages }].slice(-MAX_BACK));
    setMessages((m) => [...m, ...added]);
    setTicket(String(r.ticket));
    setState(r.state as CvChatState);
    setDraft("");
    setDictated(false);
    setConfirmFinish(false);
    if (r.closed) toReview();
    else refocus.current = true;
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
    // C-45: los links que dijo se guardan junto con el historial (el servidor los valida de nuevo: solo https)
    const r = await post({
      action: "confirm",
      ticket,
      history: written.history,
      links: state?.links ?? {},
    });
    setBusy(false);
    if (!r.ok) return fail(r);
    setSaved(r.saved as { inserted: number; updated: number });
    setPhase("done");
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

  if (phase === "intro") {
    return (
      <section className="flex flex-col gap-3" aria-label="Cómo funciona">
        {/* C-13: la honestidad, corta y arriba */}
        <p className="text-base font-semibold text-fg" data-testid="cv-honestidad">
          {CV_ASISTENTE_TEXTOS.bienvenida.honestidad}
        </p>
        <p className="text-sm text-fg-muted">
          {CV_ASISTENTE_TEXTOS.bienvenida.comoFunciona} {T.aviso}
        </p>
        {hasDraft ? (
          <div
            role="group"
            aria-label={T.hay}
            data-testid="cv-draft-found"
            className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
          >
            <p className="text-sm font-semibold text-fg">{T.hay}</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={resume}
                disabled={busy}
                className={PRIMARY}
                data-testid="cv-draft-resume"
              >
                {T.retomar}
              </button>
              <button
                type="button"
                onClick={startOver}
                disabled={busy}
                className={SECONDARY}
                data-testid="cv-draft-discard"
              >
                {busy ? T.descartando : T.empezarDeNuevo}
              </button>
            </div>
          </div>
        ) : null}
        {alert}
        <div className="flex flex-wrap items-center gap-3">
          {hasDraft ? null : (
            <button type="button" onClick={start} disabled={busy} className={PRIMARY}>
              {CV_ASISTENTE_TEXTOS.bienvenida.empezar}
            </button>
          )}
          <Link href="/cv" className={SECONDARY}>
            {T.volver}
          </Link>
          <p className="text-sm text-fg-muted" data-testid="cv-back-note">
            {T.volverAclaracion}
          </p>
        </div>
      </section>
    );
  }

  if (phase === "chat" && state) {
    return (
      <section className="flex flex-col gap-3" aria-label="Charla">
        {progress ? (
          <p className="text-sm text-fg-muted" data-testid="cv-progress">
            Avance: {cvProgressShown(progress.done)} de {progress.total} temas
          </p>
        ) : null}
        <TopicList state={state} disabled={busy} onReopen={reopen} />
        <div
          role="log"
          aria-live="polite"
          aria-label="Mensajes"
          data-testid="cv-messages"
          className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-card bg-surface p-4"
        >
          {messages.map((m, i) => (
            <p
              key={i}
              className={
                m.role === "assistant"
                  ? "max-w-[90%] self-start break-words rounded-control bg-surface-muted px-3 py-2 text-sm text-fg"
                  : "max-w-[90%] self-end break-words rounded-control bg-ink px-3 py-2 text-sm text-on-ink"
              }
            >
              <span className="sr-only">{m.role === "assistant" ? "Asistente: " : "Vos: "}</span>
              {m.text}
            </p>
          ))}
        </div>
        {state.conflict ? (
          <div
            role="group"
            aria-label="Elegí cuál dejo"
            data-testid="cv-conflict"
            className="flex flex-wrap gap-2"
          >
            {cvConflictOptions(state.conflict).map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => void send("turn", o.label)}
                disabled={busy}
                className={SECONDARY_SM}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : null}
        {softPanelReady(state) ? (
          <SoftPanel state={state} disabled={busy} onDecide={decideSoft} />
        ) : null}
        {alert}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send("turn");
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="cv-answer" className="text-sm font-medium text-fg">
            {Q.etiqueta}
          </label>
          <textarea
            id="cv-answer"
            ref={answerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            disabled={busy}
            className={TEXTAREA}
          />
          {/* C-12: el aviso de privacidad del dictado va una sola vez, detrás del ⓘ; C-09: lo dictado no se envía solo */}
          <VoiceInput
            serverTranscribe={serverTranscribe}
            privacy="info"
            onText={(spoken) => {
              setDraft((prev) => joinDictated(prev, spoken).slice(0, CV_CHAT_MAX_INPUT_CHARS));
              setDictated(true);
            }}
            disabled={busy}
          />
          {dictated && draft.trim() !== "" ? (
            <p
              role="status"
              className="text-sm font-semibold text-fg"
              data-testid="cv-dictado-revisar"
            >
              {Q.dictadoRevisar}
            </p>
          ) : null}
          {/* C-06: una sola acción principal por pregunta */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="submit" disabled={busy} className={PRIMARY} data-testid="cv-responder">
              {Q.responder}
            </button>
            {/* C-07: «Saltear» es un enlace secundario, con su apoyo */}
            <span className="flex flex-col">
              <button
                type="button"
                onClick={() => void send("skip")}
                disabled={busy}
                className="min-h-11 self-start rounded-control px-1 text-sm font-semibold text-link underline underline-offset-2 disabled:cursor-not-allowed"
                data-testid="cv-saltear"
              >
                {Q.saltear}
              </button>
              <span className="text-sm text-fg-muted">{Q.salteaApoyo}</span>
            </span>
          </div>
          {/* C-11: volver a la pregunta anterior, sin reiniciar */}
          {back.length > 0 ? (
            <button
              type="button"
              onClick={goBack}
              disabled={busy}
              className="min-h-11 self-start rounded-control px-1 text-sm font-semibold text-link underline underline-offset-2 disabled:cursor-not-allowed"
              data-testid="cv-volver-pregunta"
            >
              {Q.volverAnterior}
            </button>
          ) : null}
        </form>
        {/* C-08: «Terminar y armar» aparte, recién con datos suficientes y con confirmación */}
        {cvCanFinish(state) ? (
          <div
            className="flex flex-col gap-2 border-t border-line pt-3"
            data-testid="cv-terminar-zona"
          >
            {confirmFinish ? (
              <div role="group" aria-label={F.boton} className="flex flex-col gap-2">
                <p className="text-sm text-fg" data-testid="cv-terminar-confirmar">
                  {cvPendingTopics(state).length > 0
                    ? fill(F.pregunta, {
                        faltan: cvPendingTopics(state)
                          .map((t) => CV_ASISTENTE_TEXTOS.avance.temas[t].toLowerCase())
                          .join(", "),
                      })
                    : F.preguntaSinFaltantes}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmFinish(false);
                      answerRef.current?.focus();
                    }}
                    disabled={busy}
                    className={PRIMARY}
                  >
                    {F.seguir}
                  </button>
                  <button
                    type="button"
                    onClick={toReview}
                    disabled={busy}
                    className={SECONDARY}
                    data-testid="cv-terminar-armar"
                  >
                    {F.armar}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmFinish(true)}
                disabled={busy}
                className="min-h-11 self-start rounded-control px-1 text-sm font-semibold text-link underline underline-offset-2 disabled:cursor-not-allowed"
                data-testid="cv-terminar"
              >
                {F.boton}
              </button>
            )}
          </div>
        ) : null}
        <p className="text-sm text-fg-muted" data-testid="cv-draft-note">
          {T.aviso} {T.volverAclaracion}{" "}
          <Link href="/cv" className="font-semibold underline underline-offset-2">
            {T.volver}
          </Link>
        </p>
      </section>
    );
  }

  if (phase === "review" && state) {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="cv-review">
        <h2
          id="cv-review"
          ref={headingRef}
          tabIndex={-1}
          className="text-heading font-bold text-fg"
        >
          {CV_CALIDAD_TEXTOS.revision.titulo}
        </h2>
        <p className="text-sm text-fg-muted">{CV_CALIDAD_TEXTOS.revision.regla}</p>
        {/* R33-04: resumen profesional editable y habilidades blandas por decidir (guiado por `asistente`) */}
        {state.guided ? (
          <>
            <SummaryField
              value={state.summary.text ?? ""}
              onChange={(text) => setState({ ...state, summary: { ...state.summary, text } })}
            />
            <SoftPanel state={state} disabled={busy} onDecide={decideSoft} />
          </>
        ) : null}
        <ReviewEditor state={state} onChange={setState} serverTranscribe={serverTranscribe} />
        {alert}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-fg">
            Idioma del CV
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value === "en" ? "en" : "es")}
              className={FIELD}
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
          className="text-heading font-bold text-fg"
        >
          Así queda tu CV
        </h2>
        <p className="text-sm text-fg-muted" data-testid="cv-verify-note">
          {usedModel
            ? "Redactado por IA y verificado contra tus respuestas: lo que traía cifras, nombres o tecnologías que no dijiste se reemplazó por tus palabras."
            : "Va con tus palabras, sin redacción de IA."}{" "}
          Al confirmar se guarda tu historial (trabajos, proyectos, estudios y certificaciones) y
          los links que contaste. El resumen, las habilidades y los idiomas de esta charla se ven
          acá pero todavía no se guardan.
        </p>
        {/* El detalle de un proyecto lleva su link: se corta en cualquier punto para no desbordar a 360 px */}
        <div className="[overflow-wrap:anywhere]">
          <CvPreview doc={doc} />
        </div>
        {alert}
        <p className="text-sm text-fg" data-testid="cv-cierre-aviso">
          {CV_CALIDAD_TEXTOS.revision.cierreAviso}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={confirm} disabled={busy} className={PRIMARY}>
            {CV_CALIDAD_TEXTOS.revision.cierre}
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
      <h2 id="cv-done" ref={headingRef} tabIndex={-1} className="text-heading font-bold text-fg">
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
