import { COVERAGE_ENTRY_THRESHOLD, COVERAGE_TOMABLE_THRESHOLD } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { getCobertura } from "@/lib/cobertura";
import { requireUserId } from "@/lib/session";
import { COBERTURA_TEXTOS as T } from "@/lib/textos-rediseno";
import { CoberturaPanel } from "./cobertura-panel";

export const metadata: Metadata = { title: "Cobertura por carrera", robots: { index: false } };
export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * Cobertura del pool por carrera (R32-02): solo admins (404 para el resto). Informa y no abre nada: el
 * responsable decide. Solo agregados del pool global. Server Component, sin JavaScript en el navegador.
 */
export default async function CoberturaPage() {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const result = await getCobertura(userId);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">{T.titulo}</h1>
        <p className="text-sm text-fg-muted">{T.intro}</p>
        <p className="text-sm font-medium text-fg">
          {T.umbral
            .replace("{tomables}", String(COVERAGE_TOMABLE_THRESHOLD))
            .replace("{empieza}", String(COVERAGE_ENTRY_THRESHOLD))}
        </p>
      </div>

      {!result.ok ? (
        <p role="status" data-testid="cobertura-sin-datos" className="text-sm text-fg-muted">
          {T.sinDatos}
        </p>
      ) : (
        <>
          <CoberturaPanel rows={result.rows} />
          <p className="text-xs text-fg-subtle">
            {T.generado.replace("{fecha}", WHEN.format(result.generatedAt))}
          </p>
        </>
      )}

      <details className="rounded-card bg-surface p-4 text-sm">
        <summary className="min-h-11 cursor-pointer font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
          {T.definiciones.titulo}
        </summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-fg-muted">
          <li>{T.definiciones.vigente}</li>
          <li>{T.definiciones.tomable}</li>
          <li>{T.definiciones.paraEmpezar}</li>
          <li>{T.definiciones.espanol}</li>
          <li>{T.definiciones.varias}</li>
        </ul>
      </details>
    </div>
  );
}
