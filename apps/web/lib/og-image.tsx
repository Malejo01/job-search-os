import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BRAND, BRAND_COLORS } from "@job-search-os/pipeline";
import { ImageResponse } from "next/og";

/**
 * Imagen para compartir de la vitrina (C7-2, logo B2 en C9-4): fondo índigo, logotipo AfinIA/Jobs con el punto, la
 * bajada «Ofertas afines. CV afinado.» y una línea de propuesta. Las fuentes salen del repo
 * (`apps/web/assets/fonts`), nunca por red: `next/og` no puede usar `next/font`.
 *
 * Las páginas que la usan son estáticas: la imagen se arma una vez en el build.
 */
export const OG_SIZE = { width: 1200, height: 630 } as const;

async function font(file: string): Promise<ArrayBuffer> {
  const buf = await readFile(join(process.cwd(), "assets/fonts", file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function brandOgImage({ line }: { line: string }): Promise<ImageResponse> {
  const [bricolage800, bricolage500, figtree600] = await Promise.all([
    font("bricolage-800.woff"),
    font("bricolage-500.woff"),
    font("figtree-600.woff"),
  ]);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: BRAND_COLORS.ink,
        padding: 80,
        fontFamily: "Figtree",
      }}
    >
      {/* Logo B2 (C9-4): «AfinIA» 800 en lima, «Jobs» 500 en blanco y el punto de la marca */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          fontFamily: "Bricolage",
          fontSize: 132,
          lineHeight: 1,
          letterSpacing: -4,
        }}
      >
        <span style={{ fontWeight: 800, color: BRAND_COLORS.accent }}>{BRAND.wordmark.strong}</span>
        <span style={{ fontWeight: 500, color: BRAND_COLORS.white }}>{BRAND.wordmark.light}</span>
        <div
          style={{
            width: 26,
            height: 26,
            marginLeft: 8,
            marginBottom: 22,
            borderRadius: 13,
            background: BRAND_COLORS.accent,
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            fontFamily: "Bricolage",
            fontWeight: 800,
            fontSize: 64,
            letterSpacing: -2,
            color: BRAND_COLORS.white,
          }}
        >
          {BRAND.tagline}
        </div>
        <div style={{ fontSize: 34, fontWeight: 600, color: BRAND_COLORS.onInkMuted }}>{line}</div>
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        { name: "Bricolage", data: bricolage800, weight: 800, style: "normal" },
        { name: "Bricolage", data: bricolage500, weight: 500, style: "normal" },
        { name: "Figtree", data: figtree600, weight: 600, style: "normal" },
      ],
    },
  );
}
