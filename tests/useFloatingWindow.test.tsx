// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFloatingWindow } from "../src/hooks/useFloatingWindow";

/** Minimal stand-in for a React PointerEvent on the title bar. */
function pointerEvent(overrides: Partial<Record<string, unknown>> = {}) {
  const target = document.createElement("div");
  const currentTarget = {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => true
  };
  return { button: 0, pointerId: 1, clientX: 0, clientY: 0, target, currentTarget, ...overrides } as never;
}

describe("useFloatingWindow", () => {
  it("starts at the given position and toggles minimize", () => {
    const { result } = renderHook(() => useFloatingWindow({ x: 100, y: 50 }));
    expect(result.current.position).toEqual({ x: 100, y: 50 });
    expect(result.current.minimized).toBe(false);
    act(() => result.current.toggleMinimize());
    expect(result.current.minimized).toBe(true);
  });

  it("moves by the pointer delta while dragging the title bar", () => {
    const { result } = renderHook(() => useFloatingWindow({ x: 200, y: 120 }));
    act(() => result.current.titleBarProps.onPointerDown(pointerEvent({ clientX: 210, clientY: 130 })));
    act(() => result.current.titleBarProps.onPointerMove(pointerEvent({ clientX: 260, clientY: 200 })));
    // delta (50, 70) from the grab offset
    expect(result.current.position).toEqual({ x: 250, y: 190 });
  });

  it("clamps the window inside the viewport", () => {
    const { result } = renderHook(() => useFloatingWindow({ x: 10, y: 10 }));
    act(() => result.current.titleBarProps.onPointerDown(pointerEvent({ clientX: 10, clientY: 10 })));
    act(() => result.current.titleBarProps.onPointerMove(pointerEvent({ clientX: -500, clientY: -500 })));
    expect(result.current.position).toEqual({ x: 8, y: 0 });
    act(() => result.current.titleBarProps.onPointerMove(pointerEvent({ clientX: 99999, clientY: 99999 })));
    expect(result.current.position.x).toBe(window.innerWidth - 120);
    expect(result.current.position.y).toBe(window.innerHeight - 44);
  });

  it("ignores drags that start on a title-bar button", () => {
    const { result } = renderHook(() => useFloatingWindow({ x: 200, y: 120 }));
    const button = document.createElement("button");
    act(() => result.current.titleBarProps.onPointerDown(pointerEvent({ target: button, clientX: 210, clientY: 130 })));
    act(() => result.current.titleBarProps.onPointerMove(pointerEvent({ clientX: 400, clientY: 400 })));
    expect(result.current.position).toEqual({ x: 200, y: 120 });
  });

  it("stops moving after pointer up", () => {
    const { result } = renderHook(() => useFloatingWindow({ x: 200, y: 120 }));
    act(() => result.current.titleBarProps.onPointerDown(pointerEvent({ clientX: 200, clientY: 120 })));
    act(() => result.current.titleBarProps.onPointerUp(pointerEvent()));
    act(() => result.current.titleBarProps.onPointerMove(pointerEvent({ clientX: 500, clientY: 500 })));
    expect(result.current.position).toEqual({ x: 200, y: 120 });
  });
});
