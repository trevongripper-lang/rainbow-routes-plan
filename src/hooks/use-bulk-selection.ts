import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Generic multi-select helper.
 * - toggle(id): flip a single row
 * - toggleRange(id, orderedIds): shift-click style range from the last clicked id
 * - selectAll/clear/isSelected
 */
export function useBulkSelection<T extends string>() {
  const [selected, setSelected] = useState<Set<T>>(() => new Set());
  const lastClicked = useRef<T | null>(null);

  const toggle = useCallback((id: T) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastClicked.current = id;
  }, []);

  const toggleRange = useCallback((id: T, orderedIds: T[]) => {
    const anchor = lastClicked.current;
    if (!anchor || anchor === id) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastClicked.current = id;
      return;
    }
    const a = orderedIds.indexOf(anchor);
    const b = orderedIds.indexOf(id);
    if (a === -1 || b === -1) {
      toggle(id);
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelected((prev) => {
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) next.add(orderedIds[i]);
      return next;
    });
    lastClicked.current = id;
  }, [toggle]);

  const selectAll = useCallback((ids: T[]) => {
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    lastClicked.current = null;
  }, []);

  const isSelected = useCallback((id: T) => selected.has(id), [selected]);

  const count = selected.size;
  const ids = useMemo(() => Array.from(selected), [selected]);

  return { selected, ids, count, toggle, toggleRange, selectAll, clear, isSelected };
}
