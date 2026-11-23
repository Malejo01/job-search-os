import { notFound } from "next/navigation";
import { CvCoachChat } from "@/components/cv-coach/chat";
import { cvCoachAllowedFor } from "@/lib/cv-coach/access";
import { requireActiveUserId } from "@/lib/session";
import { voiceServerAllowedFor } from "@/lib/voice/server";

export const metadata = { title: "Mejoremos tu CV" };
export const dynamic = "force-dynamic";
// Cada turno llama al modelo: el límite de la ruta de la API es el que manda
export const maxDuration = 60;

/**
 * Charla del coach de CV (ADR-038 §5, R12-10). Server Component: con el flag apagado responde 404. La charla
 * vive en el componente de cliente y no se guarda: solo queda lo que la persona confirma, tarjeta por tarjeta.
 */
export default async function CvCoachChatPage() {
  const userId = await requireActiveUserId();
  if (!(await cvCoachAllowedFor(userId))) notFound();
  const serverTranscribe = await voiceServerAllowedFor(userId);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="text-title font-bold">Mejoremos tu CV</h1>
      <p className="text-sm text-fg-muted">
        Te pregunto de a una cosa, sobre lo que le falta a tu CV. Podés responder «No tengo» o
        cortar cuando quieras con «Ya está, armalo». Nada cambia en tu perfil hasta que confirmes
        cada tarjeta.
      </p>
      <CvCoachChat serverTranscribe={serverTranscribe} />
    </div>
  );
}
