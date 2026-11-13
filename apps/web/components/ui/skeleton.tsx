import type { HTMLAttributes, ReactNode } from "react";
import { Card } from "./card";
import { cx } from "./cx";

/**
 * Esqueletos de carga (R8-0, de R5-C6). Server Components, sin JS: los `loading.tsx` de la app los
 * arman con la misma forma y los mismos anchos que la página real, para que al llegar los datos no
 * se mueva nada. El pulso es `motion-safe:`: con «reducir movimiento» el esqueleto queda quieto.
 *
 * Importante: un `loading.tsx` hace que la respuesta salga en streaming, con el status 200 antes de
 * que la página corra. Por eso solo va en segmentos cuya página no hace `notFound()` ni `redirect()`
 * y que no tienen hijos que lo hagan (ver el comentario de cada `loading.tsx`).
 */

/** Un bloque gris. El alto y el ancho los pone quien lo usa (`className`). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-skeleton=""
      className={cx("rounded-control bg-line motion-safe:animate-pulse", className)}
    />
  );
}

/** Varias líneas de texto; la última más corta, como un párrafo. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cx("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cx("h-3.5", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Una tarjeta de lista con un título y dos líneas. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <Card level="list" padding="md" className={cx("flex flex-col gap-3", className)}>
      <Skeleton className="h-5 w-1/2" />
      <SkeletonText lines={2} />
    </Card>
  );
}

/**
 * Contenedor de una pantalla cargando: avisa a los lectores (`role="status"`, un texto solo para
 * ellos) y marca la zona como ocupada. `data-ancho="completo"` lo pasa quien lo necesita, igual que
 * la página real, para que el `main` del layout tenga el mismo ancho.
 */
export function LoadingStatus({
  label = "Cargando…",
  className,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & { label?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" data-testid="cargando" className={className} {...props}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Título de página (h1 en `text-title`): 1,875 rem de alto, como el de las páginas reales. */
export function SkeletonTitle({ className }: { className?: string }) {
  return <Skeleton className={cx("h-[1.875rem] w-48", className)} />;
}
