/**
 * A spell's colour by its element (the damage it deals) or, with none, its school: the hotbar's own
 * (HOTBAR_REDESIGN_PLAN.md D3, play.module.css), so a spell is the same colour in the builder and in play.
 */
export const TONE_COLORS: Record<string, string> = {
  acid: "#c3d83a",
  cold: "#8fdcff",
  fire: "#ff8a3d",
  force: "#e46fd8",
  lightning: "#4f86ff",
  necrotic: "#5f9a72",
  poison: "#74c04a",
  psychic: "#c48aff",
  radiant: "#f2dc6a",
  thunder: "#9d9bff",
  physical: "#b4bcc8",
  healing: "#7ee08a",
  abjuration: "#6fa8ff",
  conjuration: "#45c6cf",
  divination: "#b9c4d4",
  enchantment: "#ff8fc8",
  evocation: "#ff9f4a",
  illusion: "#a98bff",
  necromancy: "#6f9f6a",
  transmutation: "#d9a35a"
};

export const toneColor = (tone: string | undefined): string | undefined => (tone ? TONE_COLORS[tone] : undefined);
