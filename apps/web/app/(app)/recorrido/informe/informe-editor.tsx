"use client";

import {
  REPORT_ITEMS_MAX,
  countReportAttachments,
  summarizeReport,
  validateReportForSend,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { buttonClasses, textLinkClasses } from "@/components/ui";
import type { AttachmentView } from "@/lib/feedback-report";
import { itemsToSave } from "@/lib/feedback-report-files";
import { INFORME_TEXTOS as T, llenarTexto } from "@/lib/textos-rediseno";
import {
  addItemAction,
  deleteItemAction,
  saveItemsAction,
  sendReportAction,
} from "./informe-actions";
import { InformeItem, type ClientItem, type ScreenOption } from "./informe-item";

/** Cada cuánto se guarda el borrador si hubo cambios. */
export const AUTOSAVE_MS = 10_000;

const sig = (i: Pick<ClientItem, "path" | "category" | "message">) =>
  `${i.path}\u0000${i.category}\u0000${i.message}`;

const hora = (d: Date) =>
  new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(d);

type Status = "idle" | "saving" | "saved" | "unsaved" | "error";

/**
 * El editor del informe (R29-03). Client Component. El borrador vive en la base: cada ítem se crea en el servidor
 * al agregarlo (así los adjuntos ya tienen a qué colgarse) y el texto se guarda solo si cambió, cada 10 segundos y
 * al salir (`visibilitychange` y `pagehide`); mientras haya cambios sin guardar, el navegador avisa antes de cerrar.
 * Un error de guardado se ve en pantalla y el texto queda en el campo. «Enviar informe» guarda, muestra el resumen
 * para confirmar y recién ahí envía; el informe enviado ya no se edita.
 *
 * `intro` (Afi explicando) y `sentAfi` (Afi festejando) llegan ya armados desde el servidor: un solo Afi por pantalla.
 */
export function InformeEditor({
  initialItems,
  screens,
  serverTranscribe,
  intro,
  sentAfi,
}: {
  initialItems: ClientItem[];
  screens: readonly ScreenOption[];
  serverTranscribe: boolean;
  intro: ReactNode;
  sentAfi: ReactNode;
}) {
  const [items, setItems] = useState<ClientItem[]>(initialItems);
  const [view, setView] = useState<"edit" | "sent">("edit");
  const [status, setStatus] = useState<Status>(initialItems.length > 0 ? "saved" : "idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionLost, setSessionLost] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sentSummary, setSentSummary] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sendButton = useRef<HTMLButtonElement>(null);

  // Lo último, para los temporizadores y los eventos de salida (que no se vuelven a crear en cada render)
  const itemsRef = useRef(items);
  const savedRef = useRef<Record<string, string>>(
    Object.fromEntries(initialItems.map((i) => [i.id, sig(i)])),
  );
  const inFlight = useRef<Promise<void> | null>(null);
  useEffect(() => {
    itemsRef.current = items;
  });

  const dirtyIn = useCallback(
    (list: readonly ClientItem[]) => itemsToSave(list, savedRef.current, sig),
    [],
  );

  /** Guarda lo que cambió. `true` si no quedó nada sin guardar. Nunca tira: el error se muestra y el texto queda. */
  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    const dirty = dirtyIn(itemsRef.current);
    if (dirty.length === 0) return true;
    setStatus("saving");
    // Un ítem por pedido y en serie: las server actions tienen un tope de 1 MB por pedido y un ítem de 50.000
    // caracteres entra, pero varios juntos no. Si uno falla, queda sin guardar y se reintenta en el próximo ciclo.
    const run = (async (): Promise<
      { ok: true; savedAt: string } | { ok: false; reason: string }
    > => {
      let savedAt = new Date().toISOString();
      for (const i of dirty) {
        let one: Awaited<ReturnType<typeof saveItemsAction>>;
        try {
          one = await saveItemsAction([
            { id: i.id, path: i.path, category: i.category, message: i.message },
          ]);
        } catch {
          one = { ok: false, reason: "error" };
        }
        if (!one.ok) return one;
        savedRef.current[i.id] = sig(i);
        savedAt = one.savedAt;
      }
      return { ok: true, savedAt };
    })();
    inFlight.current = run.then(
      () => undefined,
      () => undefined,
    );
    const result = await run;
    inFlight.current = null;
    if (result.ok) {
      setSavedAt(new Date(result.savedAt));
      setError(null);
      setSessionLost(false);
      setStatus(dirtyIn(itemsRef.current).length > 0 ? "unsaved" : "saved");
      return true;
    }
    setStatus("error");
    setSessionLost(result.reason === "session");
    setError(
      result.reason === "session"
        ? T.saveSession
        : result.reason === "locked" || result.reason === "forbidden"
          ? T.saveLocked
          : T.saveError,
    );
    return false;
  }, [dirtyIn]);

  // Guardado automático y al salir
  useEffect(() => {
    if (view !== "edit") return;
    const timer = setInterval(() => void save(), AUTOSAVE_MS);
    const onHidden = () => {
      if (document.visibilityState === "hidden") void save();
    };
    const onPageHide = () => void save();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyIn(itemsRef.current).length > 0) event.preventDefault();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [view, save, dirtyIn]);

  function patchItem(
    id: string,
    patch: Partial<Pick<ClientItem, "path" | "category" | "message">>,
  ) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    setStatus((s) => (s === "saving" ? s : "unsaved"));
  }

  function setAttachments(id: string, update: (c: AttachmentView[]) => AttachmentView[]) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, attachments: update(i.attachments) } : i)),
    );
  }

  async function add() {
    setAdding(true);
    setError(null);
    try {
      const out = await addItemAction();
      if (!out.ok) {
        setSessionLost(out.reason === "session");
        setError(
          out.reason === "too_many"
            ? llenarTexto(T.addItemFull, { max: REPORT_ITEMS_MAX })
            : out.reason === "session"
              ? T.saveSession
              : T.saveError,
        );
        return;
      }
      const created = out.item;
      savedRef.current[created.id] = sig(created);
      setItems((prev) => [...prev, { ...created, attachments: [] }]);
      const n = itemsRef.current.length + 1;
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLTextAreaElement>(`[data-testid="informe-item-${n}"] textarea`)
          ?.focus(),
      );
    } catch {
      setError(T.saveError);
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string): Promise<boolean> {
    setError(null);
    try {
      const out = await deleteItemAction(id);
      if (!out.ok) {
        setError(out.reason === "session" ? T.saveSession : T.saveError);
        return false;
      }
      delete savedRef.current[id];
      setItems((prev) => prev.filter((i) => i.id !== id));
      return true;
    } catch {
      setError(T.saveError);
      return false;
    }
  }

  const summary = summarizeReport({
    items: items.length,
    ...countReportAttachments(items.flatMap((i) => i.attachments)),
  });

  async function startSend() {
    if (sendBusy || adding) return;
    setSendError(null);
    const check = validateReportForSend(
      itemsRef.current.map((i) => ({ message: i.message, attachments: i.attachments.length })),
    );
    if (!check.ok) {
      setSendError(
        check.reason === "empty"
          ? T.sendEmpty
          : check.reason === "too_many"
            ? llenarTexto(T.addItemFull, { max: REPORT_ITEMS_MAX })
            : llenarTexto(T.sendItemEmpty, { n: check.position }),
      );
      return;
    }
    setSendBusy(true);
    const saved = await save();
    setSendBusy(false);
    if (saved) dialogRef.current?.showModal();
  }

  async function confirmSend() {
    setSendBusy(true);
    try {
      const out = await sendReportAction();
      dialogRef.current?.close();
      if (out.ok) {
        setSentSummary(out.summary);
        setView("sent");
        return;
      }
      setSendError(
        out.reason === "empty" || out.reason === "no_draft"
          ? T.sendEmpty
          : out.reason === "item_empty"
            ? llenarTexto(T.sendItemEmpty, { n: out.position ?? 1 })
            : out.reason === "session"
              ? T.saveSession
              : T.sendError,
      );
    } catch {
      dialogRef.current?.close();
      setSendError(T.sendError);
    } finally {
      setSendBusy(false);
    }
  }

  function startAnother() {
    savedRef.current = {};
    setItems([]);
    setStatus("idle");
    setError(null);
    setSendError(null);
    setView("edit");
  }

  if (view === "sent") {
    return (
      <div className="flex flex-col gap-5" data-testid="informe-enviado">
        {sentAfi}
        <div className="flex flex-col gap-2" role="status">
          <h2 className="text-heading font-bold">{T.sentTitle}</h2>
          <p className="text-base text-fg">{llenarTexto(T.sentBody, { resumen: sentSummary })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={startAnother} className={buttonClasses()}>
            {T.newReport}
          </button>
          <Link href="/recorrido" className={textLinkClasses({ block: true })}>
            Volver al recorrido
          </Link>
        </div>
      </div>
    );
  }

  const atLimit = items.length >= REPORT_ITEMS_MAX;
  const statusText =
    status === "saving"
      ? T.saving
      : status === "unsaved"
        ? T.unsaved
        : status === "error"
          ? T.unsaved
          : savedAt
            ? llenarTexto(T.savedAgo, { hora: hora(savedAt) })
            : items.length > 0
              ? T.savedNow
              : "";

  return (
    <div className="flex flex-col gap-5">
      {intro}
      <p
        role="status"
        data-testid="informe-estado"
        data-estado={status}
        className="min-h-6 text-sm text-fg-muted"
      >
        {statusText}
      </p>

      {error ? (
        <p role="alert" data-testid="informe-error" className="text-sm text-danger">
          {error}
          {sessionLost ? (
            <>
              {" "}
              <a
                href="/login"
                target="_blank"
                rel="noopener"
                className="font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Iniciar sesión (se abre en otra pestaña)
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      {items.length === 0 ? <p className="text-base text-fg-muted">{T.empty}</p> : null}

      <div className="flex flex-col gap-4">
        {items.map((item, index) => (
          <InformeItem
            key={item.id}
            item={item}
            index={index}
            screens={
              screens.some((s) => s.route === item.path)
                ? screens
                : [...screens, { route: item.path, label: item.path }]
            }
            serverTranscribe={serverTranscribe}
            onChange={(patch) => patchItem(item.id, patch)}
            onAttachments={(update) => setAttachments(item.id, update)}
            onRemove={() => remove(item.id)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="informe-agregar"
          disabled={atLimit || adding}
          onClick={() => void add()}
          className={buttonClasses({ variant: "secondary" })}
        >
          {T.addItem}
        </button>
        {/* Sin `disabled` mientras guarda: un botón que se deshabilita pierde el foco y el diálogo no lo recupera */}
        <button
          ref={sendButton}
          type="button"
          data-testid="informe-enviar"
          aria-busy={sendBusy}
          onClick={() => void startSend()}
          className={buttonClasses()}
        >
          {T.send}
        </button>
      </div>
      {atLimit ? (
        <p className="text-sm text-fg-muted">
          {llenarTexto(T.addItemFull, { max: REPORT_ITEMS_MAX })}
        </p>
      ) : null}
      {sendError ? (
        <p role="alert" data-testid="informe-error-envio" className="text-sm text-danger">
          {sendError}
        </p>
      ) : null}

      <dialog
        ref={dialogRef}
        onClose={() => sendButton.current?.focus()}
        aria-labelledby="informe-confirmar-titulo"
        data-testid="informe-confirmar"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card bg-surface p-4 text-fg backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-3">
          <h2 id="informe-confirmar-titulo" className="text-lg font-semibold">
            {T.sendConfirmTitle}
          </h2>
          <p data-testid="informe-resumen" className="text-base">
            {llenarTexto(T.sendConfirmBody, { resumen: summary })}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={sendBusy}
              className={buttonClasses({ variant: "secondary" })}
            >
              {T.sendConfirmNo}
            </button>
            <button
              type="button"
              data-testid="informe-confirmar-si"
              onClick={() => void confirmSend()}
              disabled={sendBusy}
              className={buttonClasses()}
            >
              {sendBusy ? "Enviando…" : T.sendConfirmYes}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
