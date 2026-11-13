import { LoadingStatus, Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/** Esqueleto de Hoy (R5-C6): la cabecera índigo y las dos columnas, con los anchos de la página. */
export default function HoyLoading() {
  return (
    <LoadingStatus data-ancho="completo" className="flex flex-col pb-10">
      <div className="flex min-h-[calc(100svh-9rem)] flex-col sm:min-h-[calc(100svh-4rem)]">
        <div className="rounded-b-[40px] bg-ink sm:rounded-b-[56px]">
          <div className="mx-auto mt-2.5 flex max-w-[1280px] items-end gap-1.5 px-5 sm:mt-0 sm:gap-6 sm:px-[72px]">
            <div className="min-w-0 flex-[1_1_55%] pb-[26px] sm:flex-auto sm:pb-14">
              <Skeleton className="h-8 w-3/4 bg-on-ink-muted/30 sm:h-12" />
              <Skeleton className="mt-3 h-4 w-2/3 bg-on-ink-muted/30 sm:h-5" />
            </div>
          </div>
        </div>
        <div className="mx-auto grid w-full max-w-[1280px] items-start gap-3 px-3.5 pt-4 sm:gap-7 sm:px-[72px] sm:pt-7 lg:grid-cols-[400px_1fr]">
          <SkeletonCard />
          <SkeletonCard className="min-h-48" />
        </div>
      </div>
    </LoadingStatus>
  );
}
