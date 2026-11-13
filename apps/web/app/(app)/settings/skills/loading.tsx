import { LoadingStatus, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Esqueleto de Skills (R5-C6), con el ancho de la página (`max-w-3xl`, R5-C9). */
export default function SkillsLoading() {
  return (
    <LoadingStatus className="mx-auto flex max-w-3xl flex-col gap-5">
      <SkeletonTitle />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </LoadingStatus>
  );
}
