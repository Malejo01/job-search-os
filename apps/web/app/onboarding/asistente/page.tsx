import { redirect } from "next/navigation";
import { getInboundAddress } from "@/lib/inbound-address";
import { isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { Assistant } from "./assistant";

export const dynamic = "force-dynamic";

/** Paso 2 del onboarding: conectar el reenvío de Gmail. Sin perfil completo vuelve al paso 1. */
export default async function OnboardingAssistantPage() {
  const userId = await requireUserId();
  if (!(await isOnboardingComplete(userId))) redirect("/onboarding");
  return <Assistant address={await getInboundAddress(userId)} userId={userId} />;
}
