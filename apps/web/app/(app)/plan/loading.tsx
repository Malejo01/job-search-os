import { LoadingStatus, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Esqueleto del Plan de formación (R8-0): título y tarjetas, con el ancho normal del `main`. Sin rutas hijas. */
export default function PlanLoading() {
  return (
    <LoadingStatus className="flex flex-col gap-5">
      <SkeletonTitle className="w-64" />
      <SkeletonCard />
      <SkeletonCard />
    </LoadingStatus>
  );
}
