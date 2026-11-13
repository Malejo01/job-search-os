"use client";

import { profileAgentPath } from "@job-search-os/pipeline";
import Link from "next/link";
import { useState } from "react";
import { buttonClasses, cardClasses } from "@/components/ui";

/** Resumen verificado que el onboarding precarga (editable) en el formulario. Por pestaña, nunca `localStorage`. */
export const PROFILE_AGENT_SUMMARY_KEY = "jso:pa:summary";

/**
 * Primer paso opcional del onboarding (ADR-034, decisión 1): «Subí tu CV y armamos tu perfil» o «Prefiero
 * completarlo a mano». Solo se monta con `CV_PROFILE_AGENT` encendido y antes de pasar por el agente (lo
 * decide la página). «A mano» solo oculta la tarjeta: no guarda nada ni deja rastro en la URL.
 */
export function OnboardingChoice() {
  const [manual, setManual] = useState(false);
  if (manual) return null;
  return (
    <section
      aria-labelledby="pa-choice"
      data-testid="pa-onboarding-choice"
      className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}
    >
      <h2 id="pa-choice" className="text-base font-bold text-fg">
        ¿Querés arrancar con tu CV?
      </h2>
      <p className="text-sm text-fg-muted">
        Leemos tu CV en tu navegador, vos confirmás cada dato y te guiamos con lo que falte. No
        guardamos el archivo. Es opcional: también podés completar tu perfil a mano.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={profileAgentPath("onboarding", "read")}
          className={buttonClasses()}
          data-testid="pa-onboarding-cv"
        >
          Subí tu CV y armamos tu perfil
        </Link>
        <button
          type="button"
          onClick={() => setManual(true)}
          className={buttonClasses({ variant: "ghost" })}
          data-testid="pa-onboarding-manual"
        >
          Prefiero completarlo a mano
        </button>
      </div>
    </section>
  );
}
