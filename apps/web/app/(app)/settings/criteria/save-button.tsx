"use client";

import { useFormStatus } from "react-dom";

const DEFAULT_CLASS =
  "min-h-11 rounded-control bg-brand px-4 py-2 text-base font-bold text-brand-contrast hover:bg-brand-hover";

export function SaveButton({
  label,
  pendingLabel = "Guardando…",
  className = DEFAULT_CLASS,
}: {
  label: string;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={`${className} disabled:opacity-60`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
