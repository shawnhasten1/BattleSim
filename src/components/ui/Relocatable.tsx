"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * A DOM node to portal a subtree into once, so it stays mounted (an ability being edited keeps its draft) while the node
 * moves between frames: a floating window in the page, or a popped-out browser window. React listens for events on a
 * portal's container itself, so they keep arriving wherever the node goes. Null on the server.
 */
export function useRelocatable(className?: string): HTMLDivElement | null {
  const [node] = useState(() => (typeof document === "undefined" ? null : document.createElement("div")));
  if (node && className !== undefined && node.className !== className) node.className = className;
  return node;
}

/** Where a relocatable node sits in a frame: it's moved in as the frame mounts (from wherever it was). */
export function RelocatableSlot({ node, className }: { node: HTMLElement | null; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const slot = ref.current;
    if (slot && node && node.parentNode !== slot) slot.appendChild(node);
  });
  return <div ref={ref} className={className} />;
}
