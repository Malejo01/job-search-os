import { LoadingStatus, SkeletonCard, SkeletonTitle } from "@/components/ui/skeleton";

/** Esqueleto de Emails entrantes (R5-C6): título y lista, con el ancho normal del `main`. */
export default function InboxLoading() {
  return (
    <LoadingStatus className="flex flex-col gap-5">
      <SkeletonTitle className="w-56" />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </LoadingStatus>
  );
}
