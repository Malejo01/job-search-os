"use client";

import { BRAND_COLORS } from "@job-search-os/pipeline";

// Reemplaza al layout raíz: sin Tailwind ni componentes compartidos, porque el layout puede ser lo que falló.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const button = {
    minHeight: 44,
    padding: "8px 16px",
    border: 0,
    borderRadius: 12,
    background: BRAND_COLORS.accent,
    color: BRAND_COLORS.ink,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  } as const;
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: BRAND_COLORS.ink }}>
        <main
          id="contenido"
          style={{
            maxWidth: 448,
            margin: "0 auto",
            padding: "64px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Algo falló de nuestro lado</h1>
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
