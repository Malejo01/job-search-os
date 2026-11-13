import { LoadingStatus, Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** Esqueleto de Ofertas (R5-C6): título, filtros rápidos y la lista con el panel de la derecha. */
export default function JobsLoading() {
  return (
    <LoadingStatus data-ancho="completo" className="flex flex-col pb-10">
      <div className="flex min-h-[calc(100svh-9rem)] flex-col sm:min-h-[calc(100svh-4.5rem)]">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col sm:flex-row sm:items-center sm:gap-2 sm:px-12 sm:pt-[22px]">
          <div className="bg-ink px-5 pb-[18px] sm:mr-3.5 sm:bg-transparent sm:p-0">
            <Skeleton className="h-8 w-40 bg-on-ink-muted/30 sm:bg-line" />
          </div>
          <div className="flex gap-1.5 overflow-hidden px-3.5 pt-1 sm:gap-2 sm:p-0">
            <Skeleton className="h-9 w-28 shrink-0 rounded-pill" />
            <Skeleton className="h-9 w-16 shrink-0 rounded-pill" />
            <Skeleton className="h-9 w-20 shrink-0 rounded-pill" />
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 px-3.5 pt-3 sm:px-12 sm:pt-[18px]">
          <div className="grid items-start gap-6 lg:grid-cols-[470px_1fr]">
            <div className="flex min-w-0 flex-col gap-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
            <SkeletonCard className="hidden min-h-72 lg:block" />
          </div>
        </div>
      </div>
    </LoadingStatus>
  );
}
