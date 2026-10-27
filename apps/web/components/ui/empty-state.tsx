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
  action?: ReactNode;
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
        "flex flex-col gap-1 text-sm",
        boxed
          ? "items-center rounded-card border border-dashed border-line-strong p-6 text-center text-fg-subtle"
          : "text-fg-muted",
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
