import {
  ASSISTANT_STEPS,
  GMAIL_FILTERS_URL,
  GMAIL_FORWARDING_PATH,
  type AssistantStep,
  type PortalStatsRow,
} from "@job-search-os/pipeline";
import { cookies } from "next/headers";
import Link from "next/link";
import { AutoRefresh } from "@/app/(app)/jobs/auto-refresh";
import { PRIVACY_OK_COOKIE, TrustBox } from "@/app/components/trust-box";
import type { AssistantState } from "@/lib/assistant-state";
import { requireUserId } from "@/lib/session";
import {
  confirmedForwardingAction,
  filtersImportedAction,
  privacyAcknowledgedAction,
} from "./actions";
import { AlertEmail } from "./alert-email";
import { AlertGuide, type AlertGuideProps } from "./alert-guide";
import { CopyButton } from "./copy-button";
import { PortalStats } from "./portal-stats";
import { PrivacyDialog } from "./privacy-dialog";

const STEP_TITLES: Record<(typeof ASSISTANT_STEPS)[number], string> = {
  agregar_direccion: "Agregá la dirección de reenvío",
  confirmar_reenvio: "Confirmá el reenvío",
  importar_filtros: "Importá los filtros",
  esperando_alerta: "Esperá tu primera alerta",
  listo: "Listo",
};

type StepView = "done" | "current" | "next";

/** La dirección vieja bloquea el paso 1: se muestra como ese paso, con el aviso. */
function viewOf(step: (typeof ASSISTANT_STEPS)[number], current: AssistantStep): StepView {
  const at = ASSISTANT_STEPS.indexOf(step);
  const now = ASSISTANT_STEPS.indexOf(
    current === "direccion_vieja" ? "agregar_direccion" : current,
  );
  return at < now ? "done" : at === now ? "current" : "next";
}

/**
 * Asistente de reenvío con el paso actual (compartido por el onboarding y Ajustes): la dirección y
 * cinco pasos que avanzan solos según lo que llegó. Todo es texto y links: el servidor no abre
 * ningún link (D-028); el de la confirmación de Gmail lo abre el navegador de la persona.
 */
