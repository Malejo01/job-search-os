import { SkeletonBar, SkeletonOfferCard, SkeletonScreen } from "@/components/skeleton";

/** Carga del detalle (R-2): la tarjeta destacada con el sello grande y dos paneles. */
export default function Loading() {
  return (
    <SkeletonScreen>
      <SkeletonBar className="h-4 w-24" />
      <SkeletonOfferCard featured />
      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-card bg-surface p-4">
          <SkeletonBar className="h-4 w-28" />
          <SkeletonBar className="h-3 w-full" />
          <SkeletonBar className="h-3 w-5/6" />
        </div>
        <div className="flex flex-col gap-2 rounded-card bg-surface p-4">
          <SkeletonBar className="h-4 w-32" />
          <SkeletonBar className="h-3 w-full" />
          <SkeletonBar className="h-3 w-2/3" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
