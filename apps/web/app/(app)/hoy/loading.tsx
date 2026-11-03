import { SkeletonOfferCard, SkeletonScreen } from "@/components/skeleton";

/** Carga de Hoy (R-2): la cabecera curva índigo (igual que la real) y la oferta destacada. */
export default function Loading() {
  return (
    <SkeletonScreen>
      <div
        aria-hidden="true"
        className="-mx-4 -mt-5 flex flex-col gap-3 rounded-b-[2.5rem] bg-ink px-5 pt-3 pb-9 sm:mx-0 sm:mt-0 sm:rounded-container sm:px-8 sm:pt-7 sm:pb-8"
      >
        <span className="block h-3.5 w-32 rounded-pill bg-ink-line" />
        <span className="block h-8 w-56 rounded-pill bg-ink-line" />
        <span className="block h-4 w-64 max-w-full rounded-pill bg-ink-line" />
      </div>
      <SkeletonOfferCard featured />
      <SkeletonOfferCard />
    </SkeletonScreen>
  );
}
