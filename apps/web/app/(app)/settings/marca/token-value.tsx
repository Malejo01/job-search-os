"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Muestra el valor real de un token CSS (`--jso-*`) donde está ubicado: dentro del panel claro, el
 * de claro; dentro del oscuro, el de oscuro. Así la vitrina siempre dice lo que hay en globals.css.
 */
export function TokenValue({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    if (ref.current) {
      setValue(
        getComputedStyle(ref.current).getPropertyValue(`--jso-${name}`).trim().toUpperCase(),
      );
    }
  }, [name]);
  return (
    <span ref={ref} className="font-mono text-[11px] text-fg-subtle">
      {value || "…"}
    </span>
  );
}
