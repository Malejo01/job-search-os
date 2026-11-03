import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./icons";

/**
 * Aviso (N3-3): recuadro con fondo suave del tono. `role` es obligatorio a propósito: decide qué
 * anuncia el lector de pantalla y qué encuentran los `getByRole` de los e2e, así que al migrar se
 * conserva el que había. `"alert"` interrumpe (errores), `"status"` espera (confirmaciones),
 * `"note"` es un aviso fijo de la página y `null` no lleva rol.
 *
 * C9-3: radio 18, más aire y un ícono del tono a la izquierda (sin cajita de color: el ícono va
 * suelto). Un error chico (F2) va en el lugar, al lado de lo que falló, y nunca borra lo escrito.
 */
export type AlertTone = "info" | "success" | "warning" | "danger";

const TONES: Record<AlertTone, { box: string; line: string; icon: IconName }> = {
  info: { box: "bg-info-soft text-info", line: "border-info-line", icon: "aviso" },
  success: { box: "bg-success-soft text-success", line: "border-success-line", icon: "check" },
  warning: { box: "bg-warning-soft text-warning", line: "border-warning-line", icon: "aviso" },
  danger: { box: "bg-danger-soft text-danger", line: "border-danger-line", icon: "aviso" },
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
    "rounded-control px-4 py-3 text-sm",
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
      <div className="flex gap-2.5">
        <Icon name={TONES[tone].icon} size={20} className="mt-px" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title ? <p className="font-bold">{title}</p> : null}
          {typeof children === "string" ? <p>{children}</p> : children}
          {action ? <div className="mt-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
