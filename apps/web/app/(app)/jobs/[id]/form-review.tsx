"use client";

import { buildEmailFrameDoc } from "@job-search-os/pipeline";
import { useActionState, useState, useTransition } from "react";
import {
  analyzeFormAction,
  approveAnswerAction,
  generateDraftsAction,
  type DraftsResult,
  type DraftView,
  type FormAnalysis,
} from "@/lib/application-form";
import { CopyAllButton } from "./copy-all-button";

const IDLE: FormAnalysis = { status: "idle" };

const KIND_LABELS = { texto: "texto", opcion: "opción", numero: "número" } as const;
const ORIGIN_LABELS = {
  fija: "respuesta fija",
  salario: "sueldo calculado por el sistema",
  modelo: "borrador del modelo",
} as const;

/*
 * Los iframes con `sandbox=""` no ejecutan scripts ni envían formularios. `buildEmailFrameDoc`
 * además pone la CSP (sin red, sin form-action ni base-uri) y saca `meta` y `base` del HTML pegado.
 * El HTML pegado NUNCA se inyecta en la página: solo viaja como `srcDoc` de este iframe.
 */

type Item = DraftView & { state: "pendiente" | "aprobada" | "descartada" };

/**
 * JS-053, fase 2: pegar el formulario, ver las preguntas, generar borradores y aprobar, editar o
 * descartar cada uno. Client component porque hay estado de edición; el resto de la página es
 * de servidor. No hay "enviar": solo "Copiar todo" (ADR-004).
 */
