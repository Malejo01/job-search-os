import { ASSISTANT_STEPS, type AssistantStep } from "@job-search-os/pipeline";
import Link from "next/link";
import { AutoRefresh } from "@/app/(app)/jobs/auto-refresh";
import type { AssistantState } from "@/lib/assistant-state";
import { confirmedForwardingAction, filtersImportedAction } from "./actions";
import { CopyButton } from "./copy-button";

const LEGACY_NOTICE =
  "Tu dirección es de un formato anterior: generá una nueva en Ajustes › Email entrante antes de configurar Gmail.";

const GMAIL_FORWARDING_URL = "https://mail.google.com/mail/u/0/#settings/fwdandpop";

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
export function Assistant({ address, state }: { address: string | null; state: AssistantState }) {
  const { step } = state;
  const legacy = step === "direccion_vieja";
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Conectá tus alertas de empleo</h1>
      <p className="text-sm text-zinc-700">
        Reenviá las alertas de LinkedIn, Get on Board e Indeed a tu dirección personal y se cargan
        solas. No la compartas.
      </p>
      {legacy ? (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {LEGACY_NOTICE}{" "}
          <Link href="/settings" className="underline">
            Ir a Ajustes
          </Link>
        </p>
      ) : null}
      {address ? (
        <div className="flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-2">
          <p className="min-w-0 flex-1 font-mono text-sm break-all select-all">
            <span data-testid="assistant-address">{address}</span>
          </p>
          <CopyButton text={address} />
        </div>
      ) : (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Todavía no tenés una dirección de reenvío. Generá una en Ajustes.
        </p>
      )}

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
                className={view === "current" ? "text-base font-semibold text-zinc-900" : "text-sm"}
              >
                {view === "done" ? <span aria-hidden="true">✓ </span> : null}
                Paso {i + 1}: {STEP_TITLES[id]}
                <span className="sr-only">
                  {view === "done" ? " (hecho)" : view === "current" ? " (actual)" : " (pendiente)"}
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

      {/* Pasos que avanzan solos por algo que llega por email: el pedido de Gmail y la primera alerta */}
      <AutoRefresh
        active={step === "agregar_direccion" || step === "esperando_alerta"}
        everyMs={15000}
        maxMs={30 * 60 * 1000}
      />

      <div className="flex justify-end">
        <Link
          href="/jobs"
          className="rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white"
        >
          {step === "listo" ? "Ir a mis avisos" : "Lo hago después"}
        </Link>
      </div>
    </section>
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
        <p>{LEGACY_NOTICE}</p>
      ) : (
        <>
          <p>
            Abrí{" "}
            <a
              href={GMAIL_FORWARDING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Gmail › Reenvío y correo POP/IMAP
            </a>
            . Tocá «Añadir una dirección de reenvío», pegá la dirección de arriba, tocá «Siguiente»
            y después «Continuar».
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
            En Gmail: Configuración › Ver todos los ajustes › Filtros y direcciones bloqueadas ›
            Importar filtros → elegí el archivo → Abrir archivo → Crear filtros. No marques «Aplicar
            también a las conversaciones existentes».
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
