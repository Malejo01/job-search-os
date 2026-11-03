"use client";

import { MAX_JD_INPUT_CHARS } from "@job-search-os/pipeline";
import { useState } from "react";
import { TextareaWithCounter } from "@/components/char-counter";
import { buttonClasses, inputClasses } from "@/components/ui";

/**
 * Cuadro para pegar la descripción en la demo (C7-13): el contador funciona igual que en la app,
 * pero no se guarda nada. Al tocar el botón, dice qué pasaría con una cuenta.
 */
export function DemoPaste() {
  const [tried, setTried] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="demo-jd" className="text-sm font-semibold">
        Descripción del puesto
      </label>
      <TextareaWithCounter
        id="demo-jd"
        name="demoJd"
        softMin={200}
        max={MAX_JD_INPUT_CHARS}
        rows={5}
        placeholder="Pegá acá la descripción completa del puesto"
        className={inputClasses({ multiline: true, className: "text-sm" })}
      />
      <button
        type="button"
        onClick={() => setTried(true)}
        className={buttonClasses({ variant: "dark", size: "sm", className: "self-start" })}
      >
        Guardar descripción y evaluar
      </button>
      <p role="status" className="min-h-5 text-sm font-semibold text-success">
        {tried
          ? "En la demo no se guarda nada. Con tu cuenta, la oferta pasa a la cola y en unos minutos la ves con puntaje."
          : ""}
      </p>
    </div>
  );
}
