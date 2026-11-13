import { LoadingStatus, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Esqueleto de Perfil (R5-C6), con el ancho de la página (`max-w-xl`). */
export default function PerfilLoading() {
  return (
    <LoadingStatus className="mx-auto flex max-w-xl flex-col gap-5">
      <SkeletonTitle />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </LoadingStatus>
  );
}
