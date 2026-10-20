import { EmailNudge as SharedEmailNudge } from "@/app/components/email-nudge";

/** Aviso de /jobs: el componente compartido con los textos de esta pantalla. */
export function EmailNudge({ userId }: { userId: string }) {
  return (
    <SharedEmailNudge
      userId={userId}
      title="¿Recibís alertas de empleo por email?"
      cta="Sumalas en 3 pasos"
    />
  );
}
