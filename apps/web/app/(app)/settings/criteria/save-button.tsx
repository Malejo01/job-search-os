"use client";

import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/ui";

const DEFAULT_CLASS = buttonClasses();

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
