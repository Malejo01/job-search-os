"use client";

import { CV_COACH_API, CV_COACH_PAGES } from "@job-search-os/pipeline";
import { domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, buttonClasses, cardClasses } from "@/components/ui";
import {
  parseCoachSnapshot,
  readProfileTicket,
  saveDiagnosis,
  useCoachSnapshot,
  writeProfileTicket,
  type CvCoachViewsData,
} from "@/lib/cv-coach/storage";
import { isInternalPath } from "@/lib/internal-path";

type Notice = { message: string; links: { label: string; href: string }[] };
type Phase =
  | { name: "idle" }
  | { name: "working" }
  | { name: "done"; data: CvCoachViewsData }
  | { name: "expired" };

const FALLBACK = "No pudimos completar el pedido. Probá de nuevo en un rato.";
const SEVERITY: Record<string, { label: string; tone: "danger" | "warning" | "neutral" }> = {
  alta: { label: "Importante", tone: "danger" },
  media: { label: "Conviene", tone: "warning" },
  baja: { label: "Detalle", tone: "neutral" },
};

/**
 * Diagnóstico del coach de CV (ADR-038 §4, pantalla «Lo que le falta a tu CV para {puesto}»). El pedido al
 * modelo es un clic (no corre solo al abrir la página). Los textos son plantillas del código que arma el
 * servidor; acá solo se muestran. La lista firmada, los textos y la foto «antes» quedan en `sessionStorage`
 * para la charla y el «qué mejoró»; al recargar se muestran sin volver a pedir el diagnóstico.
 */
export function CvCoachDiagnosis() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Lo guardado en la pestaña: al recargar se muestra sin volver a pedir el diagnóstico
  const stored = parseCoachSnapshot(useCoachSnapshot());

  async function review() {
    setError(null);
    setNotice(null);
    const ticket = readProfileTicket();
    if (!ticket) return setPhase({ name: "expired" });
    setPhase({ name: "working" });
    try {
      const res = await fetch(CV_COACH_API.diagnosis, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (res.ok && data.ok === true) {
        const views = saveDiagnosis({
          issues: data.issues,
          heading: data.heading,
          views: data.views,
          before: data.before,
        });
        if (views) {
          if (typeof data.ticket === "string") writeProfileTicket(data.ticket);
          return setPhase({ name: "done", data: views });
        }
        setError(FALLBACK);
        return setPhase({ name: "idle" });
      }
      if (data.error === "bad_ticket") return setPhase({ name: "expired" });
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
    } catch {
      setError(FALLBACK);
    }
    setPhase({ name: "idle" });
  }

  if (!stored.ready) return null;
  const shown: CvCoachViewsData | null =
    phase.name === "done" ? phase.data : phase.name === "idle" ? stored.views : null;
  if (phase.name === "expired" || (!stored.ticket && !shown)) {
    return (
      <Alert tone="warning" role="alert" data-testid="coach-expired">
        Para revisar tu CV primero hay que leerlo. Empezá por la lectura; lo que ya confirmaste
        sigue en tu perfil.{" "}
        <Link href="/cv/perfil" className="font-semibold underline">
          Leer mi CV
        </Link>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="coach-diagnosis">
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="warning" role="alert" data-testid="coach-capped">
          {notice.message}{" "}
          {notice.links.map((l) => (
            <Link key={l.href} href={l.href} className="mr-2 font-semibold underline">
              {l.label}
            </Link>
          ))}
        </Alert>
      ) : null}

      {!shown ? (
        <section className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}>
          <h2 className="text-base font-bold text-fg">Revisemos tu CV contra lo que piden</h2>
          <p className="text-sm text-fg-muted">
            Miramos lo que confirmaste de tu CV y lo comparamos con lo que piden los avisos de tu
            puesto. Te mostramos qué le falta, de a una cosa, y después te preguntamos para
            completarlo. Nada cambia en tu perfil hasta que lo confirmes.
          </p>
          <button
            type="button"
            onClick={() => void review()}
            disabled={phase.name !== "idle"}
            className={buttonClasses({ className: "self-start" })}
            data-testid="coach-review"
          >
            {phase.name === "working" ? "Revisando tu CV…" : "Revisar mi CV"}
          </button>
        </section>
      ) : (
        <section className="flex flex-col gap-4" aria-labelledby="coach-heading">
          <h2 id="coach-heading" className="text-lg font-bold text-fg">
            {shown.heading}
          </h2>
          {shown.views.length === 0 ? (
            <p className="text-sm text-fg-muted" data-testid="coach-no-issues">
              No encontramos nada importante que mejorar. Podés armar tu CV con lo que confirmaste.
            </p>
          ) : (
            <LazyMotion features={domAnimation}>
              <ol className="flex flex-col gap-3" data-testid="coach-issues">
                {shown.views.map((v, n) => (
                  <m.li
                    key={v.id}
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: reduce ? 0 : n * 0.04 }}
                    className={cardClasses({ padding: "md", className: "flex flex-col gap-2" })}
                    data-testid="coach-issue"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY[v.severity]?.tone ?? "neutral"} srLabel="Prioridad">
                        {SEVERITY[v.severity]?.label ?? v.severity}
                      </Badge>
                      <span className="text-sm font-semibold text-fg">{v.title}</span>
                    </div>
                    {v.quote ? (
                      <blockquote className="border-l-2 border-border pl-3 text-sm text-fg-muted">
                        «{v.quote}» <span className="text-xs">(de tu CV)</span>
                      </blockquote>
                    ) : null}
                    <p className="text-sm text-fg-muted">{v.hint}</p>
                  </m.li>
                ))}
              </ol>
            </LazyMotion>
          )}
          <div className="flex flex-wrap gap-3">
            {shown.views.length > 0 ? (
              <Link
                href={CV_COACH_PAGES.chat}
                className={buttonClasses()}
                data-testid="coach-start-chat"
              >
                Empezar a mejorarlo
              </Link>
            ) : null}
            <Link
              href={CV_COACH_PAGES.done}
              className={buttonClasses({
                variant: shown.views.length > 0 ? "ghost" : "primary",
              })}
              data-testid="coach-finish"
            >
              Ya está, armalo
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
