"use client";

import { useMemo, useState, useTransition } from "react";
import { inviteSelectedFromWaitlistAction, type BulkInviteResult } from "./actions";
import { WaitlistRow, type WaitlistRowData } from "./waitlist-row";

const REASON_TEXT = {
  ya_invitada: "ya tenía una invitación",
  no_esta: "ya no está en la lista",
  sin_link: "se creó, pero falta AUTH_URL para armar el link",
  error: "no se pudo crear; probá de nuevo",
} as const;

/**
 * Lista de espera con selección múltiple (C4-2). Cliente solo para las casillas, la confirmación y para
 * mostrar los mensajes de invitación una vez: los links viven en memoria, no en la URL ni en la base.
 */
export function WaitlistPanel({
  entries,
  defaultCap,
  maxCap,
}: {
  entries: WaitlistRowData[];
  defaultCap: number;
  maxCap: number;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [cap, setCap] = useState(String(defaultCap));
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<BulkInviteResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const invitable = useMemo(() => entries.filter((e) => e.invitedLabel === null), [entries]);
  const capNumber = (() => {
    const n = Number(cap);
    return Number.isInteger(n) && n >= 1 ? Math.min(n, maxCap) : defaultCap;
  })();
  const chosen = invitable.filter((e) => selected.has(e.id));
  const overCap = chosen.length > capNumber;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    setConfirming(false);
  }

  function selectFirst() {
    setSelected(new Set(invitable.slice(0, capNumber).map((e) => e.id)));
    setConfirming(false);
  }

  function run() {
    const ids = chosen.map((e) => e.id);
    const names = Object.fromEntries(chosen.map((e) => [e.id, e.name]));
    setConfirming(false);
    startTransition(async () => {
      const res = await inviteSelectedFromWaitlistAction({ ids, cap: capNumber, names });
      setResult(res);
      if (res.status === "done") setSelected(new Set());
    });
  }

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
  }

  const created = result?.status === "done" ? result.items.filter((i) => i.ok) : [];
  const allMessages = created
    .map((i) => (i.ok ? `Para: ${i.email}\n\n${i.message}` : ""))
    .join("\n\n----------\n\n");

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex flex-col gap-3 rounded-card border border-line p-3 text-sm"
        data-testid="waitlist-bulk"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            Tope por tanda (1 a {maxCap})
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={maxCap}
              value={cap}
              onChange={(e) => {
                setCap(e.target.value);
                setConfirming(false);
              }}
              className="w-24 rounded-control border border-line-control bg-surface px-3 py-2 text-base"
            />
          </label>
          <button
            type="button"
            onClick={selectFirst}
            disabled={invitable.length === 0 || pending}
            className="min-h-11 rounded-control border border-line-strong px-3 py-2 disabled:opacity-60"
          >
            Elegir las primeras {Math.min(capNumber, invitable.length)} sin invitar
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(new Set());
              setConfirming(false);
            }}
            disabled={selected.size === 0 || pending}
            className="min-h-11 rounded-control border border-line-strong px-3 py-2 disabled:opacity-60"
          >
            Quitar la selección
          </button>
        </div>
        <p role="status" className="text-fg-muted">
          {chosen.length === 0
            ? "Elegí personas con la casilla de cada fila."
            : `${chosen.length} ${chosen.length === 1 ? "elegida" : "elegidas"}`}
          {overCap ? (
            <span className="text-danger">
              {" "}
              · El tope de esta tanda es {capNumber}: quitá {chosen.length - capNumber}.
            </span>
          ) : null}
        </p>
        {confirming ? (
          <div
            role="alertdialog"
            aria-labelledby="bulk-confirm-title"
            className="flex flex-col gap-2 rounded-control border border-warning-line bg-warning-soft p-3"
          >
            <p id="bulk-confirm-title" className="font-medium text-warning">
              Vas a crear {chosen.length} {chosen.length === 1 ? "invitación" : "invitaciones"},
              cada una atada al email de la persona.
            </p>
            <p className="text-fg-muted">
              No se manda ningún email: después copiás los mensajes y los enviás vos. Los links se
              muestran una sola vez.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={run}
                disabled={pending}
                className="min-h-11 rounded-control bg-brand px-4 py-2 font-medium text-brand-contrast disabled:opacity-60"
              >
                Confirmar e invitar
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="min-h-11 rounded-control border border-line-strong px-4 py-2"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={chosen.length === 0 || overCap || pending}
            className="min-h-11 self-start rounded-control bg-brand px-4 py-2 font-medium text-brand-contrast disabled:opacity-60"
          >
            {pending ? "Creando invitaciones…" : "Invitar a los seleccionados"}
          </button>
        )}
      </div>

      {result?.status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {result.message}
        </p>
      ) : null}
      {result?.status === "done" ? (
        <section
          aria-labelledby="bulk-result-title"
          data-testid="waitlist-bulk-result"
          className="flex flex-col gap-3 rounded-control border border-success-line bg-success-soft p-3 text-sm"
        >
          <h3 id="bulk-result-title" className="font-medium text-success">
            {created.length} {created.length === 1 ? "invitación creada" : "invitaciones creadas"}.
            Copiá los mensajes ahora: los links no se vuelven a mostrar.
          </h3>
          {created.length > 1 ? (
            <button
              type="button"
              onClick={() => void copy("all", allMessages)}
              className="min-h-11 self-start rounded-control border border-line-strong bg-surface px-3 py-2"
            >
              {copied === "all" ? "Copiado" : "Copiar todos los mensajes"}
            </button>
          ) : null}
          <ul className="flex flex-col gap-3">
            {result.items.map((item) => {
              const name = byId.get(item.id)?.name ?? "Persona";
              return item.ok ? (
                <li key={item.id} className="flex flex-col gap-1">
                  <span className="font-medium">
                    {name} · <span className="break-all font-normal">{item.email}</span>
                  </span>
                  <pre className="overflow-x-auto rounded-badge bg-surface p-2 text-xs whitespace-pre-wrap break-words">
                    {item.message}
                  </pre>
                  <button
                    type="button"
                    onClick={() => void copy(item.id, item.message)}
                    className="min-h-11 self-start rounded-control border border-line-strong bg-surface px-3 py-2"
                  >
                    {copied === item.id ? "Copiado" : `Copiar el mensaje de ${name}`}
                  </button>
                </li>
              ) : (
                <li key={item.id} role="alert" className="text-danger">
                  {name}: {REASON_TEXT[item.reason]}.
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-sm text-fg-subtle">Nadie coincide con estos filtros.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line">
          {entries.map((entry) => (
            <WaitlistRow
              key={entry.id}
              entry={entry}
              selection={{
                selected: selected.has(entry.id),
                onChange: (on) => toggle(entry.id, on),
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
