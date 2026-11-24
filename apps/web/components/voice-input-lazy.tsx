"use client";

import dynamic from "next/dynamic";
import type { VoiceInputProps } from "@/components/voice-input";

/**
 * `VoiceInput` cargado aparte (R25-02b): el hook, la sesión y el motor de voz no entran al First Load de las
 * pantallas con chat; llegan justo después de hidratar. Mismas props que `VoiceInput`. El espacio queda reservado
 * (44 px) para que no salte el layout.
 */
export const VoiceInput = dynamic<VoiceInputProps>(
  () => import("@/components/voice-input").then((m) => m.VoiceInput),
  { ssr: false, loading: () => <div aria-hidden="true" className="min-h-11" /> },
);
