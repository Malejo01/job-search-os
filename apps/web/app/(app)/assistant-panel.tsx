"use client";

import {
  actionOutcomesFrom,
  AGENT_LIMITS,
  capMessage,
  historyFrom,
  proposalOutcomesFrom,
  remainingMessages,
  remainingMessagesNotice,
  screenFromPath,
  screenLabel,
  type ActionProposal,
  type AgentLink,
  type AssistantStreamEvent,
  type Proposal,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  clearProposal,
  hasPendingProposal,
  PROPOSAL_EVENT,
  PROPOSAL_FORM_PATH,
  PROPOSAL_MAX_AGE_MS,
  stashProposal,
} from "@/components/assistant-proposal";
import { AssistantActionCard, type ActionStatus } from "./assistant-action-card";
import { AssistantProposalCard, type ProposalStatus } from "./assistant-proposal-card";
import { buttonClasses } from "@/components/ui";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Lo que entra en la request: el servidor corta a 2.000, pero un CV pegado tiene que llegar para detectarlo. */
const MAX_INPUT_CHARS = 20_000;
/** Si la pantalla de destino no tomó la propuesta en este tiempo, no tiene ese formulario. */
const LOAD_CHECK_MS = 8_000;

type Item =
  | { id: number; turn: number; kind: "user"; text: string }
  | { id: number; turn: number; kind: "assistant"; text: string }
  | {
      id: number;
      turn: number;
      kind: "notice";
      text: string;
      links: AgentLink[];
      /** Tope que cierra la charla: no se acepta otro mensaje ni se repite el aviso. */
      final: boolean;
    }
  | { id: number; turn: number; kind: "error"; text: string }
  | {
      id: number;
      turn: number;
      kind: "proposal";
      proposal: Proposal;
      status: ProposalStatus;
      /** Cuándo llegó al navegador: la propuesta vence a los 10 minutos de esto. */
      receivedAt: number;
    }
  | {
      id: number;
      turn: number;
      kind: "action";
      action: ActionProposal;
      status: ActionStatus;
      /** Cuándo llegó: la tarjeta vence a los 10 minutos de esto. */
      receivedAt: number;
    };

const ERROR_BY_STATUS: Record<number, string> = {
  413: "Ese mensaje es muy largo para el asistente.",
};
const GENERIC_ERROR =
  "El asistente no pudo responder. Probá de nuevo en un rato o hacé el cambio directamente en la pantalla.";
const FORM_NOT_FOUND =
  "No encontramos el formulario en esa pantalla, así que no se cargó nada. Hacé el cambio a mano ahí.";

/**
 * Panel del asistente (AG-3). `<dialog>` nativo con `showModal()`: atrapa el foco, Escape cierra
 * y el foco vuelve a la mascota que lo abrió. A ≥ 1024 px es un panel lateral de 380 px; en el celular,
 * una hoja completa. Los mensajes completos se anuncian en una región `aria-live` aparte (los
 * fragmentos que llegan mientras escribe no se leen uno por uno; «Pensando…» tampoco se anuncia:
 * el botón Enviar deshabilitado y el «Detener» ya lo dicen). El contenido se pinta solo con el
 * panel abierto. C9-11 (decisión 13 de C9): sin animación de entrada, el panel aparece quieto.
 */
