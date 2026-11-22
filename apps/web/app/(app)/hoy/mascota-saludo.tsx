"use client";

import { useEffect, useState } from "react";
import { Mascota } from "@/components/mascota";
import { dayKey, SALUDO_STORAGE_KEY, shouldGreetToday } from "@/lib/mascota";

/**
 * «Saludo» de la mascota en Hoy, una vez por día. El día se guarda en el navegador (`localStorage`):
 * cero consultas y nada en el servidor. Aparece después de montar, en la esquina de la cabecera
 * (posición absoluta, así no mueve nada), y sin animación propia. Sin almacenamiento, no se muestra.
 */
export function MascotaSaludo() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // Un momento después de cargar, como el aviso del asistente: el estado cambia en el callback
    const timer = window.setTimeout(() => {
      try {
        const today = dayKey(new Date());
        if (!shouldGreetToday(window.localStorage.getItem(SALUDO_STORAGE_KEY), today)) return;
        window.localStorage.setItem(SALUDO_STORAGE_KEY, today);
        setShow(true);
      } catch {
        // Modo privado o sin almacenamiento: mejor no saludar que saludar siempre
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, []);
  if (!show) return null;
  return (
    <div data-testid="mascota-saludo" className="absolute top-2 right-4 sm:top-4 sm:right-12">
      <Mascota pose="saludo" size={44} />
    </div>
  );
}
