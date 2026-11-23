import Link from "next/link";
import { FullScreenState } from "@/components/full-screen-state";
import { buttonClasses } from "@/components/ui";
import { INTERVIEW_TEXTOS } from "@/lib/textos-rediseno";

export const metadata = { title: "Simulación no encontrada" };

/**
 * Simulación inexistente, borrada, ajena o con un id mal escrito (R23-08): queda dentro del layout de la app y
 * ofrece volver a Interview. No distingue «ajena» de «inexistente».
 */
export default function InterviewNotFound() {
  const t = INTERVIEW_TEXTOS.noEncontrada;
  return (
    <FullScreenState
      title={t.title}
      actions={
        <Link href="/interview" className={buttonClasses()}>
          {t.action}
        </Link>
      }
    >
      <p>{t.text}</p>
    </FullScreenState>
  );
}
