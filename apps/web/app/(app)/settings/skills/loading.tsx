import { LoadingStatus, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Esqueleto de Skills (R5-C6), con el ancho de la página (`max-w-2xl`). */
export default function SkillsLoading() {
  return (
    <LoadingStatus className="mx-auto flex max-w-2xl flex-col gap-5">
      <SkeletonTitle />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </LoadingStatus>
  );
}
