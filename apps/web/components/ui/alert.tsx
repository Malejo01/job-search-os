import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Aviso (N3-3): recuadro con fondo suave del tono. `role` es obligatorio a propósito: decide qué
 * anuncia el lector de pantalla y qué encuentran los `getByRole` de los e2e, así que al migrar se
 * conserva el que había. `"alert"` interrumpe (errores), `"status"` espera (confirmaciones),
 * `"note"` es un aviso fijo de la página y `null` no lleva rol.
 */
export type AlertTone = "info" | "success" | "warning" | "danger";

const TONES: Record<AlertTone, { box: string; line: string }> = {
  info: { box: "bg-info-soft text-info", line: "border-info-line" },
  success: { box: "bg-success-soft text-success", line: "border-success-line" },
  warning: { box: "bg-warning-soft text-warning", line: "border-warning-line" },
  danger: { box: "bg-danger-soft text-danger", line: "border-danger-line" },
};

export type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, "role" | "title"> & {
  tone: AlertTone;
  role: "alert" | "status" | "note" | null;
  bordered?: boolean;
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
};

export function alertClasses({
  tone,
  bordered = false,
  className,
}: Pick<AlertProps, "tone" | "bordered" | "className">): string {
  return cx(
    "rounded-control px-3 py-2 text-sm",
    TONES[tone].box,
    bordered && cx("border", TONES[tone].line),
    className,
  );
}

export function Alert({
  tone,
  role,
  bordered,
  title,
  action,
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role={role ?? undefined}
      className={alertClasses({ tone, bordered, className })}
      {...props}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {typeof children === "string" ? <p>{children}</p> : children}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
