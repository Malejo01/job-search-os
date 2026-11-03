import { cx } from "@/components/ui/cx";

/**
 * Esqueletos de carga (R-2, C9) con la forma del rediseño: las mismas tarjetas de radio 24 y el
 * mismo borde inferior, en gris quieto. Sin animación (decisión 13: nada en loop salvo el sello en
 * cola). Para lectores de pantalla es un solo «Cargando…» (con `aria-busy`, sin `role="status"`
 * para no sumar un estado más mientras carga); el resto es decorativo. En /jobs no hay: con el
 * panel lado a lado cada clic cambia `?oferta=` y el esqueleto taparía la lista.
 */
export function SkeletonBar({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cx("block rounded-pill bg-surface-strong", className)} />
  );
}

export function SkeletonOfferCard({ featured = false }: { featured?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        "flex gap-3 rounded-card border-edge bg-surface",
        featured ? "edge-6 p-5 sm:p-6" : "edge-4 p-4 sm:p-5",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <SkeletonBar className="h-5 w-3/4" />
        <SkeletonBar className="h-3.5 w-1/2" />
        <div className="flex gap-1.5">
          <SkeletonBar className="h-6 w-24" />
          <SkeletonBar className="h-6 w-20" />
        </div>
        <SkeletonBar className="h-3 w-28" />
      </div>
      <span
        className={cx(
          "shrink-0 rounded-pill bg-surface-strong",
          featured ? "size-[78px]" : "size-[60px]",
        )}
      />
    </div>
  );
}

export function SkeletonScreen({ children }: { children: React.ReactNode }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <p className="sr-only">Cargando…</p>
      {children}
    </div>
  );
}
