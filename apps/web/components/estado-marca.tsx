import type { ReactNode } from "react";
import { Illustration } from "@/components/brand/illustration";
import { Monogram } from "@/components/brand/logo";
import { Mascota } from "@/components/mascota";
import { EmptyState, type EmptyStateProps } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import { visualDeEstado, type EstadoTipo } from "@/lib/estados-vacios";

/**
 * Estado vacío con la marca (R23-07): un solo componente para los vacíos de las pantallas. Dibuja la
 * mascota si ya existe la pose, si no la ilustración de la escena y, si el tipo no tiene escena, el
 * monograma (ver `lib/estados-vacios.ts`). El texto dice qué pasa y `action`, qué hacer. Server
 * Component, sin JS. `boxed`: panel con la figura arriba; `inline`: dentro de una tarjeta que ya
 * tiene título, con el monograma chico al lado.
 */
export function EstadoMarca({
  tipo,
  variant = "boxed",
  title,
  action,
  className,
  children,
  ...props
}: Omit<EmptyStateProps, "illustration" | "variant" | "children"> & {
  tipo: EstadoTipo;
  variant?: "boxed" | "inline";
  children: ReactNode;
}) {
  const visual = visualDeEstado(tipo);
  if (variant === "inline") {
    return (
      <div className={cx("flex items-start gap-2", className)}>
        <span aria-hidden="true" className="mt-0.5 shrink-0">
          {visual.kind === "mascota" ? (
            <Mascota pose={visual.pose} size={28} />
          ) : (
            <Monogram size={24} tone="light" className="opacity-50" />
          )}
        </span>
        <EmptyState variant="inline" title={title} action={action} {...props}>
          {children}
        </EmptyState>
      </div>
    );
  }
  const figura =
    visual.kind === "mascota" ? (
      <Mascota pose={visual.pose} size={96} />
    ) : visual.kind === "ilustracion" ? (
      <Illustration escena={visual.escena} className="w-40 sm:w-52" />
    ) : (
      <Mascota pose="quieta" size={72} className="opacity-90" />
    );
  return (
    <EmptyState
      variant="boxed"
      illustration={figura}
      title={title}
      action={action}
      className={className}
      {...props}
    >
      {children}
    </EmptyState>
  );
}
