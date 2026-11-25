"use client";

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  ATTACHMENT_ERROR_TEXTS,
  ITEM_ATTACHMENTS_MAX,
  ITEM_MESSAGE_MAX,
} from "@job-search-os/pipeline";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { joinDictated } from "@/components/dictar-engine";
import { buttonClasses } from "@/components/ui";
import { VoiceInput } from "@/components/voice-input-lazy";
import {
  canCaptureScreen,
  captureScreenFrame,
  compressImageToWebp,
  deleteAttachment,
  uploadAttachment,
  uploadErrorText,
} from "@/lib/feedback-report-browser";
import { planFileUpload } from "@/lib/feedback-report-files";
import type { AttachmentView } from "@/lib/feedback-report";
import { INFORME_TEXTOS as T, llenarTexto } from "@/lib/textos-rediseno";

export type ClientItem = {
  id: string;
  path: string;
  category: string;
  message: string;
  attachments: AttachmentView[];
};

export type ScreenOption = { route: string; label: string };

/** Desde acá el contador de caracteres se hace visible (90 % del tope): antes sería ruido. */
const COUNTER_FROM = Math.floor(ITEM_MESSAGE_MAX * 0.9);

const kb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} kB`;

/**
 * Un ítem del informe (R29-03): pantalla, tipo, texto largo con voz y adjuntos (soltar, elegir, Ctrl+V,
 * «Capturar esta pantalla»). Client Component: todo es interactivo. El texto vive en el editor (`onChange`); los
 * adjuntos se suben al instante a `/api/feedback-files` (el ítem ya existe en la base) y se informa al editor con
 * `onAttachments`. Las imágenes se pasan a WebP en el navegador antes de subir; un documento de más de 4 MB se
 * rechaza sin subir.
 */
export function InformeItem({
  item,
  index,
  screens,
  serverTranscribe,
  onChange,
  onAttachments,
  onRemove,
}: {
  item: ClientItem;
  index: number;
  screens: readonly ScreenOption[];
  serverTranscribe: boolean;
  onChange: (patch: Partial<Pick<ClientItem, "path" | "category" | "message">>) => void;
  onAttachments: (update: (current: AttachmentView[]) => AttachmentView[]) => void;
  onRemove: () => Promise<boolean>;
}) {
  const uid = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trimmed, setTrimmed] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // `getDisplayMedia` solo existe en el navegador: en el servidor y al hidratar es `false` (así no se desfasa)
  const canCapture = useSyncExternalStore(
    () => () => {},
    canCaptureScreen,
    () => false,
  );

  // Los callbacks de la voz y de las subidas leen siempre lo último (el texto cambia mientras se graba o se sube)
  const latest = useRef({ message: item.message, count: item.attachments.length });
  useEffect(() => {
    latest.current = { message: item.message, count: item.attachments.length };
  });

  function setMessage(next: string) {
    const cut = next.length > ITEM_MESSAGE_MAX;
    setTrimmed(cut);
    onChange({ message: cut ? next.slice(0, ITEM_MESSAGE_MAX) : next });
  }

  async function addFiles(files: readonly File[]) {
    setNotice(null);
    // Lo que ya tenía el ítem al empezar: `latest` se actualiza con cada adjunto que entra, así que sumarle
    // `uploaded` contaba dos veces lo subido en esta tanda (con 10 archivos, cortaba en 6)
    const before = latest.current.count;
    let uploaded = 0;
    for (const file of files) {
      if (before + uploaded >= ITEM_ATTACHMENTS_MAX) {
        setNotice(llenarTexto(T.attachmentsFull, { max: ITEM_ATTACHMENTS_MAX }));
        break;
      }
      const plan = planFileUpload(file);
      if (plan.action === "reject") {
        setNotice(`${file.name}: ${ATTACHMENT_ERROR_TEXTS[plan.reason]}`);
        continue;
      }
      let blob: Blob = file;
      let name = file.name;
      if (plan.action === "image") {
        setBusy(llenarTexto(T.attachmentsPreparing, { name: file.name || "captura" }));
        const compressed = await compressImageToWebp(file);
        if (!compressed.ok) {
          setBusy(null);
          setNotice(
            compressed.reason === "unsupported"
              ? T.attachmentsNoWebp
              : compressed.reason === "too_big"
                ? ATTACHMENT_ERROR_TEXTS.too_large
                : ATTACHMENT_ERROR_TEXTS.corrupt,
          );
          continue;
        }
        blob = compressed.blob;
        name = `${(file.name || "captura").replace(/\.[^.]+$/, "") || "captura"}.webp`;
      }
      setBusy(llenarTexto(T.attachmentsUploading, { name }));
      const out = await uploadAttachment(item.id, blob, name);
      setBusy(null);
      if (!out.ok) {
        setNotice(`${name}: ${uploadErrorText(out.error)}`);
        continue;
      }
      uploaded++;
      const added = out.attachment;
      onAttachments((current) => [...current, added]);
    }
  }

  async function capture() {
    setNotice(null);
    const frame = await captureScreenFrame();
    if (!frame) {
      setNotice(T.attachmentsCaptureFailed);
      return;
    }
    await addFiles([new File([frame], "captura-de-pantalla.png", { type: "image/png" })]);
  }

  async function removeAttachment(a: AttachmentView) {
    setNotice(null);
    if (await deleteAttachment(a.id)) {
      onAttachments((current) => current.filter((x) => x.id !== a.id));
    } else {
      setNotice(ATTACHMENT_ERROR_TEXTS.server_error);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return; // texto: pegado normal
    event.preventDefault();
    void addFiles(files);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  }

  const length = item.message.length;
  const full = item.attachments.length >= ITEM_ATTACHMENTS_MAX;

  return (
    <section
      aria-labelledby={`${uid}-title`}
      data-testid={`informe-item-${index + 1}`}
      onPaste={onPaste}
      className="flex flex-col gap-4 rounded-card border border-line-strong bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${uid}-title`} className="text-heading font-bold">
          {llenarTexto(T.itemTitle, { n: index + 1 })}
        </h2>
        {confirmRemove ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={T.removeItem}>
            <span className="text-sm text-fg-muted">{T.removeItemConfirm}</span>
            <button
              type="button"
              data-testid="informe-quitar-si"
              onClick={() => void onRemove()}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              {T.removeItem}
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              className={buttonClasses({ variant: "ghost", size: "sm" })}
            >
              {T.sendConfirmNo}
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="informe-quitar"
            onClick={() => setConfirmRemove(true)}
            className={buttonClasses({ variant: "ghost", size: "sm" })}
          >
            {T.removeItem}
            <span className="sr-only"> {index + 1}</span>
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-screen`} className="text-sm font-medium">
            {T.screenLabel}
          </label>
          <select
            id={`${uid}-screen`}
            value={item.path}
            onChange={(e) => onChange({ path: e.target.value })}
            className="min-h-11 w-full rounded-control border border-line-control bg-surface p-2 text-base"
          >
            {screens.map((s) => (
              <option key={s.route} value={s.route}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-category`} className="text-sm font-medium">
            {T.categoryLabel}
          </label>
          <select
            id={`${uid}-category`}
            value={item.category}
            onChange={(e) => onChange({ category: e.target.value })}
            className="min-h-11 w-full rounded-control border border-line-control bg-surface p-2 text-base"
          >
            {FEEDBACK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {FEEDBACK_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-message`} className="text-sm font-medium">
          {T.messageLabel}
        </label>
        <textarea
          id={`${uid}-message`}
          data-testid="informe-mensaje"
          rows={6}
          value={item.message}
          onChange={(e) => setMessage(e.target.value)}
          aria-describedby={`${uid}-message-hint`}
          className="w-full rounded-control border border-line-control bg-surface p-2 text-base"
        />
        <p id={`${uid}-message-hint`} className="text-sm text-fg-muted">
          {llenarTexto(T.messageHint, { max: ITEM_MESSAGE_MAX.toLocaleString("es-AR") })}
        </p>
        {length >= COUNTER_FROM ? (
          <p data-testid="informe-contador" className="text-sm font-medium text-warning">
            {llenarTexto(T.messageCounter, {
              n: length.toLocaleString("es-AR"),
              max: ITEM_MESSAGE_MAX.toLocaleString("es-AR"),
            })}
          </p>
        ) : null}
        {trimmed ? (
          <p role="alert" className="text-sm text-danger">
            {llenarTexto(T.messageTrimmed, { max: ITEM_MESSAGE_MAX.toLocaleString("es-AR") })}
          </p>
        ) : null}
        <VoiceInput
          serverTranscribe={serverTranscribe}
          onText={(spoken) => setMessage(joinDictated(latest.current.message, spoken))}
          label="Dictar"
        />
      </div>

      <div
        role="group"
        aria-label={T.attachments}
        data-testid="informe-adjuntos"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col gap-3 rounded-card border-2 border-dashed p-3 ${
          dragging ? "border-focus bg-surface-muted" : "border-line-strong"
        }`}
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{T.attachments}</p>
          <p className="text-sm text-fg-muted">{T.attachmentsHint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="informe-elegir"
            disabled={full || busy !== null}
            onClick={() => fileInput.current?.click()}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            {T.attachmentsChoose}
          </button>
          {canCapture ? (
            <button
              type="button"
              data-testid="informe-capturar"
              disabled={full || busy !== null}
              onClick={() => void capture()}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              title={T.attachmentsCaptureHint}
            >
              {T.attachmentsCapture}
            </button>
          ) : null}
          {/* Sin `capture`: en el celular el sistema ofrece la galería y la cámara */}
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple
            data-testid="informe-archivo"
            accept="image/png,image/jpeg,image/webp,application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void addFiles(files);
            }}
          />
        </div>
        {full ? (
          <p className="text-sm text-fg-muted">
            {llenarTexto(T.attachmentsFull, { max: ITEM_ATTACHMENTS_MAX })}
          </p>
        ) : null}
        {busy ? (
          <p role="status" data-testid="informe-subiendo" className="text-sm text-fg-muted">
            {busy}
          </p>
        ) : null}
        {notice ? (
          <p role="alert" data-testid="informe-aviso-adjunto" className="text-sm text-danger">
            {notice}
          </p>
        ) : null}
        {item.attachments.length > 0 ? (
          <ul
            className="m-0 flex list-none flex-wrap gap-3 p-0"
            data-testid="informe-lista-adjuntos"
          >
            {item.attachments.map((a) => (
              <li
                key={a.id}
                data-testid="informe-adjunto"
                className="flex max-w-full flex-col gap-1 rounded-control border border-line-control p-2"
              >
                {a.kind === "image" ? (
                  <a
                    href={`/api/feedback-files/${a.id}`}
                    target="_blank"
                    rel="noopener"
                    aria-label={llenarTexto(T.attachmentOpen, { name: a.name })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/feedback-files/${a.id}`}
                      alt=""
                      width={a.width ?? undefined}
                      height={a.height ?? undefined}
                      loading="lazy"
                      className="h-24 w-auto max-w-full rounded-control object-contain"
                    />
                  </a>
                ) : (
                  <a
                    href={`/api/feedback-files/${a.id}`}
                    download
                    className="text-sm font-semibold text-link underline underline-offset-2"
                  >
                    {a.name}
                  </a>
                )}
                <span className="text-xs text-fg-muted">
                  {a.kind === "image" ? `${a.name} · ` : ""}
                  {kb(a.bytes)}
                </span>
                <button
                  type="button"
                  data-testid="informe-quitar-adjunto"
                  onClick={() => void removeAttachment(a)}
                  className={buttonClasses({ variant: "ghost", size: "sm" })}
                >
                  {llenarTexto(T.attachmentRemove, { name: a.name })}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
