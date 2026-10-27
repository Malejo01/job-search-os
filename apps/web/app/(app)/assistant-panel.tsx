"use client";

import {
  screenFromPath,
  screenLabel,
  type AgentLink,
  type AssistantStreamEvent,
  type Proposal,
  type ProposalOutcome,
} from "@job-search-os/pipeline";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { PROPOSAL_EVENT, PROPOSAL_FORM_PATH, stashProposal } from "@/components/assistant-proposal";
import { AssistantProposalCard, type ProposalStatus } from "./assistant-proposal-card";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";

/** Lo que entra en la request: el servidor corta a 2.000, pero un CV pegado tiene que llegar para detectarlo. */
const MAX_INPUT_CHARS = 20_000;

type Item =
  | { id: number; turn: number; kind: "user"; text: string }
  | { id: number; turn: number; kind: "assistant"; text: string }
  | { id: number; turn: number; kind: "notice"; text: string; links: AgentLink[] }
  | { id: number; turn: number; kind: "error"; text: string }
  | { id: number; turn: number; kind: "proposal"; proposal: Proposal; status: ProposalStatus };

type HistoryMessage = { role: "user" | "assistant"; text: string };

const DESTINATION_NAME: Record<Proposal["destination"], string> = {
  profile: "Tu perfil",
  skill_levels: "Tus skills",
  criteria: "Criterios",
  target_roles: "Tus puestos",
};

/**
 * Historial para el servidor, armado solo en memoria (la charla no se guarda en ningún lado). Un
 * turno sin respuesta del asistente ni propuesta (CV derivado, tope, error) no entra: así un CV
 * pegado no vuelve a viajar en el turno siguiente y los roles siguen alternando.
 */
export function historyFrom(items: readonly Item[]): HistoryMessage[] {
  const turns = new Map<number, Item[]>();
  for (const item of items) turns.set(item.turn, [...(turns.get(item.turn) ?? []), item]);
  const out: HistoryMessage[] = [];
  for (const group of turns.values()) {
    const user = group.find((i) => i.kind === "user");
    if (!user || user.kind !== "user") continue;
    const text = group
      .filter((i) => i.kind === "assistant")
      .map((i) => (i.kind === "assistant" ? i.text : ""))
      .join("")
      .trim();
    const proposals = group.filter((i) => i.kind === "proposal");
    const reply =
      text ||
      (proposals.length > 0
        ? `[Propuse cambios para ${proposals
            .map((p) => (p.kind === "proposal" ? DESTINATION_NAME[p.proposal.destination] : ""))
            .join(", ")}]`
        : "");
    if (!reply) continue;
    out.push({ role: "user", text: user.text }, { role: "assistant", text: reply.slice(0, 4000) });
  }
  return out;
}

function outcomesFrom(items: readonly Item[]): ProposalOutcome[] {
  return items
    .filter((i): i is Extract<Item, { kind: "proposal" }> => i.kind === "proposal")
    .slice(-20)
    .map((i) => ({
      destination: i.proposal.destination,
      fields: i.proposal.diffs.map((d) => d.field).slice(0, 20),
      status: i.status,
    }));
}

const ERROR_BY_STATUS: Record<number, string> = {
  429: "Ya hay una respuesta en curso. Esperá a que termine.",
  413: "Ese mensaje es muy largo para el asistente.",
};
const GENERIC_ERROR =
  "El asistente no pudo responder. Probá de nuevo en un rato o hacé el cambio directamente en la pantalla.";

/**
 * Panel del asistente (AG-3). `<dialog>` nativo con `showModal()`: atrapa el foco, Escape cierra
 * y el foco vuelve al botón «Asistente». A ≥ 1024 px es un panel lateral de 380 px; en el celular,
 * una hoja completa. Los mensajes completos se anuncian en una región `aria-live` aparte (los
 * fragmentos que llegan mientras escribe no se leen uno por uno).
 */
