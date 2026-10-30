import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Estado vacío (N3-3). `boxed`: recuadro punteado centrado, para una lista entera vacía (/jobs,
 * /applications). `inline`: frase y acción dentro de una tarjeta que ya tiene título (/hoy).
 * El texto dice qué pasa y la acción, qué hacer: nunca un vacío sin salida.
 */
export type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  variant?: "boxed" | "inline";
  title?: ReactNode;
  /** Qué hacer ahora. `null` solo si de verdad no hay salida, y que quede dicho en el PR. */
  action: ReactNode | null;
  children: ReactNode;
};

export function EmptyState({
  variant = "boxed",
  title,
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
          ? "items-center gap-2 rounded-card border border-dashed border-line-strong p-6 text-center"
          : "gap-1",
        className,
      )}
      {...props}
    >
      {title ? <p className="font-medium text-fg">{title}</p> : null}
      {typeof children === "string" ? <p>{children}</p> : children}
      {action}
    </div>
  );
}
