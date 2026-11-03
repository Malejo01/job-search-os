import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BRAND, BRAND_COLORS } from "@job-search-os/pipeline";
import { ImageResponse } from "next/og";
import { MONOGRAM } from "@/components/brand/monogram";

/**
 * Imagen para compartir de la vitrina (C7-2): fondo tinta, monograma y logotipo AfinIA/Jobs, la
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
  const [sora800, sora300, manrope600] = await Promise.all([
    font("sora-800.woff"),
    font("sora-300.woff"),
    font("manrope-600.woff"),
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
        fontFamily: "Manrope",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
        <svg width={150} height={150} viewBox={MONOGRAM.viewBox}>
          <path
            d={MONOGRAM.path}
            fill="none"
            stroke={BRAND_COLORS.accent}
            strokeWidth={MONOGRAM.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx={MONOGRAM.dot.cx}
            cy={MONOGRAM.dot.cy}
            r={MONOGRAM.dot.r}
            fill={BRAND_COLORS.white}
          />
        </svg>
        <div
          style={{
            display: "flex",
            fontFamily: "Sora",
            fontSize: 120,
            lineHeight: 1,
            letterSpacing: -5,
          }}
        >
          <span style={{ fontWeight: 800, color: BRAND_COLORS.accent }}>
            {BRAND.wordmark.strong}
          </span>
          <span style={{ fontWeight: 300, color: BRAND_COLORS.white }}>{BRAND.wordmark.light}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            fontFamily: "Sora",
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
        { name: "Sora", data: sora800, weight: 800, style: "normal" },
        { name: "Sora", data: sora300, weight: 300, style: "normal" },
        { name: "Manrope", data: manrope600, weight: 600, style: "normal" },
      ],
    },
  );
}
