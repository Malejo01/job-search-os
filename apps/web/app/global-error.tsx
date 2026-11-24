"use client";

import { BRAND_COLORS } from "@job-search-os/pipeline";
import { mascotaAncho, mascotaSrc } from "@/lib/mascota";

// Reemplaza al layout raíz: sin Tailwind ni componentes compartidos, porque el layout puede ser lo que falló.
// F1 (C9-13): el recuadro lavanda con el monograma, una frase clara y una salida, con estilos en línea.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const button = {
    minHeight: 44,
    padding: "8px 24px",
    border: 0,
    borderBottom: `6px solid ${BRAND_COLORS.accentEdge}`,
    borderRadius: 9999,
    background: BRAND_COLORS.accent,
    color: BRAND_COLORS.ink,
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
  } as const;
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          color: BRAND_COLORS.ink,
          background: BRAND_COLORS.canvas,
        }}
      >
        <main
          id="contenido"
          style={{
            maxWidth: 448,
            margin: "0 auto",
            padding: "64px 16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 16,
          }}
        >
          {/* R27-05: la mascota `analizando` sobre el círculo lavanda, con estilos en línea (sin Tailwind) */}
          <div
            aria-hidden="true"
            style={{
              width: 176,
              height: 176,
              borderRadius: "50%",
              background: BRAND_COLORS.canvas,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              {...mascotaSrc("analizando")}
              sizes={`${mascotaAncho("analizando", 176)}px`}
              width={mascotaAncho("analizando", 176)}
              height={176}
              alt=""
              draggable={false}
              style={{ display: "block", height: "100%", width: "auto", maxWidth: "none" }}
            />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Algo falló de nuestro lado</h1>
          <p style={{ fontSize: 14, color: BRAND_COLORS.textMuted, margin: 0 }}>
            Probá de nuevo. Si sigue pasando, avisanos.
          </p>
          <div>
            <button type="button" onClick={() => reset()} style={button}>
              Probar de nuevo
            </button>
          </div>
          {/* Nunca error.message: puede citar datos. */}
          {error.digest ? (
            <p style={{ fontSize: 12, color: BRAND_COLORS.textMuted, margin: 0 }}>
              Código: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
