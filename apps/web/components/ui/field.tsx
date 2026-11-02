import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { cx } from "./cx";

/**
 * Campo de texto (C7-4, manual M8): borde de 2 px, radio 12, 44 px de alto y foco naranja (el
 * borde pasa al color de foco). Con error, borde y mensaje rojos, `aria-invalid` y el mensaje
 * enlazado por `aria-describedby`. Para inputs sueltos que no usan `<Field>`, `inputClasses()`.
 */
export function inputClasses({
  invalid = false,
  multiline = false,
  className,
}: { invalid?: boolean; multiline?: boolean; className?: string } = {}): string {
  return cx(
    "w-full rounded-control border-2 bg-surface px-3 text-base text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:border-focus disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle",
    multiline ? "min-h-32 py-2.5" : "min-h-11 py-2",
    invalid ? "border-danger-strong" : "border-line-control",
    className,
  );
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
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-fg">
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
