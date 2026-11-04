"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icons";
import { isDarkNow, setTheme, subscribeTheme } from "@/lib/theme";

/**
 * Botón de claro y oscuro de la barra índigo (C10, pedido de Mauro del 4/11): está en todas las
 * pantallas con sesión y en las públicas, al lado del avatar o de «Entrar». Pasa al otro modo y lo
 * deja guardado, igual que «Apariencia» en Ajustes (donde además está «Como el dispositivo»).
 * 44 px de área táctil; el nombre dice a qué modo pasa.
 */
export function ThemeToggle() {
  // En el servidor no se sabe el modo: se pinta como claro y se corrige al hidratar
  const dark = useSyncExternalStore(subscribeTheme, isDarkNow, () => false);
  const label = dark ? "Pasar a modo claro" : "Pasar a modo oscuro";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "claro" : "oscuro")}
      aria-label={label}
      title={label}
      data-testid="cambiar-tema"
      className="-my-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-pill text-on-ink-muted hover:bg-ink-line hover:text-on-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Icon name={dark ? "sol" : "luna"} size={20} />
    </button>
  );
}
