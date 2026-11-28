"use client";

import Link from "next/link";
import { useState } from "react";
import type { CvDownloadWarning } from "@job-search-os/pipeline";
import { buttonClasses, cardClasses } from "@/components/ui";
import { CV_DOCUMENTO_TEXTOS } from "@/lib/textos-rediseno";

type Format = "pdf" | "docx";
type Phase = "idle" | "loading" | "done" | "error";

const T = CV_DOCUMENTO_TEXTOS.descarga;
const A = CV_DOCUMENTO_TEXTOS.aviso;

/**
 * Descarga del CV en el navegador (R33-08, C-48 y C-54). Pide el archivo a `/api/cv/<formato>` con la misma
 * consulta que la vista previa y lo baja como adjunto, con estado de carga y, si falla, un error con el
 * siguiente paso. El archivo no queda en ninguna URL: se arma en memoria.
 */
function useCvFile(format: Format, query: string) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");

  async function start() {
    setPhase("loading");
    setMessage(T.generando);
    try {
      const res = await fetch(`/api/cv/${format}?${query}`, { credentials: "same-origin" });
      if (!res.ok) {
        const retry = Number(res.headers.get("Retry-After") ?? "");
        setMessage(
          res.status === 401
            ? T.errorSesion
            : res.status === 404
              ? T.errorSinPerfil
              : res.status === 429
                ? T.errorRitmo.replace(
                    "{n}",
                    String(Number.isFinite(retry) && retry > 0 ? retry : 60),
                  )
                : T.errorGenerico,
        );
        setPhase("error");
        return;
      }
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
        `CV.${format}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage(T.listo);
      setPhase("done");
    } catch {
      setMessage(T.errorGenerico);
      setPhase("error");
    }
  }
  return { phase, message, start };
}

function Status({ format, phase, message }: { format: Format; phase: Phase; message: string }) {
  return (
    <span
      role={phase === "error" ? "alert" : "status"}
      data-testid={`cv-descargar-${format}-estado`}
      className={phase === "error" ? "text-sm text-danger" : "text-sm text-fg-muted"}
    >
      {phase === "idle" ? "" : message}
    </span>
  );
}

/**
 * «Descargar DOCX» y «Descargar PDF» (R33-07 y R33-08). Si al CV le falta Educación, el Resumen o los
 * resultados en los logros, antes de bajar pregunta «¿Completarlo antes?» (C-46); «Descargar igual» baja el
 * archivo sin más vueltas. El DOCX sigue siendo un link a `/api/cv/docx` (sin JavaScript también baja).
 */
export function CvDescargas({
  query,
  warnings,
  completeHref,
}: {
  /** Consulta ya armada (`lang=es&email=1&…`), la misma de la vista previa. */
  query: string;
  warnings: readonly CvDownloadWarning[];
  /** Adónde lleva «Completar». */
  completeHref: string;
}) {
  const docx = useCvFile("docx", query);
  const pdf = useCvFile("pdf", query);
  const [ask, setAsk] = useState<Format | null>(null);
  const files = { docx, pdf };

  function request(format: Format) {
    if (warnings.length > 0) setAsk(format);
    else void files[format].start();
  }
  function goAnyway() {
    const format = ask;
    setAsk(null);
    if (format) void files[format].start();
  }

  const list = warnings.map((w) => A.items[w]).join(" / ");
  return (
    <div className="no-print flex flex-col gap-3" data-testid="cv-descargas">
      <div className="flex flex-wrap items-start gap-3">
        <span className="inline-flex flex-col gap-1">
          <a
            href={`/api/cv/docx?${query}`}
            download
            data-testid="cv-descargar-docx"
            aria-busy={docx.phase === "loading"}
            onClick={(e) => {
              e.preventDefault();
              request("docx");
            }}
            className={buttonClasses()}
          >
            {docx.phase === "loading" ? T.generando : T.docx}
          </a>
          <Status format="docx" phase={docx.phase} message={docx.message} />
        </span>
        <span className="inline-flex flex-col gap-1">
          <button
            type="button"
            onClick={() => request("pdf")}
            disabled={pdf.phase === "loading"}
            aria-busy={pdf.phase === "loading"}
            data-testid="cv-descargar-pdf"
            className={buttonClasses()}
          >
            {pdf.phase === "loading" ? T.generando : T.pdf}
          </button>
          <Status format="pdf" phase={pdf.phase} message={pdf.message} />
        </span>
      </div>
      {ask ? (
        <section
          role="alert"
          data-testid="cv-aviso-descarga"
          className={cardClasses({
            tone: "warning",
            padding: "md",
            className: "flex flex-col gap-3",
          })}
        >
          <p className="text-sm text-warning">
            <strong>{A.titulo.replace("{lista}", list)}</strong> {A.pregunta}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={completeHref} className={buttonClasses()}>
              {A.completar}
            </Link>
            <button
              type="button"
              onClick={goAnyway}
              data-testid="cv-descargar-igual"
              className={buttonClasses({ variant: "secondary" })}
            >
              {A.igual}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