export function Assistant({
  address,
  state,
  context = "settings",
  guide,
  portalStats,
}: {
  address: string | null;
  state: AssistantState;
  /** Datos de «Qué alertas crear» (carreras, idioma y estado de cada portal). */
  guide?: AlertGuideProps;
  /** «Qué portal te sirve»: solo en Ajustes (no en el onboarding). */
  portalStats?: PortalStatsRow[];
  /** `onboarding`: paso opcional después de «Tus primeras ofertas». `settings`: dentro de Ajustes. */
  context?: "onboarding" | "settings";
}) {
  const { step } = state;
  const legacy = step === "direccion_vieja";
  const inOnboarding = context === "onboarding";
  // Gmail ya empezado: cualquier paso distinto del inicial (tampoco se cierra solo al llegar a «listo»)
  const gmailInProgress = step !== "agregar_direccion" && step !== "direccion_vieja";
  return (
    <section className="flex flex-col gap-4">
      {inOnboarding ? (
        <p className="text-sm font-medium text-zinc-600">Opcional · Conectar alertas</p>
      ) : null}
      <h1 className="text-xl font-semibold">Conectá tus alertas de email (opcional)</h1>
      <p className="text-sm text-zinc-700">Ya tenés ofertas de las fuentes públicas.</p>
      <AlertEmail address={address} legacy={legacy} />

      {guide ? <AlertGuide {...guide} /> : null}

      {/* Reenvío desde Gmail: fuera del camino principal; abierto si la persona ya lo había empezado */}
      <details
        data-testid="gmail-option"
        open={gmailInProgress}
        className="rounded-md border border-zinc-200 px-3 py-1"
      >
        <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900">
          Otra opción: reenviar desde Gmail
        </summary>
        <div className="flex flex-col gap-4 py-3">
          <p role="note" className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
            Por ahora este asistente es solo para Gmail. Si usás otro correo (Outlook, Hotmail,
            Yahoo), reenviá a mano las alertas a tu dirección de la app.
          </p>
          <p className="text-sm text-zinc-700">
            Si además recibís alertas de LinkedIn, Get on Board, Indeed u otro portal en tu Gmail,
            podés reenviarlas a tu dirección personal y se cargan solas. No la compartas.
          </p>
          {address ? (
            <div className="flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-2">
              <p className="min-w-0 flex-1 font-mono text-sm break-all select-all">{address}</p>
              <CopyButton text={address} />
            </div>
          ) : null}

          <ol className="flex list-none flex-col gap-2 p-0 text-sm" aria-label="Pasos">
            {ASSISTANT_STEPS.map((id, i) => {
              const view = viewOf(id, step);
              return (
                <li
                  key={id}
                  data-testid={`assistant-step-${id}`}
                  aria-current={view === "current" ? "step" : undefined}
                  className={
                    view === "current"
                      ? "rounded-md border border-zinc-900 bg-white px-3 py-2"
                      : view === "done"
                        ? "px-3 py-1 text-zinc-600"
                        : "px-3 py-1 text-zinc-500"
                  }
                >
                  <h2
                    className={
                      view === "current" ? "text-base font-semibold text-zinc-900" : "text-sm"
                    }
                  >
                    {view === "done" ? <span aria-hidden="true">✓ </span> : null}
                    Gmail, paso {i + 1}: {STEP_TITLES[id]}
                    <span className="sr-only">
                      {view === "done"
                        ? " (hecho)"
                        : view === "current"
                          ? " (actual)"
                          : " (pendiente)"}
                    </span>
                  </h2>
                  {view === "current" ? (
                    <div className="mt-2 flex flex-col gap-2 text-zinc-700">
                      <StepBody step={id} state={state} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      </details>

      {portalStats ? <PortalStats rows={portalStats} /> : null}

      {/* Pasos que avanzan solos por algo que llega por email: el pedido de Gmail y la primera alerta */}
      <AutoRefresh
        active={step === "agregar_direccion" || step === "esperando_alerta"}
        everyMs={15000}
        maxMs={30 * 60 * 1000}
      />

      <PrivacyModal />

      <div className="flex flex-wrap items-center justify-end gap-3">
        {inOnboarding ? (
          <Link
            href="/onboarding/ofertas"
            className="rounded-md border border-zinc-300 px-4 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
          >
            Volver a Tus primeras ofertas
          </Link>
        ) : null}
        <Link
          href="/jobs"
          className="rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          {step === "listo" ? "Ir a mis ofertas" : "Lo hago después"}
        </Link>
      </div>
    </section>
  );
}

/** Modal de privacidad: se abre solo si la persona no dijo «Entiendo y continúo»; el link lo reabre. */
async function PrivacyModal() {
  const userId = await requireUserId();
  const jar = await cookies();
  return (
    <PrivacyDialog
      initiallyOpen={jar.get(PRIVACY_OK_COOKIE)?.value !== userId}
      acknowledge={privacyAcknowledgedAction}
    >
      <TrustBox />
    </PrivacyDialog>
  );
}

function StepBody({
  step,
  state,
}: {
  step: (typeof ASSISTANT_STEPS)[number];
  state: AssistantState;
}) {
  const { confirmation, step: current } = state;
  switch (step) {
    case "agregar_direccion":
      return current === "direccion_vieja" ? (
        <p>Primero generá una dirección nueva: mirá el aviso de arriba.</p>
      ) : (
        <>
          <p>
            En Gmail, abrí <span className="font-medium">{GMAIL_FORWARDING_PATH}</span>. Tocá
            «Añadir una dirección de reenvío», pegá la dirección de arriba, tocá «Siguiente» y
            después «Continuar».
          </p>
          <p>
            Gmail te manda un pedido de confirmación a esa dirección. Esta pantalla lo detecta y
            pasa al paso siguiente.
          </p>
        </>
      );
    case "confirmar_reenvio":
      return (
        <>
          <p>Gmail mandó el pedido de confirmación a tu dirección.</p>
          <p>
            {confirmation?.requester ? (
              <>
                Lo pidió <span className="font-medium">{confirmation.requester}</span>. Confirmá
                solo si es tu cuenta de Gmail.
              </>
            ) : (
              "Confirmá solo si vos pediste este reenvío."
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {confirmation?.link ? (
              <a
                href={confirmation.link}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-blue-700 px-3 py-1.5 font-medium text-white"
              >
                Confirmar reenvío
              </a>
            ) : confirmation ? (
              <>
                <span>Abrí el email para confirmarlo.</span>
                <Link href={`/inbox/${confirmation.id}`} className="text-blue-700 underline">
                  Abrir el email
                </Link>
              </>
            ) : null}
            {confirmation ? (
              <form action={confirmedForwardingAction}>
                <input type="hidden" name="id" value={confirmation.id} />
                <button
                  type="submit"
                  className="rounded border border-zinc-300 bg-white px-3 py-1.5"
                >
                  Ya lo confirmé
                </button>
              </form>
            ) : null}
          </div>
        </>
      );
    case "importar_filtros":
      return (
        <>
          <p>
            <a href="/api/gmail-filters" download className="underline">
              Descargar filtros-job-search-os.xml
            </a>
          </p>
          <p>
            En Gmail, abrí{" "}
            <a
              href={GMAIL_FILTERS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Filtros y direcciones bloqueadas
            </a>{" "}
            › Importar filtros → elegí el archivo → Abrir archivo → Crear filtros. No marques
            «Aplicar también a las conversaciones existentes».
          </p>
          <p>
            El filtro reenvía todo lo que llega de esos remitentes (también avisos de cuenta de esas
            plataformas): los avisos de inicio de sesión o códigos se descartan en la app sin
            guardarse, y en Gmail quedan en Todos los mensajes.
          </p>
          <form action={filtersImportedAction}>
            <button type="submit" className="rounded border border-zinc-300 bg-white px-3 py-1.5">
              Ya importé los filtros
            </button>
          </form>
        </>
      );
    case "esperando_alerta":
      return (
        <p>
          Cuando LinkedIn, Get on Board o Indeed te manden una alerta, aparece acá. Para probar ya:
          reenviá a mano una alerta que tengas a tu dirección. Esta pantalla se actualiza sola.
        </p>
      );
    case "listo":
      return (
        <>
          <p className="font-medium text-green-800">✓ Primera alerta recibida</p>
          <p>
            <Link href="/jobs" className="underline">
              Ver mis avisos
            </Link>{" "}
            ·{" "}
            <Link href="/inbox" className="underline">
              Ver la bandeja
            </Link>
          </p>
        </>
      );
  }
}
