"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteDomainAction } from "./leak-actions";

/** "Eliminar todos los de este dominio" (JS-048): una sola confirmación con la cantidad. */
export function DeleteDomainButton({ domain, total }: { domain: string; total: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const ok = window.confirm(
          `¿Eliminar ${total} ${total === 1 ? "email" : "emails"} de ${domain}? Se borran de la base y no se puede deshacer.`,
        );
        if (!ok) return;
        startTransition(async () => {
          await deleteDomainAction(domain);
          router.refresh();
        });
      }}
      className="rounded border border-red-200 bg-white px-2 py-1 text-red-700"
    >
      Eliminar todos
    </button>
  );
}
