import { LoadingStatus, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Esqueleto de «Cargar oferta» (R5-C6). Va aparte del de /jobs, que es de ancho completo. */
export default function NewJobLoading() {
  return (
    <LoadingStatus className="flex flex-col gap-5">
      <SkeletonTitle />
      <SkeletonCard className="min-h-48" />
    </LoadingStatus>
  );
}
