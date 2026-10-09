import { assistantState } from "@/lib/assistant-state";
import { getInboundAddress } from "@/lib/inbound-address";
import { requireUserId } from "@/lib/session";
import { Assistant } from "../../../onboarding/asistente/assistant";

export const dynamic = "force-dynamic";

/** El asistente de reenvío dentro de Ajustes (el gate de onboarding ya corre en el layout de (app)). */
export default async function SettingsAssistantPage() {
  const userId = await requireUserId();
  const address = await getInboundAddress(userId);
  return <Assistant address={address} state={await assistantState(userId, address)} />;
}
