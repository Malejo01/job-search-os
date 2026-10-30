"use client";

import { useEffect } from "react";
import { clearProposal } from "./assistant-proposal";

/**
 * En /login se borra cualquier propuesta del asistente que haya quedado en la pestaña (AG-3): una
 * sesión que se cerró no le deja datos a la siguiente. No pinta nada.
 */
export function ClearAssistantProposal() {
  useEffect(() => {
    clearProposal();
  }, []);
  return null;
}
