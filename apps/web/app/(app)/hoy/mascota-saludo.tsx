"use client";

import { useEffect, useState } from "react";
import { AfiAnimadoLazy } from "@/components/afi-animado-lazy";
import { debeSaludar } from "@/lib/momentos";
import { SALUDO_STORAGE_KEY } from "@/lib/mascota";

/**
 * Saludo de la mascota en Hoy, una vez por día (R27-04). El día de hoy (`today`, en la zona de la persona)
 * y el último día saludado de la cuenta (`accountDay`) vienen del servidor, sin consulta nueva: el perfil
 * ya se leía. El navegador guarda además lo suyo por si la cuenta no se pudo leer o guardar. Aparece
 * después de montar, en la esquina de la cabecera (posición absoluta, así no mueve nada).
 */
export function MascotaSaludo({
  today,
  accountDay,
  action,
}: {
  today: string;
  accountDay: string | null;
  action: (day: string) => Promise<void>;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // Un momento después de cargar, como el aviso del asistente: el estado cambia en el callback
    const timer = window.setTimeout(() => {
      try {
        if (!debeSaludar(accountDay, window.localStorage.getItem(SALUDO_STORAGE_KEY), today))
          return;
        window.localStorage.setItem(SALUDO_STORAGE_KEY, today);
      } catch {
        // Modo privado o sin almacenamiento: mejor no saludar que saludar siempre
        return;
      }
      setShow(true);
      void action(today).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [today, accountDay, action]);
  if (!show) return null;
  return (
    <div data-testid="mascota-saludo" className="absolute top-2 right-4 sm:top-4 sm:right-12">
      <AfiAnimadoLazy pose="saludando" size={56} variante="entrada" />
    </div>
  );
}
