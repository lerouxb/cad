import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface Size {
  width: number;
  height: number;
}

/** Observe an element's CSS size. Returns a ref and the latest size. */
export function useElementSize<T extends Element>(): [RefObject<T | null>, Size] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