export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const reduceMotion = useReducedMotion();
  const pathname = usePathname();
  const router = useRouter();
  const titleId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [announce, setAnnounce] = useState("");

  const screen = screenFromPath(pathname);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
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
    abortRef.current?.abort();
    setItems([]);
    setConversationId(null);
    setAnnounce("Empezaste una charla nueva.");
    inputRef.current?.focus();
  }

  function setStatus(id: number, status: ProposalStatus) {
    setItems((prev) =>
      prev.map((i) => (i.id === id && i.kind === "proposal" ? { ...i, status } : i)),
    );
  }

  function loadProposal(id: number, proposal: Proposal) {
    if (!stashProposal(proposal)) {
      setAnnounce("No se pudo cargar: tu navegador no deja guardar datos de esta pestaña.");
      return;
    }
    setStatus(id, "cargada");
    const target = PROPOSAL_FORM_PATH[proposal.destination];
    const [path] = target.split("#");
    onClose();
    if (pathname === path) {
      // Ya está en la pantalla: el formulario la toma por evento, sin navegar
      window.dispatchEvent(new Event(PROPOSAL_EVENT));
    } else {
      router.push(target);
    }
  }

  async function send(text: string) {
    const turn = nextId();
    const history = [...historyFrom(items), { role: "user" as const, text }];
    setItems((prev) => [...prev, { id: nextId(), turn, kind: "user", text }]);
    setDraft("");
    setPending(true);
    const controller = new AbortController();
    abortRef.current = controller;

    let reply = "";
    const said: string[] = [];
    const push = (item: Item) => setItems((prev) => [...prev, item]);
    const appendText = (delta: string) => {
      reply += delta;
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
          setConversationId(event.id);
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
          });
          said.push(
            `${event.proposal.title}: ${event.proposal.diffs.length} cambios para revisar.`,
          );
          break;
        case "notice":
          push({ id: nextId(), turn, kind: "notice", text: event.text, links: event.links });
          said.push(event.text);
          break;
        case "error":
          push({ id: nextId(), turn, kind: "error", text: event.message });
          said.push(event.message);
          break;
        case "done":
          break;
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
          outcomes: outcomesFrom(items),
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
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) {
            try {
              handle(JSON.parse(line) as AssistantStreamEvent);
            } catch {
              // línea rota: se ignora
            }
          }
          nl = buffer.indexOf("\n");
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        push({ id: nextId(), turn, kind: "error", text: GENERIC_ERROR });
        said.push(GENERIC_ERROR);
      }
    } finally {
      setPending(false);
      abortRef.current = null;
      // Se anuncia el mensaje completo, una vez, al terminar
      setAnnounce([reply.trim(), ...said].filter(Boolean).join(" "));
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    void send(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit(e);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      data-testid="assistant-panel"
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-none overflow-hidden bg-white p-0 text-zinc-900 backdrop:bg-black/30 lg:w-[380px]"
    >
      <motion.div
        key={open ? "abierto" : "cerrado"}
        initial={reduceMotion ? false : { opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
        className="flex h-full min-w-0 flex-col"
      >
        <div className="flex flex-col gap-1 border-b border-zinc-200 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id={titleId} className="text-base font-semibold">
              Asistente
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={newConversation}
                className={`min-h-11 rounded-md px-2 text-sm text-zinc-700 underline-offset-2 hover:underline ${FOCUS_RING}`}
              >
                Nueva charla
              </button>
              <button
                type="button"
                onClick={onClose}
                className={`min-h-11 rounded-md border border-zinc-300 px-3 text-sm ${FOCUS_RING}`}
              >
                Cerrar
              </button>
            </div>
          </div>
          <p className="text-xs text-zinc-600">
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
            <p className="text-sm text-zinc-600">
              Preguntale, por ejemplo, «¿qué me falta para las ofertas que me interesan?» o contale
              un cambio: «me mudé a Uruguay».
            </p>
          ) : null}
          {items.map((item) => {
            switch (item.kind) {
              case "user":
                return (
                  <p
                    key={item.id}
                    className="self-end rounded-md bg-zinc-900 px-3 py-2 text-sm break-words whitespace-pre-wrap text-white"
                  >
                    <span className="sr-only">Vos: </span>
                    {item.text.length > 600 ? `${item.text.slice(0, 600)}…` : item.text}
                  </p>
                );
              case "assistant":
                return (
                  <p
                    key={item.id}
                    className="self-start rounded-md bg-zinc-100 px-3 py-2 text-sm break-words whitespace-pre-wrap"
                  >
                    <span className="sr-only">Asistente: </span>
                    {item.text}
                  </p>
                );
              case "notice":
                return (
                  <div
                    key={item.id}
                    data-testid="assistant-notice"
                    className="flex flex-col gap-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950"
                  >
                    <p className="break-words">{item.text}</p>
                    <ul className="flex flex-wrap gap-x-3 gap-y-1">
                      {item.links.map((l) => (
                        <li key={l.href}>
                          <Link
                            href={l.href}
                            onClick={onClose}
                            className={`underline ${FOCUS_RING}`}
                          >
                            {l.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              case "error":
                return (
                  <p
                    key={item.id}
                    className="rounded-md bg-red-50 px-3 py-2 text-sm break-words text-red-800"
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
                    onLoad={() => loadProposal(item.id, item.proposal)}
                    onDiscard={() => setStatus(item.id, "descartada")}
                  />
                );
            }
          })}
          {pending ? (
            <p className="text-sm text-zinc-600" aria-hidden="true">
              Pensando…
            </p>
          ) : null}
        </div>

        <p aria-live="polite" role="status" className="sr-only">
          {announce}
        </p>

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-2 border-t border-zinc-200 px-4 py-3"
        >
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
            className={`w-full min-w-0 resize-none rounded-md border border-zinc-400 px-3 py-2 text-base ${FOCUS_RING}`}
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending || draft.trim() === ""}
              className={`min-h-11 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${FOCUS_RING}`}
            >
              Enviar
            </button>
            {pending ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className={`min-h-11 rounded-md border border-zinc-400 px-3 py-2 text-sm ${FOCUS_RING}`}
              >
                Detener
              </button>
            ) : null}
          </div>
          <p className="text-xs text-zinc-600">
            No pegues tu CV acá: se carga en «Tu perfil» y «Tus skills».
          </p>
        </form>
      </motion.div>
    </dialog>
  );
}
