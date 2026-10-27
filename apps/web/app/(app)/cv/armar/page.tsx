import { notFound } from "next/navigation";
import { cvChatAllowed } from "@/lib/cv-chat-server";
import { requireActiveUserId } from "@/lib/session";
import { CvChat } from "./chat";

export const metadata = { title: "Armá tu CV con IA" };
export const dynamic = "force-dynamic";

/**
 * Armá tu CV con IA (C-25, CVC-5). Server Component: chequea sesión y el gate `CV_CHAT_ENABLED` (apagado
 * = 404, como si la página no existiera) y deja el chat en un componente de cliente. La charla no se
 * guarda; lo único que persiste es lo que la persona confirma al final.
 */
export default async function ArmarCvPage() {
  const userId = await requireActiveUserId();
  if (!(await cvChatAllowed(userId))) notFound();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Armá tu CV con IA</h1>
      <CvChat />
    </div>
  );
}
