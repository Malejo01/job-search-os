import { LoadingStatus, Skeleton, SkeletonCard, SkeletonText } from "@/components/ui/skeleton";

/** Esqueleto del detalle de una oferta (R5-C6), con el ancho del `article` de la página. */
export default function JobDetailLoading() {
  return (
    <LoadingStatus
      data-ancho="completo"
      className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-28 sm:pt-8 sm:pb-10"
    >
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="h-4 w-1/3" />
      <SkeletonCard className="min-h-40" />
      <SkeletonText lines={5} />
      <SkeletonCard />
    </LoadingStatus>
  );
}
