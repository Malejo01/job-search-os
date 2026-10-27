import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * axe con las reglas WCAG 2.0/2.1 A y AA (N3-3). Devuelve las violaciones resumidas y, además, falla
 * si la regla de contraste no midió nada o no pudo leer un color: un `oklch(... none)` de Tailwind
 * dejaba a axe sin medir el contraste de ninguna pantalla y los specs pasaban en verde igual.
 */
export async function axeSummary(
  page: Page,
): Promise<{ violations: string[]; unmeasured: string[] }> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = result.violations.map(
    (v) =>
      `${v.id} (${v.impact ?? "sin impacto"}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  const contrastPasses = result.passes.find((r) => r.id === "color-contrast")?.nodes.length ?? 0;
  const unparsed = (result.incomplete.find((r) => r.id === "color-contrast")?.nodes ?? []).filter(
    (n) =>
      n.any.some(
        (c) =>
          (c.data as { messageKey?: string } | null)?.messageKey === "colorParse" ||
          /could not parse/i.test(c.message),
      ),
  );
  const unmeasured = [
    ...(contrastPasses === 0 ? ["color-contrast: ningún nodo medido"] : []),
    ...unparsed.map((n) => `color sin leer: ${n.target.join(" ")}`),
  ];
  return { violations, unmeasured };
}
