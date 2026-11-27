import { cvChatDraftHasContent } from "@job-search-os/pipeline";
import { notFound } from "next/navigation";
import { AfiDice } from "@/components/afi-dice";
import { cvChatAllowed } from "@/lib/cv-chat-server";
import { loadChatDraft } from "@/lib/cv-draft";
import { AFI_DICE } from "@/lib/textos-rediseno";
import { requireActiveUserId } from "@/lib/session";
import { voiceServerAllowedFor } from "@/lib/voice/server";
import { CvChat } from "./chat";

export const metadata = { title: "Armá tu CV con IA" };
export const dynamic = "force-dynamic";

/**
 * Armá tu CV con IA (C-25, CVC-5). Server Component: chequea sesión y el gate `CV_CHAT_ENABLED` (apagado
 * = 404, como si la página no existiera) y deja el chat en un componente de cliente. Lo que la persona
 * responde se guarda como borrador mientras avanza (R33-02); al CV solo entra lo que confirma al final.
 */
export default async function ArmarCvPage() {
  const userId = await requireActiveUserId();
  if (!(await cvChatAllowed(userId))) notFound();
  const serverTranscribe = await voiceServerAllowedFor(userId);
  // R33-02: ¿hay un borrador para retomar? Sin la tabla (migración sin aplicar) o con un error, la página sigue sin él
  const draft = await loadChatDraft(userId).catch(() => null);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="text-title font-bold">Armá tu CV con IA</h1>
      <AfiDice pose="explicando" priority texto={AFI_DICE.cvArmar} testId="afi-dice-cv-armar" />
      <CvChat
        serverTranscribe={serverTranscribe}
        hasDraft={!!draft && cvChatDraftHasContent(draft.state)}
      />
    </div>
  );
}
