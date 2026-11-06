"use client";

import { useEffect } from "react";
import { watchThemeClass } from "@/lib/theme";

/**
 * Mantiene la clase `dark` de `<html>` igual a la preferencia guardada en todas las rutas (R4-02).
 * El script del `<head>` corre una sola vez: si React reescribe `<html class>` (por ejemplo tras el
 * `router.refresh()` de `<AutoRefresh />`), esto la vuelve a poner. Va en el layout raíz porque hay
 * pantallas sin `ThemeToggle` (onboarding, legal, inglés). No pinta nada.
 */
export function ThemeSync() {
  useEffect(() => watchThemeClass(), []);
  return null;
}
