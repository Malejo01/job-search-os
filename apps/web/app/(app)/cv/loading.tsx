import { LoadingStatus, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Esqueleto de Mi CV (R5-C6), con el ancho de la página (`max-w-3xl`). */
export default function CvLoading() {
  return (
    <LoadingStatus className="mx-auto flex max-w-3xl flex-col gap-5">
      <SkeletonTitle />
      <SkeletonCard className="min-h-40" />
      <SkeletonCard />
    </LoadingStatus>
  );
}
