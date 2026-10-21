import { ImageResponse } from "next/og";

/**
 * Imagen para compartir de la vitrina en inglés (ronda 122): misma composición que
 * `(public)/opengraph-image.tsx`, con el texto en inglés. Es un route handler y no un
 * `opengraph-image.tsx` dentro de `/en` porque `auth.config.ts` deja pública cualquier ruta que
 * empiece con `/opengraph-image`, y `/en/opengraph-image` no entraría.
 */
export const dynamic = "force-static";

const SIZE = { width: 1200, height: 630 };

export function GET() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        background: "#18181b",
        color: "#fafafa",
        padding: 80,
      }}
    >
      <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.15 }}>
        We read each job posting against your profile and tell you why or why not.
      </div>
      <div style={{ fontSize: 34, marginTop: 40, color: "#d4d4d8" }}>
        It never applies for you. You decide.
      </div>
    </div>,
    SIZE,
  );
}
