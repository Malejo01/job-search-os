"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CvTailorOutput, TailorDecision, TailorSuggestion } from "@job-search-os/pipeline";
import { Alert, Button } from "@/components/ui";
import { saveTailorVersionAction, type SaveVersionResult } from "@/lib/cv-tailor/actions";
import { POSTULACION_TEXTOS as T } from "@/lib/textos-rediseno";
import { TAILOR_PREVIEW_TITLE } from "./copy";

/**
 * Sugerencias de «Adaptar a esta oferta» (R34-02): una tarjeta por cambio para aceptar, editar o descartar de a
 * una, vista previa de lo decidido y guardado como otra versión. Client Component porque guarda decisiones en
 * memoria y llama a la acción; no guarda nada en el navegador y todo se muestra como texto, nunca como HTML.
 * Lo que no se decidió no se aplica. El servidor recompone la propuesta con estas decisiones y la verifica de
 * nuevo contra el CV de hoy: una edición que sume algo no declarado se rechaza ahí.
 */
type Decision = { action: "accept" | "discard" } | { action: "edit"; bullets: string[] };

const MAX_BULLETS = 6;

function resulting(s: TailorSuggestion, d: Decision | undefined): string[] | null {
  if (!d || d.action === "discard") return null;
  return d.action === "edit" ? d.bullets : s.after;
}

const SAVE_ERRORS: Record<string, string> = {
  off: T.adaptar.apagado,
  stale: T.adaptar.rechazadaGeneral,
  no_job: T.adaptar.errorGeneral,
  no_cv: T.adaptar.errorGeneral,
  server: T.adaptar.errorGeneral,
  bad_request: T.adaptar.errorGeneral,
  unauthorized: T.adaptar.errorGeneral,
};

