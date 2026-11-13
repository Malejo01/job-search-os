import { LoadingStatus, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Esqueleto de Postulaciones (R5-C6): título y tarjetas, con el ancho normal del `main`. */
export default function ApplicationsLoading() {
  return (
    <LoadingStatus className="flex flex-col gap-4">
      <SkeletonTitle className="w-44" />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </LoadingStatus>
  );
}