export function FormReview({ jobId }: { jobId: string }) {
  const [analysis, analyze, analyzing] = useActionState(analyzeFormAction, IDLE);
  const [lang, setLang] = useState<"es" | "en">("es");
  const [generated, setGenerated] = useState<{ raw: string; result: DraftsResult } | null>(null);
  const [generating, startGenerating] = useTransition();

  const raw = analysis.status === "idle" ? null : analysis.raw;
  const result = generated && generated.raw === raw ? generated.result : null;

  function generate() {
    if (analysis.status !== "ok") return;
    const forRaw = analysis.raw;
    startGenerating(async () => {
      setGenerated({ raw: forRaw, result: await generateDraftsAction({ jobId, raw: forRaw }) });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <form action={analyze} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-fg-subtle">
          Pegá el formulario (texto o HTML)
          <textarea
            name="raw"
            rows={6}
            required
            defaultValue={raw ?? ""}
            placeholder="Pegá acá las preguntas del formulario de la empresa"
            className="rounded-control border border-line-strong px-2 py-2 font-mono text-sm text-fg"
          />
        </label>
        <div>
          <button
            type="submit"
            disabled={analyzing}
            className="rounded-control bg-brand px-3 py-2 text-sm font-medium text-brand-contrast disabled:opacity-50"
          >
            {analyzing ? "Analizando…" : "Analizar"}
          </button>
        </div>
      </form>

      {analysis.status === "error" ? (
        <p role="alert" className="rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
          No reconocí la estructura del formulario. Pegalo por partes: unas pocas preguntas por vez,
          cada una en su línea (terminada en «?» o con «*» si es obligatoria), o el HTML de un solo
          bloque con sus etiquetas y campos.
        </p>
      ) : null}

      {analysis.status === "ok" ? (
        <>
          {analysis.isHtml ? (
            <details className="rounded-card border border-line p-3 text-sm">
              <summary className="cursor-pointer font-semibold">
                Vista previa del HTML pegado (aislada)
              </summary>
              <iframe
                title="Vista previa del formulario pegado"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={buildEmailFrameDoc(analysis.raw)}
                className="mt-2 h-64 w-full rounded-control border border-line bg-surface"
              />
            </details>
          ) : null}

          <ol className="flex flex-col gap-1 text-sm">
            {analysis.questions.map((q) => (
              <li key={q.id} className="rounded-control border border-line px-3 py-2">
                <span className="text-fg">{q.label}</span>{" "}
                <span className="rounded-badge bg-surface-muted px-1.5 py-0.5 text-[11px] text-fg-muted">
                  {KIND_LABELS[q.kind]}
                </span>
                {q.required ? <span className="ml-1 text-xs text-danger">obligatoria</span> : null}
                {q.options?.length ? (
                  <p className="text-xs text-fg-subtle">opciones: {q.options.join(" · ")}</p>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-fg-subtle">
              Idioma de las respuestas
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value === "en" ? "en" : "es")}
                className="rounded-control border border-line-strong px-2 py-2 text-sm"
              >
                <option value="es">Español</option>
                <option value="en">Inglés</option>
              </select>
            </label>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="rounded-control border border-line-control px-3 py-2 text-sm text-fg disabled:opacity-50"
            >
              {generating ? "Generando…" : "Generar borradores"}
            </button>
          </div>
        </>
      ) : null}

      {result && !result.ok ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          {result.error}
        </p>
      ) : null}
      {result?.ok ? (
        <DraftList
          key={generated?.raw}
          jobId={jobId}
          lang={lang}
          initial={result.drafts}
          llmError={result.llmError}
        />
      ) : null}
    </div>
  );
}

function DraftList({
  jobId,
  lang,
  initial,
  llmError,
}: {
  jobId: string;
  lang: "es" | "en";
  initial: DraftView[];
  llmError: string | null;
}) {
  const [items, setItems] = useState<Item[]>(() =>
    initial.map((d) => ({ ...d, state: "pendiente" })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const patch = (id: string, change: Partial<Item>) =>
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...change } : it)));

  function approve(item: Item) {
    const approved = items
      .filter((it) => it.id === item.id || it.state === "aprobada")
      .map((it) => ({ question: it.label, answer: it.answer }));
    setError(null);
    startSaving(async () => {
      const out = await approveAnswerAction({
        jobId,
        lang,
        question: item.label,
        answer: item.answer,
        approved,
      });
      if (out.ok) patch(item.id, { state: "aprobada" });
      else setError(out.error);
    });
  }

  const approvedText = items
    .filter((it) => it.state === "aprobada")
    .map((it) => `${it.label}\n${it.answer.trim()}`)
    .join("\n\n");

  return (
    <div className="flex flex-col gap-2">
      {llmError ? (
        <p role="status" className="rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
          {llmError}. Las respuestas fijas salen igual; el resto lo redactás vos.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {items.map((it) => (
          <li
            key={it.id}
            className={`flex flex-col gap-1 rounded-control border p-3 text-sm ${
              it.state === "aprobada"
                ? "border-success-line bg-success-soft"
                : it.state === "descartada"
                  ? "border-line opacity-60"
                  : "border-line"
            }`}
          >
            <p className="font-medium text-fg">{it.label}</p>
            <p className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="rounded-badge bg-surface-muted px-1.5 py-0.5 text-fg-muted">
                {ORIGIN_LABELS[it.origin]}
              </span>
              {it.origin === "modelo" ? (
                it.sources.length ? (
                  it.sources.map((k) => (
                    <span key={k} className="rounded-badge bg-info-soft px-1.5 py-0.5 text-info">
                      fuente: {k}
                    </span>
                  ))
                ) : (
                  <span className="rounded-badge bg-danger-soft px-1.5 py-0.5 text-danger">
                    sin fuente
                  </span>
                )
              ) : null}
              {it.note ? <span className="text-fg-subtle">{it.note}</span> : null}
            </p>
            {it.state === "descartada" ? (
              <button
                type="button"
                onClick={() => patch(it.id, { state: "pendiente" })}
                className="self-start text-xs text-fg-muted underline"
              >
                Restaurar
              </button>
            ) : (
              <>
                <textarea
                  value={it.answer}
                  onChange={(e) => patch(it.id, { answer: e.target.value, state: "pendiente" })}
                  rows={3}
                  aria-label={`Respuesta: ${it.label}`}
                  placeholder="Sin borrador: escribila vos"
                  className="rounded-control border border-line-strong bg-surface px-2 py-2 text-sm text-fg"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => approve(it)}
                    disabled={saving || !it.answer.trim() || it.state === "aprobada"}
                    className="rounded-control bg-success-strong px-3 py-1.5 text-xs font-medium text-on-strong disabled:opacity-50"
                  >
                    {it.state === "aprobada" ? "Aprobada" : "Aprobar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => patch(it.id, { state: "descartada" })}
                    className="rounded-control border border-line-strong px-3 py-1.5 text-xs text-fg-muted"
                  >
                    Descartar
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <CopyAllButton text={approvedText} disabled={!approvedText} />
        <p className="text-xs text-fg-subtle">
          Copia solo las aprobadas. La app no envía nada: pegalas vos en el formulario de la
          empresa.
        </p>
      </div>
    </div>
  );
}
