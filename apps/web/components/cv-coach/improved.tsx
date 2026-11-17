"use client";

import {
  cvIssueView,
  diffCv,
  type CvDiff,
  type CvDiffItem,
  type CvIssue,
  type CvReviewContext,
} from "@job-search-os/pipeline";
import { useMemo } from "react";
import { Badge, cardClasses } from "@/components/ui";
import { parseCoachSnapshot, useCoachSnapshot } from "@/lib/cv-coach/storage";

const STATUS_LABEL: Record<CvDiff["items"][number]["status"], string> = {
  changed: "Cambió",
  new: "Nuevo",
  removed: "Quitado",
  same: "Sin cambios",
};

/**
 * «Qué mejoró» (ADR-038 §8, R12-11). Lee del navegador la foto «antes», la lista de problemas y el avance de
 * la charla; lo de hoy (`after`) llega del servidor, leído con RLS. La comparación es `diffCv` (pura): sin la
 * foto muestra solo los problemas, y nunca pinta texto que no esté en la base o en la foto (las citas se
 * revalidan contra el ítem). Los textos de los problemas son las plantillas del código.
 */
export function CvCoachImproved({
  after,
  target,
  skills,
}: {
  after: CvDiffItem[];
  target: string;
  /** Nombres de las skills que pueden aparecer en una brecha (de la taxonomía). */
  skills: { slug: string; name: string }[];
}) {
  const snapshot = useCoachSnapshot();
  const { diff, ctx } = useMemo((): { diff: CvDiff | null; ctx: CvReviewContext | null } => {
    const stored = parseCoachSnapshot(snapshot);
    const list = stored.issues;
    if (!list) return { diff: null, ctx: null };
    const before = stored.before;
    const d = diffCv({
      flowId: list.flowId,
      before,
      after,
      issues: list.issues,
      progress: { resolved: stored.state?.resolved ?? [], skipped: stored.state?.skipped ?? [] },
    });
    // Anclas de los problemas: lo de hoy y, para lo que ya no está, la foto
    const known = new Map<string, CvDiffItem>();
    for (const i of before?.flowId === list.flowId ? before.items : []) known.set(i.historyId, i);
    for (const i of after) known.set(i.historyId, i);
    return {
      diff: d,
      ctx: {
        target,
        items: [...known.values()].map((i) => ({
          id: i.historyId,
          kind: i.kind,
          organization: i.organization,
          title: i.title,
          startMonth: null,
          endMonth: null,
          bullets: i.bullets,
          link: null,
        })),
        personSkills: [],
        taxonomy: skills.map((s) => ({ ...s, aliases: [] })),
        demand: [],
        summary: null,
      },
    };
  }, [snapshot, after, target, skills]);

  if (!diff || !ctx) return null;
  const total = diff.issues.resolved.length + diff.issues.skipped.length + diff.issues.open.length;
  if (total === 0 && !diff.hasBefore) return null;
  const changed = diff.items.filter((i) => i.status !== "same");

  const list = (title: string, issues: CvIssue[], testId: string) =>
    issues.length > 0 ? (
      <div className="flex flex-col gap-2" data-testid={testId}>
        <h3 className="text-sm font-bold text-fg">{title}</h3>
        <ul className="flex flex-col gap-1.5">
          {issues.map((i) => {
            const v = cvIssueView(i, ctx);
            return (
              <li key={i.id} className="text-sm text-fg">
                {v.title}
                {v.quote ? <span className="text-fg-muted"> «{v.quote}»</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
    ) : null;

  return (
    <section
      className={cardClasses({ padding: "md", className: "no-print flex flex-col gap-4" })}
      aria-labelledby="coach-improved-heading"
      data-testid="coach-improved"
    >
      <h2 id="coach-improved-heading" className="text-base font-bold text-fg">
        Qué mejoró
      </h2>
      {total > 0 ? (
        <p className="text-sm text-fg-muted">
          De {total} {total === 1 ? "cosa" : "cosas"} para mejorar, resolviste{" "}
          {diff.issues.resolved.length}.
        </p>
      ) : null}
      {list("Resuelto", diff.issues.resolved, "coach-improved-resolved")}
      {list("Salteado", diff.issues.skipped, "coach-improved-skipped")}
      {list("Queda pendiente", diff.issues.open, "coach-improved-open")}

      {diff.hasBefore && changed.length > 0 ? (
        <div className="flex flex-col gap-3" data-testid="coach-improved-items">
          <h3 className="text-sm font-bold text-fg">Tus viñetas, antes y ahora</h3>
          {changed.map((item) => (
            <article
              key={item.historyId}
              className="flex flex-col gap-2 border-t border-border pt-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-fg">
                  {item.title} · {item.organization}
                </span>
                <Badge tone={item.status === "removed" ? "neutral" : "success"}>
                  {STATUS_LABEL[item.status]}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-bold text-fg-muted">Antes</p>
                  <ul className="list-disc pl-5 text-sm text-fg-muted">
                    {item.before.length === 0 ? <li>Sin viñetas</li> : null}
                    {item.before.map((b) => (
                      <li key={b} className={item.removed.includes(b) ? "line-through" : undefined}>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-bold text-fg-muted">Ahora</p>
                  <ul className="list-disc pl-5 text-sm text-fg">
                    {item.after.length === 0 ? <li>Sin viñetas</li> : null}
                    {item.after.map((b) => (
                      <li key={b} className={item.added.includes(b) ? "font-semibold" : undefined}>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
