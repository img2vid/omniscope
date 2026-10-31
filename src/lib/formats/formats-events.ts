/**
 * FORMAT REGISTRY CHANGE EVENTS
 * Tiny dependency-free pub/sub so the stats/explorer layers can recompute
 * when lazily-loaded format expansions register at runtime.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onFormatsChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitFormatsChanged(): void {
  for (const fn of listeners) fn();
}
