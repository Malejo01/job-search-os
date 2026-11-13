"use client";

import {
  PROFILE_AGENT_API,
  PROFILE_AGENT_STORAGE_KEYS,
  profileAgentPath,
  type CvDocument,
  type ProfileAgentBase,
  type ProfileAgentNextStep,
  type ProfileWrittenEntry,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { useState } from "react";
import { CvPreview } from "@/components/cv-preview";
import { PROFILE_AGENT_SUMMARY_KEY } from "@/components/profile-agent/onboarding-choice";
import { PrintButton } from "@/components/print-button";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";

type Notice = { message: string; links: { label: string; href: string }[] };
type Written = { doc: CvDocument; entries: ProfileWrittenEntry[]; summary: string | null };
type Phase =
  | { name: "idle" }
  | { name: "working" }
  | { name: "preview"; written: Written }
  | { name: "saving"; written: Written }
  | { name: "saved"; written: Written; updated: number };

const FALLBACK = "No pudimos completar el pedido. Probá de nuevo en un rato.";

function readTicket(): string | null {
  try {
    return window.sessionStorage.getItem(PROFILE_AGENT_STORAGE_KEYS.ticket);
  } catch {
    return null;
  }
}

/**
 * Cierre del agente (ADR-034 §9, pantalla 5): arma el CV ATS con lo confirmado (`cv_write` y el verificador
 * de ADR-026), lo muestra como vista previa y, con el clic de la persona, guarda las viñetas. Después,
 * Word, PDF y «qué sigue». El pedido al modelo es un clic (no corre solo al abrir la página).
 * El resumen verificado no lo guarda el agente: en el onboarding precarga el campo del formulario.
 */
export function ProfileAgentClose({
  base,
  nextSteps,
}: {
  base: ProfileAgentBase;
  nextSteps: ProfileAgentNextStep[];
}) {
  const [lang, setLang] = useState<"es" | "en">("es");
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expired, setExpired] = useState(false);

  async function call(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setError(null);
    setNotice(null);
    const ticket = readTicket();
    if (!ticket) {
      setExpired(true);
      return null;
    }
    try {
      const res = await fetch(PROFILE_AGENT_API.close, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, ...body }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (res.ok && data.ok === true) return data;
      if (data.error === "bad_ticket") {
        setExpired(true);
        return null;
      }
      if (Array.isArray(data.links)) {
        setNotice({
          message: typeof data.message === "string" ? data.message : FALLBACK,
          links: (data.links as { label: string; href: string }[]).filter(
            (l) => typeof l.href === "string" && l.href.startsWith("/"),
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

  async function write() {
    setPhase({ name: "working" });
    const data = await call({ action: "write", lang });
    if (!data) return setPhase({ name: "idle" });
    const written: Written = {
      doc: data.doc as CvDocument,
      entries: (data.entries as ProfileWrittenEntry[]) ?? [],
      summary: typeof data.summary === "string" ? data.summary : null,
    };
    setPhase({ name: "preview", written });
  }

  async function save(written: Written) {
    setPhase({ name: "saving", written });
    const data = await call({ action: "confirm", entries: written.entries });
    if (!data) return setPhase({ name: "preview", written });
    // El resumen no lo guarda el agente: el onboarding lo precarga editable en el formulario
    try {
      if (base === "onboarding" && written.summary) {
        window.sessionStorage.setItem(PROFILE_AGENT_SUMMARY_KEY, written.summary);
      }
    } catch {
      // sin sessionStorage el formulario queda como hoy
    }
    setPhase({ name: "saved", written, updated: Number(data.updated ?? 0) });
  }

  if (expired) {
    return (
      <Alert tone="warning" role="alert" data-testid="pa-close-expired">
        La charla venció. Empezá de nuevo; lo que ya confirmaste en tu perfil sigue ahí.{" "}
        <Link href={profileAgentPath(base, "read")} className="font-semibold underline">
          Volver al principio
        </Link>
      </Alert>
    );
  }

  const written =
    phase.name === "preview" || phase.name === "saving" || phase.name === "saved"
      ? phase.written
      : null;
  const saved = phase.name === "saved";
  const download = new URLSearchParams({ lang, email: "1", basicas: "0" }).toString();

  return (
    <div className="flex flex-col gap-5" data-testid="pa-close">
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="warning" role="alert" data-testid="pa-close-capped">
          {notice.message}{" "}
          {notice.links.map((l) => (
            <Link key={l.href} href={l.href} className="mr-2 font-semibold underline">
              {l.label}
            </Link>
          ))}
        </Alert>
      ) : null}

      {!written ? (
        <section
          className={cardClasses({ padding: "md", className: "no-print flex flex-col gap-3" })}
        >
          <h2 className="text-base font-bold text-fg">Armá tu CV para sistemas de selección</h2>
          <p className="text-sm text-fg-muted">
            Lo armamos solo con lo que confirmaste, en una columna y con títulos estándar. Una IA
            ordena tus propias palabras en viñetas y un verificador descarta todo número, nombre o
            tecnología que no hayas dicho vos. Antes de guardar nada lo revisás.
          </p>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
            Idioma
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value === "en" ? "en" : "es")}
              className={inputClasses()}
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </label>
          <button
            type="button"
            onClick={write}
            disabled={phase.name === "working"}
            className={buttonClasses({ className: "self-start" })}
            data-testid="pa-close-write"
          >
            {phase.name === "working" ? "Armando tu CV…" : "Armar mi CV"}
          </button>
        </section>
      ) : (
        <>
          <div className="no-print flex flex-wrap items-center gap-3">
            {saved ? (
              <>
                <a
                  href={`/api/cv/docx?${download}`}
                  download
                  className={buttonClasses()}
                  data-testid="pa-close-docx"
                >
                  Descargar Word
                </a>
                <PrintButton label="Guardar como PDF" />
                {base === "app" ? (
                  <Link href={`/cv?lang=${lang}`} className={buttonClasses({ variant: "ghost" })}>
                    Ver en Tu CV
                  </Link>
                ) : null}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => save(written)}
                  disabled={phase.name === "saving"}
                  className={buttonClasses()}
                  data-testid="pa-close-save"
                >
                  {phase.name === "saving" ? "Guardando…" : "Guardar este CV"}
                </button>
                <button
                  type="button"
                  onClick={() => setPhase({ name: "idle" })}
                  className={buttonClasses({ variant: "ghost" })}
                >
                  Descartar y volver
                </button>
              </>
            )}
          </div>
          {saved ? (
            <p
              className="no-print text-sm text-fg-muted"
              role="status"
              data-testid="pa-close-saved"
            >
              Listo: guardamos las viñetas de tus trabajos. El PDF sale de la impresión del
              navegador: elegí «Guardar como PDF» y desactivá los encabezados y pies de página.
            </p>
          ) : (
            <p className="no-print text-xs text-fg-subtle">
              Esto es una vista previa: todavía no se guardó nada. Si no te gusta una viñeta,
              descartá y editá tu historial a mano.
            </p>
          )}
          {written.summary && saved ? (
            <section
              className={cardClasses({ padding: "md", className: "no-print flex flex-col gap-1" })}
            >
              <h2 className="text-base font-bold text-fg">Resumen para tu perfil</h2>
              <p className="text-sm text-fg">{written.summary}</p>
              <p className="text-xs text-fg-subtle">
                {base === "onboarding"
                  ? "Lo vas a ver ya cargado en el formulario de tu perfil, para que lo edites."
                  : "No lo guardamos solo. Si te gusta, copialo en Tu perfil."}
              </p>
              {base === "app" ? (
                <Link href="/settings/perfil" className="text-sm font-semibold underline">
                  Ir a Tu perfil
                </Link>
              ) : null}
            </section>
          ) : null}
          <CvPreview doc={written.doc} />
        </>
      )}

      <section
        aria-labelledby="pa-next"
        className="no-print flex flex-col gap-3"
        data-testid="pa-next"
      >
        <h2 id="pa-next" className="text-lg font-bold text-fg">
          Qué sigue
        </h2>
        <ol className="flex list-none flex-col gap-2 p-0">
          {nextSteps.map((step) => (
            <li
              key={step.id}
              className={cardClasses({ padding: "md", className: "flex flex-col gap-1" })}
            >
              <p className="text-sm font-bold text-fg">{step.title}</p>
              <p className="text-sm text-fg-muted">{step.text}</p>
              {step.href ? (
                <Link
                  href={step.href}
                  className={buttonClasses({ variant: "secondary", className: "self-start" })}
                >
                  Ir
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
