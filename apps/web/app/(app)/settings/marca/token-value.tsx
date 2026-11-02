"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Muestra el valor real de un token CSS (`--jso-*`) donde está ubicado: dentro del panel claro, el
 * de claro; dentro del oscuro, el de oscuro. Así la vitrina siempre dice lo que hay en globals.css.
 */
/** El CSS minificado acorta los colores (#ffffff → #fff): se muestran con 6 dígitos, como en el manual. */
function expandHex(value: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : value;
}

export function TokenValue({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    if (ref.current) {
      const raw = getComputedStyle(ref.current).getPropertyValue(`--jso-${name}`).trim();
      setValue(expandHex(raw).toUpperCase());
    }
  }, [name]);
  return (
    <span ref={ref} className="font-mono text-[11px] text-fg-subtle">
      {value || "…"}
    </span>
  );
}
