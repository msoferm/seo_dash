import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Deep-link support: when the URL has `?focus=<id>`, scroll to the element marked
 * `data-focus="<id>"` and flash it. `ready` = the tab's data has loaded; `onFocus` lets the
 * tab first clear filters / open folders so the target element is actually rendered.
 */
export function useFocusTarget(ready: boolean, onFocus?: (focus: string) => void): string | null {
  const [params] = useSearchParams();
  const focus = params.get("focus");
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!focus || !ready || handled.current === focus) return;
    handled.current = focus;
    onFocus?.(focus);
    let tries = 0;
    const tick = () => {
      const el = document.querySelector(`[data-focus="${CSS.escape(focus)}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("focus-flash");
        setTimeout(() => el.classList.remove("focus-flash"), 2800);
      } else if (tries++ < 20) setTimeout(tick, 150);
    };
    setTimeout(tick, 80);
  }, [focus, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return focus;
}
