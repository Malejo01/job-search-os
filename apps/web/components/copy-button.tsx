"use client";

import { useState } from "react";
import { buttonClasses } from "./ui";

/**
 * Botón «Copiar»: pone `text` en el portapapeles. Cliente chico, sin dependencias ni animaciones. Si el navegador no
 * deja copiar, no hace nada y no rompe la página (el texto sigue visible al lado para copiarlo a mano).
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  testId,
}: {
  text: string;
  label: string;
  copiedLabel: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={buttonClasses({ variant: "secondary" })}
      data-testid={testId}
      data-copiado={copied ? "1" : undefined}
    >
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}