export function AssistantPanel({
  open,
  onClose,
  maxTurns = AGENT_LIMITS.maxTurnsPerConversation,
}: {
  open: boolean;
  onClose: () => void;
  /** Tope de mensajes de la charla (lo configurado en el servidor); sin esto, el de siempre. */
  maxTurns?: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Cambia con «Nueva charla»: lo que llegue de una charla anterior se ignora. */
  const generation = useRef(0);
  const seq = useRef(0);
  const statusRefs = useRef(new Map<number, HTMLElement>());
  // Tarjeta cuyo texto de estado tiene que recibir el foco apenas se monte: al confirmar, el cambio
  // de estado llega dentro de la transición de la Server Action y puede montarse después del frame
  const pendingFocus = useRef<number | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const titleId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [announce, setAnnounce] = useState("");

  const screen = screenFromPath(pathname);

  /** El mismo texto dos veces también se lee: se vacía y se vuelve a llenar en el próximo frame. */
  function say(text: string) {
    setAnnounce("");
    requestAnimationFrame(() => setAnnounce(text));
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items]);

  // Cerrar el panel corta la respuesta en curso (el servidor deja la fila de llm_calls igual)
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  const nextId = () => ++seq.current;

  function newConversation() {
    generation.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    setItems([]);
    setConversationId(null);
    say("Empezaste una charla nueva.");
    inputRef.current?.focus();
  }

  function setStatus(id: number, status: ProposalStatus) {
    setItems((prev) =>
      prev.map((i) => (i.id === id && i.kind === "proposal" ? { ...i, status } : i)),
    );
  }

  function trackStatus(id: number, el: HTMLElement | null) {
    if (!el) {
      statusRefs.current.delete(id);
      return;
    }
    statusRefs.current.set(id, el);
    if (pendingFocus.current === id) {
      pendingFocus.current = null;
      el.focus();
    }
  }

  /** Enfoca el texto de estado de una tarjeta ahora si ya está montado, o cuando se monte. */
  function focusStatus(id: number) {
    pendingFocus.current = id;
    requestAnimationFrame(() => {
      const el = statusRefs.current.get(id);
      if (pendingFocus.current === id && el?.isConnected) {
        pendingFocus.current = null;
        el.focus();
      }
    });
  }

  function setActionStatus(id: number, status: ActionStatus) {
    setItems((prev) =>
      prev.map((i) => (i.id === id && i.kind === "action" ? { ...i, status } : i)),
    );
  }

  function discardAction(id: number) {
    setActionStatus(id, "descartada");
    say("Descartada. No se cambió nada.");
    focusStatus(id);
  }

  function sentAction(id: number, action: ActionProposal, toLabel?: string) {
    setActionStatus(id, "enviada");
    say(
      action.kind === "status_change"
        ? `Listo: la oferta quedó en ${toLabel ?? action.toLabel}.`
        : "Listo: la oferta quedó cargada.",
    );
    // El botón desaparece: el foco va al texto de estado de la tarjeta, como al descartar
    focusStatus(id);
  }

  function discardProposal(id: number) {
    setStatus(id, "descartada");
    say("Propuesta descartada. No se cambió nada.");
    focusStatus(id);
  }

  function pushError(text: string) {
    setItems((prev) => [...prev, { id: nextId(), turn: -1, kind: "error", text }]);
    say(text);
  }

  function loadProposal(item: Extract<Item, { kind: "proposal" }>) {
    if (Date.now() - item.receivedAt > PROPOSAL_MAX_AGE_MS) {
      pushError("Esta propuesta venció. Pedile al asistente una nueva.");
      return;
    }
    if (!stashProposal(item.proposal, item.receivedAt)) {
      pushError("No se pudo cargar: tu navegador no deja guardar datos de esta pestaña.");
      return;
    }
    setStatus(item.id, "cargada");
    const target = PROPOSAL_FORM_PATH[item.proposal.destination];
    const [path] = target.split("#");
    onClose();
    if (pathname === path) {
      // Ya está en la pantalla: el formulario la toma por evento, sin navegar
      window.dispatchEvent(new Event(PROPOSAL_EVENT));
    } else {
      router.push(target);
    }
    // Si nadie la tomó, esa pantalla no tiene el formulario (p. ej. sin perfil o sin criterios)
    window.setTimeout(() => {
      if (!hasPendingProposal()) return;
      clearProposal();
      setStatus(item.id, "pendiente");
      pushError(FORM_NOT_FOUND);
    }, LOAD_CHECK_MS);
  }

  async function send(text: string) {
    const gen = generation.current;
    const turn = nextId();
    const history = [...historyFrom(items), { role: "user" as const, text }];
    setItems((prev) => [...prev, { id: nextId(), turn, kind: "user", text }]);
    setDraft("");
    setPending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const current = () => gen === generation.current;

    let reply = "";
    let gotDone = false;
    const said: string[] = [];
    let noticeFinal = false;
    const push = (item: Item) => {
      if (current()) setItems((prev) => [...prev, item]);
    };
    const appendText = (delta: string) => {
      reply += delta;
      if (!current()) return;
      setItems((prev) => {
        const last = prev.at(-1);
        if (last?.kind === "assistant" && last.turn === turn) {
          return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
        }
        return [...prev, { id: nextId(), turn, kind: "assistant", text: delta }];
      });
    };
    const handle = (event: AssistantStreamEvent) => {
      switch (event.type) {
        case "conv":
          if (current()) setConversationId(event.id);
          break;
        case "text":
          appendText(event.text);
          break;
        case "proposal":
          push({
            id: nextId(),
            turn,
            kind: "proposal",
            proposal: event.proposal,
            status: "pendiente",
            receivedAt: Date.now(),
          });
          said.push(
            `${event.proposal.title}: ${event.proposal.diffs.length} cambios para revisar.`,
          );
          break;
        case "action":
          push({
            id: nextId(),
            turn,
            kind: "action",
            action: event.action,
            status: "pendiente",
            receivedAt: Date.now(),
          });
          said.push(
            event.action.kind === "status_change"
              ? `Cambio de estado propuesto para revisar: ${event.action.toLabel}.`
              : "Oferta para cargar, para revisar.",
          );
          break;
        case "notice":
          // Un tope de la charla se muestra una sola vez, aunque lleguen dos
          if (event.final && (noticeFinal || items.some((i) => i.kind === "notice" && i.final))) {
            break;
          }
          if (event.final) noticeFinal = true;
          push({
            id: nextId(),
            turn,
            kind: "notice",
            text: event.text,
            links: event.links,
            final: event.final === true,
          });
          said.push(event.text);
          break;
        case "error":
          push({ id: nextId(), turn, kind: "error", text: event.message });
          said.push(event.message);
          break;
        case "done":
          gotDone = true;
          break;
      }
    };
    const handleLine = (raw: string) => {
      const line = raw.trim();
      if (!line) return;
      try {
        handle(JSON.parse(line) as AssistantStreamEvent);
      } catch {
        // línea rota: se ignora
      }
    };

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          messages: history,
          screen,
          outcomes: proposalOutcomesFrom(items),
          actions: actionOutcomesFrom(items),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const message = ERROR_BY_STATUS[res.status] ?? GENERIC_ERROR;
        push({ id: nextId(), turn, kind: "error", text: message });
        said.push(message);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          handleLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
        }
      }
      // Lo que quedó sin salto de línea al cerrar
      buffer += decoder.decode();
      handleLine(buffer);
      if (!gotDone && !controller.signal.aborted) {
        push({ id: nextId(), turn, kind: "error", text: GENERIC_ERROR });
        said.push(GENERIC_ERROR);
      }
    } catch {
      if (!controller.signal.aborted) {
        push({ id: nextId(), turn, kind: "error", text: GENERIC_ERROR });
        said.push(GENERIC_ERROR);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      // Una charla nueva ya limpió todo: lo de esta no se anuncia ni pisa el estado
      if (current()) {
        setPending(false);
        // Se anuncia el mensaje completo, una vez, al terminar
        say([reply.trim(), ...said].filter(Boolean).join(" "));
      }
    }
  }

  // Tope de la charla: por el aviso del servidor o por los mensajes ya enviados (mismo límite)
  const userCount = items.filter((i) => i.kind === "user").length;
  const hasFinalNotice = items.some((i) => i.kind === "notice" && i.final);
  const outOfMessages = !pending && userCount > 0 && remainingMessages(userCount, maxTurns) === 0;
  const capped = hasFinalNotice || outOfMessages;
  const remainingNotice = pending || capped ? null : remainingMessagesNotice(userCount, maxTurns);
  const turnsCap = capMessage("turns");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending || capped) return;
    void send(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit(e);
    }
  }

  function renderNotice(key: number | string, text: string, links: AgentLink[]) {
    return (
      <div
        key={key}
        data-testid="assistant-notice"
        className="flex flex-col gap-1 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning"
      >
        <p className="break-words">{text}</p>
        <ul className="flex flex-wrap gap-x-3">
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                onClick={onClose}
                className={`inline-flex min-h-11 items-center underline ${FOCUS_RING}`}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      data-testid="assistant-panel"
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-none overflow-hidden bg-surface p-0 text-fg backdrop:bg-black/30 lg:w-[380px]"
    >
      {open ? (
        <div className="flex h-full min-w-0 flex-col">
          <div className="flex flex-col gap-1 border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id={titleId} className="text-base font-bold">
                Asistente
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={newConversation}
                  className={buttonClasses({ variant: "ghost", size: "sm" })}
                >
                  Nueva charla
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  Cerrar
                </button>
              </div>
            </div>
            <p className="text-xs text-fg-subtle">
              {screen ? `Estás en: ${screenLabel(screen.screen)}. ` : ""}Lee tus datos, te explica y
              te propone cambios. No guarda nada sin que vos lo confirmes en la pantalla.
            </p>
          </div>

          <div
            ref={listRef}
            data-testid="assistant-messages"
            className="flex min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto px-4 py-3"
          >
            {items.length === 0 ? (
              <>
                {/* Aviso de la primera charla (R4-15): va acá y no en los textos legales */}
                <div
                  data-testid="assistant-aviso"
                  className="rounded-control bg-surface-muted px-3 py-2 text-sm text-fg-muted"
                >
                  <p className="font-bold text-fg">Antes de empezar</p>
                  <p>
                    Es una inteligencia artificial: lee tus datos de la app, te explica lo que ves y
                    te propone cambios que vos confirmás. Puede equivocarse. No escribas datos
                    sensibles (contraseñas, documentos, datos de salud) ni datos de otras personas.
                  </p>
                </div>
                <p className="text-sm text-fg-subtle">
                  Preguntale, por ejemplo, «¿qué me falta para las ofertas que me interesan?» o
                  contale un cambio: «me mudé a Uruguay».
                </p>
              </>
            ) : null}
            {items.map((item) => {
              switch (item.kind) {
                case "user":
                  return (
                    <p
                      key={item.id}
                      // C9-11: índigo; la lima no va de fondo de un bloque
                      className="self-end rounded-control bg-ink px-3 py-2 text-sm break-words whitespace-pre-wrap text-on-ink"
                    >
                      <span className="sr-only">Vos: </span>
                      {item.text.length > 600 ? `${item.text.slice(0, 600)}…` : item.text}
                    </p>
                  );
                case "assistant":
                  return (
                    <p
                      key={item.id}
                      className="self-start rounded-control bg-surface-muted px-3 py-2 text-sm break-words whitespace-pre-wrap"
                    >
                      <span className="sr-only">Asistente: </span>
                      {item.text}
                    </p>
                  );
                case "notice":
                  return renderNotice(item.id, item.text, item.links);
                case "error":
                  return (
                    <p
                      key={item.id}
                      className="rounded-control bg-danger-soft px-3 py-2 text-sm break-words text-danger"
                    >
                      {item.text}
                    </p>
                  );
                case "proposal":
                  return (
                    <AssistantProposalCard
                      key={item.id}
                      proposal={item.proposal}
                      status={item.status}
                      statusRef={(el) => trackStatus(item.id, el)}
                      onLoad={() => loadProposal(item)}
                      onDiscard={() => discardProposal(item.id)}
                    />
                  );
                case "action":
                  return (
                    <AssistantActionCard
                      key={item.id}
                      action={item.action}
                      status={item.status}
                      statusRef={(el) => trackStatus(item.id, el)}
                      receivedAt={item.receivedAt}
                      onSent={(r) => sentAction(item.id, item.action, r.toLabel)}
                      onDiscard={() => discardAction(item.id)}
                    />
                  );
              }
            })}
            {outOfMessages && !hasFinalNotice
              ? renderNotice("tope-turnos", turnsCap.text, turnsCap.links)
              : null}
            {pending ? (
              <p className="text-sm text-fg-subtle" aria-hidden="true">
                Pensando…
              </p>
            ) : null}
          </div>

          <p aria-live="polite" role="status" className="sr-only">
            {announce}
          </p>

          <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-line px-4 py-3">
            <label htmlFor={`${titleId}-mensaje`} className="text-sm font-medium">
              Tu mensaje
            </label>
            <textarea
              id={`${titleId}-mensaje`}
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              maxLength={MAX_INPUT_CHARS}
              rows={3}
              className={`w-full min-w-0 resize-none rounded-control border-2 border-line-control bg-surface px-4 py-2 text-base text-fg ${FOCUS_RING}`}
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={pending || capped || draft.trim() === ""}
                className={buttonClasses({ size: "sm" })}
              >
                Enviar
              </button>
              {pending ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  Detener
                </button>
              ) : null}
            </div>
            {remainingNotice ? (
              <p data-testid="assistant-remaining" className="text-xs font-medium text-warning">
                {remainingNotice}
              </p>
            ) : null}
            <p className="text-xs text-fg-subtle">
              No pegues tu CV acá: se carga en «Tu perfil» y «Tus skills».
            </p>
          </form>
        </div>
      ) : null}
    </dialog>
  );
}
