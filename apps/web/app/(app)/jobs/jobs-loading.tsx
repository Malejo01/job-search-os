import { LISTADO_TEXTOS } from "@/lib/textos-rediseno";

/**
 * Estado de carga del listado (R30-05): fallback del `Suspense` de `/jobs/page.tsx`. Va ahí y no en un
 * `loading.tsx` porque ese envolvería también a `/jobs/[id]` y a sus rutas hijas, y un `notFound()`
 * dentro respondería 200. Anuncia el estado a los lectores de pantalla y no anima nada.
 */
export function JobsLoading() {
  return (
    <div data-ancho="completo" className="mx-auto w-full max-w-[1280px] px-3.5 pt-6 sm:px-12">
      <p role="status" data-testid="jobs-cargando" className="text-sm font-semibold text-fg-muted">
        {LISTADO_TEXTOS.filtros.cargando}
      </p>
      <ul aria-hidden="true" className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-28 rounded-card border border-line bg-surface-muted" />
        ))}
      </ul>
    </div>
  );
}
