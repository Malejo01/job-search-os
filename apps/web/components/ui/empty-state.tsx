import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Estado vacío (N3-3; V3 en C9). `boxed`: panel blanco de radio 32 para una lista entera vacía
 * (/jobs, /applications), con lugar para una ilustración chica arriba (`illustration`).
 * `inline`: frase y acción dentro de una tarjeta que ya tiene título (/hoy). El texto dice qué
 * pasa y la acción, qué hacer: nunca un vacío sin salida. Una sola acción principal.
 */
export type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  variant?: "boxed" | "inline";
  title?: ReactNode;
  /** Ilustración chica (`<Illustration>`), solo en `boxed`. */
  illustration?: ReactNode;
  /** Qué hacer ahora. `null` solo si de verdad no hay salida, y que quede dicho en el PR. */
  action: ReactNode | null;
  children: ReactNode;
};

export function EmptyState({
  variant = "boxed",
  title,
  illustration,
  action,
  className,
  children,
  ...props
}: EmptyStateProps) {
  const boxed = variant === "boxed";
  return (
    <div
      className={cx(
        "flex flex-col text-sm text-fg-muted",
        boxed
          ? "items-center gap-3 rounded-container bg-surface px-6 py-8 text-center sm:px-10"
          : "gap-1",
        className,
      )}
      {...props}
    >
      {boxed && illustration ? illustration : null}
      {title ? (
        <p className={cx("text-fg", boxed ? "font-display text-lg font-bold" : "font-semibold")}>
          {title}
        </p>
      ) : null}
      {typeof children === "string" ? <p>{children}</p> : children}
      {action}
    </div>
  );
}
