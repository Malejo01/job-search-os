import { LoadingStatus, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/**
 * Esqueleto de «Sin descripción» (R5-C6). Va aparte del de /jobs: ese es de ancho completo y esta
 * página usa el ancho normal del `main`.
 */
export default function PendingJdLoading() {
  return (
    <LoadingStatus className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <SkeletonTitle />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </LoadingStatus>
  );
}
