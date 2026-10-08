"use client";

import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { CODEX_PALETTES, type CodexPaletteId } from "@/lib/actor-sheet/codex";
import { codexBody, codexDisplay } from "./fonts";
import ui from "./codex-ui.module.css";

const FACES = `${codexDisplay.variable} ${codexBody.variable}`;

type RootProps = HTMLAttributes<HTMLDivElement> & {
  palette: CodexPaletteId;
  /**
   * The same element, without the Codex: what's in it keeps its state when a window switches between the Codex and
   * Standard (the builder's open spell grids, CHARACTER_BUILDER_UX_PLAN.md §7).
   */
  plain?: boolean;
  children?: ReactNode;
};

/**
 * The Codex's root (CHARACTER_BUILDER_UX_PLAN.md D16): the palette's tokens, the app's `--ui-*` tokens pointed at them
 * (so Standard's pieces hosted inside take the palette), its two faces, and the dotted page. The sheet and the builder
 * both sit in one. Its container is named `codex`, for the pieces' narrower layouts.
 */
export const CodexRoot = forwardRef<HTMLDivElement, RootProps>(function CodexRoot({ palette, plain, className, style, children, ...rest }, ref) {
  const theme = CODEX_PALETTES[palette];
  if (plain) return <div ref={ref} {...rest} className={className} style={style}>{children}</div>;
  return (
    <div
      ref={ref}
      {...rest}
      className={[ui.root, FACES, className].filter(Boolean).join(" ")}
      data-palette={palette}
      data-dark={theme.dark}
      style={{ ...(theme.tokens as CSSProperties), ...style }}
    >
      {children}
    </div>
  );
});

/**
 * What a piece portalled out of a Codex root needs to look like it's still in one (a rules card in the page's body):
 * the palette's tokens, the remap and the faces.
 */
export function codexPortalProps(palette: CodexPaletteId): { className: string; style: CSSProperties; "data-dark": boolean } {
  const theme = CODEX_PALETTES[palette];
  return { className: `${ui.portalled} ${FACES}`, style: theme.tokens as CSSProperties, "data-dark": theme.dark };
}
