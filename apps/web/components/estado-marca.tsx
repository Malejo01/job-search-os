import type { ReactNode } from "react";
import { Afi } from "@/components/afi";
import { EmptyState, type EmptyStateProps } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import { poseDeEstado, type EstadoTipo } from "@/lib/estados-vacios";
import type { MascotaPose } from "@/lib/mascota";

/**
 * Estado vacío con la marca (R23-07, R27-05): un solo componente para los vacíos de las pantallas. Dibuja
 * a la mascota en la pose del tipo (ver `lib/estados-vacios.ts`) o en la que pida `pose`. El texto dice qué
 * pasa y `action`, qué hacer. Server Component, sin JS: la mascota es estática y decorativa (el texto de al
 * lado ya lo dice). `boxed`: panel con la figura arriba; `inline`: dentro de una tarjeta que ya tiene
 * título, con la figura chica al lado.
 */
export function EstadoMarca({
  tipo,
  pose,
  variant = "boxed",
  title,
  action,
  className,
  children,
  ...props
}: Omit<EmptyStateProps, "illustration" | "variant" | "children"> & {
  tipo: EstadoTipo;
  /** Otra pose distinta de la del tipo (por ejemplo `trabajando` en Match). */
  pose?: MascotaPose;
  variant?: "boxed" | "inline";
  children: ReactNode;
}) {
  const laPose = poseDeEstado(tipo, pose);
  if (variant === "inline") {
    return (
      <div className={cx("flex items-start gap-2", className)}>
        <span className="mt-0.5 shrink-0">
          <Afi pose={laPose} size={36} decorative />
        </span>
        <EmptyState variant="inline" title={title} action={action} {...props}>
          {children}
        </EmptyState>
      </div>
    );
  }
  return (
    <EmptyState
      variant="boxed"
      illustration={<Afi pose={laPose} size={112} decorative />}
      title={title}
      action={action}
      className={className}
      {...props}
    >
      {children}
    </EmptyState>
  );
}
