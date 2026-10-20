import { ImageResponse } from "next/og";

/** Imagen para compartir (ronda 63): la propuesta de valor, sin nombre ni logos. */
export const alt = "Leemos cada oferta contra tu perfil y te decimos por qué sí y por qué no";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
        Leemos cada oferta contra tu perfil y te decimos por qué sí y por qué no.
      </div>
      <div style={{ fontSize: 34, marginTop: 40, color: "#d4d4d8" }}>
        Nunca postula por vos. Vos decidís.
      </div>
    </div>,
    size,
  );
}
