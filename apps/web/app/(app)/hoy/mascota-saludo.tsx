"use client";

import { useEffect, useState, type ReactNode } from "react";
import { debeSaludar } from "@/lib/momentos";
import { SALUDO_STORAGE_KEY } from "@/lib/mascota";

/**
 * Afi en la cabecera de Hoy (R27-04, reescrito en R28-15). Hoy siempre tiene a Afi hablando; lo que decide el
 * navegador es si es la primera vez del día. El servidor arma las dos versiones ya hechas (`<AfiDice>`) y esto
 * solo elige cuál mostrar:
 *
 * - `quieto`: el resto del día. Afi quieto, sin animar. Es lo que sale en el HTML del servidor.
 * - `saludo`: la primera vez del día, con la entrada `saludando` animada y el saludo en la burbuja.
 *
 * Cuándo es la primera vez: el día de hoy (`today`, en la zona de la persona) y el último día saludado de la
 * cuenta (`accountDay`) vienen del servidor, sin consulta nueva. El navegador guarda además lo suyo por si la
 * cuenta no se pudo leer o guardar. Sin almacenamiento (modo privado) no se saluda: queda `quieto`.
 */
export function MascotaSaludo({
  today,
  accountDay,
  action,
  quieto,
  saludo,
}: {
  today: string;
  accountDay: string | null;
  action: (day: string) => Promise<void>;
  quieto: ReactNode;
  saludo: ReactNode;
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
  return show ? (
    <div data-testid="mascota-saludo" data-saludo="primera-vez">
      {saludo}
    </div>
  ) : (
    <div data-testid="mascota-quieto">{quieto}</div>
  );
}