export function TailorSuggestions({
  jobId,
  proposal,
  suggestions,
}: {
  jobId: string;
  proposal: CvTailorOutput;
  suggestions: TailorSuggestion[];
}) {
  const uid = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<false | "new" | "replaced">(false);
  const [failure, setFailure] = useState<{ error: string; ref?: string } | null>(null);

  const decide = (id: string, d: Decision | null) => {
    setSaved(false);
    setFailure(null);
    setDecisions((prev) => {
      const next = { ...prev };
      if (d) next[id] = d;
      else delete next[id];
      return next;
    });
  };

  const applied = suggestions.filter((s) => resulting(s, decisions[s.id]) !== null);

  function save() {
    if (pending || applied.length === 0) return;
    const list: TailorDecision[] = suggestions.flatMap((s) => {
      const d = decisions[s.id];
      return d ? [{ id: s.id, ...d } as TailorDecision] : [];
    });
    startTransition(async () => {
      const r: SaveVersionResult = await saveTailorVersionAction({
        jobId,
        proposal,
        decisions: list,
      });
      if (r.ok) {
        setSaved(r.replacedOldest ? "replaced" : "new");
        setFailure(null);
        router.refresh();
      } else {
        setSaved(false);
        setFailure({ error: r.error, ...(r.ref ? { ref: r.ref } : {}) });
      }
    });
  }

  if (suggestions.length === 0) return null;

  const headingOf = (id: string) => suggestions.find((s) => s.id === id)?.heading ?? "";

  return (
    <div className="flex flex-col gap-4" data-testid="tailor-suggestions">
      <ul className="flex flex-col gap-3">
        {suggestions.map((s) => {
          const d = decisions[s.id];
          const isEditing = editing === s.id;
          const label = s.kind === "skills" ? T.adaptar.skillsTitulo : s.heading;
          return (
            <li
              key={s.id}
              data-testid={`tailor-suggestion-${s.id}`}
              className="flex flex-col gap-2 rounded-card border border-line p-3"
            >
              <p className="font-bold">{label}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-fg-muted">{T.adaptar.antes}</p>
                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-base">
                    {s.before.map((b, i) => (
                      <li key={`${i}|${b}`}>{b}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-medium text-fg-muted">{T.adaptar.despues}</p>
                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-base">
                    {s.after.map((b, i) => (
                      <li key={`${i}|${b}`}>{b}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {isEditing ? (
                <div className="flex flex-col gap-2">
                  <label htmlFor={`${uid}-${s.id}`} className="text-sm font-medium">
                    {T.adaptar.editarEtiqueta}
                  </label>
                  <p className="text-sm text-fg-muted">{T.adaptar.editarAyuda}</p>
                  <textarea
                    id={`${uid}-${s.id}`}
                    data-testid={`tailor-edit-text-${s.id}`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={Math.min(8, Math.max(3, draft.split("\n").length + 1))}
                    maxLength={2400}
                    className="w-full rounded-card border border-line bg-surface p-2 text-base"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      data-testid={`tailor-edit-ok-${s.id}`}
                      onClick={() => {
                        const bullets = draft
                          .split("\n")
                          .map((x) => x.trim())
                          .filter((x) => x !== "")
                          .slice(0, MAX_BULLETS);
                        if (bullets.length > 0) decide(s.id, { action: "edit", bullets });
                        setEditing(null);
                      }}
                    >
                      {T.adaptar.guardarEdicion}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
                      {T.adaptar.cancelarEdicion}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={d?.action === "accept" ? "dark" : "secondary"}
                    aria-pressed={d?.action === "accept"}
                    data-testid={`tailor-accept-${s.id}`}
                    onClick={() => decide(s.id, { action: "accept" })}
                  >
                    {T.adaptar.aceptar}
                  </Button>
                  {s.editable ? (
                    <Button
                      size="sm"
                      variant={d?.action === "edit" ? "dark" : "secondary"}
                      aria-pressed={d?.action === "edit"}
                      data-testid={`tailor-edit-${s.id}`}
                      onClick={() => {
                        setDraft((d?.action === "edit" ? d.bullets : s.after).join("\n"));
                        setEditing(s.id);
                      }}
                    >
                      {T.adaptar.editar}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant={d?.action === "discard" ? "dark" : "secondary"}
                    aria-pressed={d?.action === "discard"}
                    data-testid={`tailor-discard-${s.id}`}
                    onClick={() => decide(s.id, { action: "discard" })}
                  >
                    {T.adaptar.descartar}
                  </Button>
                  {d ? (
                    <>
                      <span className="text-sm text-fg-muted" data-testid={`tailor-state-${s.id}`}>
                        {d.action === "accept"
                          ? T.adaptar.aceptada
                          : d.action === "edit"
                            ? T.adaptar.editada
                            : T.adaptar.descartada}
                      </span>
                      <button
                        type="button"
                        className="min-h-11 text-sm text-link underline underline-offset-2"
                        onClick={() => decide(s.id, null)}
                      >
                        {T.adaptar.deshacer}
                      </button>
                    </>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <section
        aria-labelledby={`${uid}-previa`}
        className="flex flex-col gap-3"
        data-testid="tailor-preview"
      >
        <h3 id={`${uid}-previa`} className="text-base font-extrabold">
          {TAILOR_PREVIEW_TITLE}
        </h3>
        {applied.length === 0 ? (
          <p className="text-base text-fg-muted">{T.adaptar.vistaPreviaVacia}</p>
        ) : (
          applied.map((s) => (
            <div key={s.id} className="flex flex-col gap-1">
              <p className="font-bold">
                {s.kind === "skills" ? T.adaptar.skillsTitulo : s.heading}
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-base">
                {resulting(s, decisions[s.id])!.map((b, i) => (
                  <li key={`${i}|${b}`}>{b}</li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <div aria-live="polite" className="flex flex-col gap-2">
        {saved ? (
          <Alert tone="success" role="status" data-testid="tailor-saved">
            {saved === "replaced" ? T.adaptar.guardadaReemplazo : T.adaptar.guardada}
          </Alert>
        ) : null}
        {failure ? (
          <Alert tone="warning" role="note" data-testid="tailor-save-error">
            {failure.error === "rejected" && failure.ref
              ? T.adaptar.rechazada.replace("{que}", headingOf(failure.ref))
              : (SAVE_ERRORS[failure.error] ?? T.adaptar.rechazadaGeneral)}
          </Alert>
        ) : null}
      </div>

      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-fg-muted">{T.adaptar.topeVersiones}</p>
        <Button
          size="sm"
          aria-disabled={pending || applied.length === 0}
          data-testid="tailor-save"
          onClick={save}
        >
          {pending ? T.adaptar.guardando : T.adaptar.guardar}
        </Button>
      </div>
    </div>
  );
}
