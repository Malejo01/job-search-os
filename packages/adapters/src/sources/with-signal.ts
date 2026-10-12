/**
 * Los adapters no conocen el AbortSignal: se inyecta en cada request a través de fetchImpl.
 * Si el fetch (real o falso) ignora la señal, igual se corta la espera con una carrera.
 */
export function withSignal(fetchImpl: typeof fetch, signal: AbortSignal | undefined): typeof fetch {
  if (!signal) return fetchImpl;
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (signal.aborted) return Promise.reject(new Error("timeout de la fuente"));
    return Promise.race([
      fetchImpl(input, { ...init, signal }),
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("timeout de la fuente")), {
          once: true,
        });
      }),
    ]);
  }) as typeof fetch;
}
