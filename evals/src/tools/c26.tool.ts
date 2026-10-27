import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { goldenJobs } from "../golden";
import {
  diagnose,
  formatDiagnosis,
  idsOf,
  makeSplit,
  meanOf,
  metricsOn,
  type ReportLike,
  type SetName,
  type Split,
} from "../split";

/**
 * Herramienta manual de la C-26 (no es un test; no corre en `pnpm test`). Lee el pedido de
 * `ops/rondas/C26-haiku-prompt/tools/in.json` y escribe el resultado en `out.md` de esa carpeta.
 * Solo sale texto con ids, enums y números. Sin llamadas a ninguna API.
 *
 * in.json:
 *   { "cmd": "split", "seed": 26 }
 *   { "cmd": "metrics", "reports": ["archivo.json", ...], "sets": ["dev", "test+adv"] }
 *   { "cmd": "diagnose", "reports": [...], "set": "dev" }
 * Los reportes se dan por nombre de archivo dentro de evals/reports/.
 */
const evalsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const toolDir = resolve(evalsDir, "../ops/rondas/C26-haiku-prompt/tools");
const splitPath = resolve(toolDir, "../split.json");

type Request =
  | { cmd: "split"; seed: number; force?: boolean }
  | {
      cmd: "metrics";
      sets: SetName[];
      /** Un solo grupo (con `label` y `reports`) o varios (`groups`). */
      label?: string;
      reports?: string[];
      groups?: { label: string; reports: string[] }[];
      /** Solo la fila de media por grupo. */
      compact?: boolean;
    }
  | { cmd: "diagnose"; reports: string[]; set: SetName };

const loadReport = (name: string): ReportLike =>
  JSON.parse(readFileSync(resolve(evalsDir, "reports", name), "utf8")) as ReportLike;

const loadSplit = (): Split => JSON.parse(readFileSync(splitPath, "utf8")) as Split;

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const num = (v: number | null) => (v === null ? "n/a" : v.toFixed(2));

it("c26", () => {
  const req = JSON.parse(readFileSync(resolve(toolDir, "in.json"), "utf8")) as Request;
  const out: string[] = [];

  if (req.cmd === "split") {
    if (existsSync(splitPath) && !req.force) {
      out.push(`split.json ya existe: no se pisa (usar "force": true para rehacerlo)`);
    } else {
      const split = makeSplit(
        goldenJobs.map((j) => ({
          id: j.id,
          accion: j.accion,
          human_risks: j.human_risks,
          adversarial: j.adversarial,
        })),
        req.seed,
      );
      writeFileSync(splitPath, JSON.stringify(split, null, 2));
      out.push(
        `split semilla ${split.seed}: dev ${split.dev.length} · test ${split.test.length} · adversariales ${split.adversarial.length}`,
        `dev: ${split.dev.join(",")}`,
        `test: ${split.test.join(",")}`,
        `adversariales: ${split.adversarial.join(",")}`,
      );
      const byId = new Map(goldenJobs.map((j) => [j.id, j]));
      const action = (ids: number[]) => {
        const c: Record<string, number> = {};
        for (const id of ids) c[byId.get(id)!.accion] = (c[byId.get(id)!.accion] ?? 0) + 1;
        return JSON.stringify(c);
      };
      out.push(`acciones dev ${action(split.dev)} · test ${action(split.test)}`);
    }
  } else if (req.cmd === "metrics") {
    const split = loadSplit();
    const groups = req.groups ?? [{ label: req.label ?? "", reports: req.reports ?? [] }];
    for (const set of req.sets) {
      const ids = idsOf(split, set);
      out.push(`## ${set} (${ids.length} casos)`);
      out.push(
        "| grupo / reporte | acción | disciplina | MAE | falsos descartes (modelo/total) | bloq. recall/precisión | riesgos recall | ubic. estricta/final | inyección estricta/laxa | USD |",
        "|---|---|---|---|---|---|---|---|---|---|",
      );
      for (const group of groups) {
        const ms = group.reports.map((name) => {
          const r = loadReport(name);
          const m = metricsOn(r, ids);
          if (!req.compact) {
            out.push(
              `| ${group.label} · ${r.meta.label ?? name} | ${pct(m.action_acc)} | ${pct(m.discipline_acc)} | ${num(m.score_mae)} | ${m.false_discard}/${m.false_discard_total} | ${pct(m.blockers_recall)}/${pct(m.blockers_precision)} | ${pct(m.risks_recall)} | ${pct(m.location_risk_recall)}/${pct(m.location_risk_recall_final)} | ${m.injection_resistance ? `${pct(m.injection_resistance.strict)}/${pct(m.injection_resistance.lax)}` : "n/a"} | ${r.meta.cost_usd ?? "n/a"} |`,
            );
          }
          return m;
        });
        if (ms.length > 1 || req.compact) {
          out.push(
            `| **${group.label}, media de ${ms.length}** | ${pct(meanOf(ms, "action_acc"))} | ${pct(meanOf(ms, "discipline_acc"))} | ${num(meanOf(ms, "score_mae"))} | ${num(meanOf(ms, "false_discard"))}/${num(meanOf(ms, "false_discard_total"))} | ${pct(meanOf(ms, "blockers_recall"))}/${pct(meanOf(ms, "blockers_precision"))} | ${pct(meanOf(ms, "risks_recall"))} | ${pct(meanOf(ms, "location_risk_recall"))}/${pct(meanOf(ms, "location_risk_recall_final"))} | | |`,
          );
        }
      }
      out.push("");
    }
  } else {
    const split = loadSplit();
    const ids = idsOf(split, req.set);
    out.push(`## diagnóstico sobre ${req.set} (${ids.length} casos): ${req.reports.join(", ")}`);
    out.push(...formatDiagnosis(diagnose(req.reports.map(loadReport), ids)));
  }

  writeFileSync(resolve(toolDir, "out.md"), out.join("\n") + "\n");
  console.log(out.join("\n"));
});
