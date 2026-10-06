// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { clampSize, useFloatingWindow, useWindowResize } from "../src/hooks/useFloatingWindow";

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

describe("useWindowResize", () => {
  const limits = { minWidth: 300, minHeight: 200, maxWidth: 900 };

  /** A grip whose window (its parent) is `width` × `height`. */
  function gripEvent(overrides: Partial<Record<string, unknown>>, width = 400, height = 300) {
    const parentElement = { getBoundingClientRect: () => ({ width, height }) };
    const currentTarget = {
      parentElement,
      ownerDocument: document,
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      hasPointerCapture: () => true
    };
    return { button: 0, pointerId: 1, clientX: 0, clientY: 0, currentTarget, preventDefault: () => {}, ...overrides } as never;
  }

  it("starts at the given width, as tall as its content", () => {
    const { result } = renderHook(() => useWindowResize(680, limits, { x: 50, y: 50 }));
    expect(result.current.size).toEqual({ width: 680 });
  });

  it("resizes by the pointer's movement, within its limits and the viewport", () => {
    const { result } = renderHook(() => useWindowResize(400, limits, { x: 50, y: 50 }));
    act(() => result.current.gripProps.onPointerDown(gripEvent({ clientX: 450, clientY: 350 })));
    act(() => result.current.gripProps.onPointerMove(gripEvent({ clientX: 550, clientY: 450 })));
    expect(result.current.size).toEqual({ width: 500, height: 400 });
    act(() => result.current.gripProps.onPointerMove(gripEvent({ clientX: 0, clientY: 0 })));
    expect(result.current.size).toEqual({ width: 300, height: 200 });
    act(() => result.current.gripProps.onPointerMove(gripEvent({ clientX: 99999, clientY: 99999 })));
    expect(result.current.size.width).toBe(Math.min(900, window.innerWidth - 50 - 8));
    expect(result.current.size.height).toBe(window.innerHeight - 50 - 8);
  });

  it("remembers a size per storage key, once resized", () => {
    window.localStorage.clear();
    const first = renderHook(() => useWindowResize(400, limits, { x: 50, y: 50 }, "test-window"));
    expect(window.localStorage.getItem("winsize:test-window")).toBeNull();
    act(() => first.result.current.gripProps.onPointerDown(gripEvent({ clientX: 0, clientY: 0 })));
    act(() => first.result.current.gripProps.onPointerMove(gripEvent({ clientX: 120, clientY: 60 })));
    act(() => first.result.current.gripProps.onPointerUp(gripEvent({})));
    first.unmount();
    const second = renderHook(() => useWindowResize(400, limits, { x: 50, y: 50 }, "test-window"));
    expect(second.result.current.size).toEqual({ width: 520, height: 360 });
    const other = renderHook(() => useWindowResize(400, limits, { x: 50, y: 50 }, "another-window"));
    expect(other.result.current.size).toEqual({ width: 400 });
  });
});

describe("clampSize", () => {
  it("never goes below the minimum, even with no room left", () => {
    expect(clampSize({ width: 100, height: 100 }, { minWidth: 300, minHeight: 200 }, { x: 900, y: 700 }, { width: 1000, height: 800 }))
      .toEqual({ width: 300, height: 200 });
  });
});
