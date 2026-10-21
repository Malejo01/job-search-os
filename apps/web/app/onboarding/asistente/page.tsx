import { redirect } from "next/navigation";
import { alertGuideData } from "@/lib/alert-guide-data";
import { assistantState } from "@/lib/assistant-state";
import { getInboundAddress } from "@/lib/inbound-address";
import { isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { Assistant } from "./assistant";

export const metadata = { title: "Reenvío de emails" };
export const dynamic = "force-dynamic";

/**
 * Paso opcional y posterior del onboarding (después de «Tus primeras ofertas»): conectar el
 * reenvío de Gmail. Sin perfil completo vuelve al paso 1.
 */
export default async function OnboardingAssistantPage() {
  const userId = await requireUserId();
  if (!(await isOnboardingComplete(userId))) redirect("/onboarding");
  const address = await getInboundAddress(userId);
  return (
    <Assistant
      address={address}
      state={await assistantState(userId, address)}
      context="onboarding"
      guide={await alertGuideData(userId)}
    />
  );
}
