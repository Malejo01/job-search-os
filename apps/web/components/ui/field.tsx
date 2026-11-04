import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { cx } from "./cx";

/**
 * Campo de texto (C7-4; medidas de C10-2, `.field` y `.fl` del tablero aprobado): borde de 2 px en
 * línea fuerte y 4 px abajo, radio 18, 13×16 de relleno, 15 px 600; la etiqueta va arriba en 13 px
 * 800. Con foco, el borde pasa al color de foco (y el anillo de la regla base). Los campos no se hunden: no son algo que se toca para hacer algo. Con error, borde y mensaje rojos, `aria-invalid` y el mensaje
 * enlazado por `aria-describedby`. Para inputs sueltos que no usan `<Field>`, `inputClasses()`.
 */
export function inputClasses({
  invalid = false,
  multiline = false,
  className,
}: { invalid?: boolean; multiline?: boolean; className?: string } = {}): string {
  return cx(
    "w-full rounded-control border-x-2 border-t-2 border-b-4 bg-surface px-4 text-base font-semibold sm:text-[15px] text-fg placeholder:text-fg-subtle focus-visible:border-focus disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle",
    multiline ? "min-h-32 py-3" : "min-h-[52px] py-[13px]",
    invalid ? "border-danger-strong" : "border-line-strong",
    className,
  );
}

/** Etiqueta de campo (`.fl`): 13 px 800, arriba del campo. Para labels sueltos que no usan `<Field>`. */
export function labelClasses({ className }: { className?: string } = {}): string {
  return cx("text-[13px] font-extrabold text-fg", className);
}

type Common = {
  label: ReactNode;
  /** Ayuda debajo del campo (formato, ejemplo). */
  hint?: ReactNode;
  /** Mensaje de error; si está, el campo queda marcado como inválido. */
  error?: ReactNode;
};

export type FieldProps =
  | (Common & { multiline?: false } & InputHTMLAttributes<HTMLInputElement>)
  | (Common & { multiline: true } & TextareaHTMLAttributes<HTMLTextAreaElement>);

export function Field(props: FieldProps) {
  const auto = useId();
  const { label, hint, error, className, id = auto, ...rest } = props;
  const hintId = hint ? `${id}-ayuda` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const a11y = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  } as const;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={labelClasses()}>
        {label}
      </label>
      {rest.multiline ? (
        <textarea
          {...(({ multiline: _m, ...r }) => r)(
            rest as Common & TextareaHTMLAttributes<HTMLTextAreaElement> & { multiline: true },
          )}
          {...a11y}
          className={inputClasses({ invalid: Boolean(error), multiline: true })}
        />
      ) : (
        <input
          {...(({ multiline: _m, ...r }) => r)(
            rest as InputHTMLAttributes<HTMLInputElement> & { multiline?: false },
          )}
          {...a11y}
          className={inputClasses({ invalid: Boolean(error) })}
        />
      )}
      {hint ? (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
