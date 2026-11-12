import { LoadingStatus, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Esqueleto de Tu encaje (R5-C6): título y tarjetas, con el ancho normal del `main`. */
export default function EncajeLoading() {
  return (
    <LoadingStatus className="flex flex-col gap-5">
      <SkeletonTitle />
      <SkeletonCard className="min-h-40" />
      <SkeletonCard />
    </LoadingStatus>
  );
}
