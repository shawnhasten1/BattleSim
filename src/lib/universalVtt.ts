import { z } from "zod";
import type { Point, WallSegment } from "@/engine";
import { squaresInBounds, MAX_SQUARES, MIN_SQUARES, type GridFit } from "@/lib/gridInference";
import { getImageDimensions, type ImagePixelSize, type MapImageFile } from "@/lib/imageResize";

/**
 * Universal VTT files: `.dd2vtt` (Dungeondraft), `.uvtt`, `.df2vtt` (DungeonFog). A battlemap
 * image with its grid, walls and doors, the walls in grid squares from `map_origin`. Only what
 * the simulator uses is read: the grid, the walls (`line_of_sight`, and `objects_line_of_sight`
 * for pillars and the like), the doors (`portals`) and the image. Lights are left out.
 */

export const UNIVERSAL_VTT_EXTENSIONS = [".dd2vtt", ".uvtt", ".df2vtt"] as const;

export function isUniversalVttFile(name: string): boolean {
  const lower = name.toLowerCase();
  return UNIVERSAL_VTT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const universalVttSchema = z.object({
  resolution: z.object({
    map_origin: pointSchema.optional(),
    map_size: pointSchema,
    pixels_per_grid: z.number().positive()
  }),
  line_of_sight: z.array(z.array(pointSchema)).optional(),
  objects_line_of_sight: z.array(z.array(pointSchema)).optional(),
  portals: z.array(z.object({ bounds: z.array(pointSchema).min(2), closed: z.boolean().optional() })).optional(),
  image: z.string().min(1)
});

export interface UniversalVttMap {
  /** The map image, as a data URL. */
  dataUrl: string;
  /** The image's size, from the grid: columns × px per square. */
  size: ImagePixelSize;
  fit: GridFit;
  /** Its walls and doors, in grid squares; doors are walls with a `doorState`. */
  walls: WallSegment[];
  doors: number;
}

/** Points a polyline can lose (within 2% of a square) without changing its shape: straight runs become one wall. */
const SIMPLIFY_SQUARES = 0.02;

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker: the fewest points that keep a polyline within `tolerance` of itself. */
export function simplifyPolyline(points: Point[], tolerance = SIMPLIFY_SQUARES): Point[] {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let farthest = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i], first, last);
    if (distance > farthest) {
      farthest = distance;
      index = i;
    }
  }
  if (farthest <= tolerance) return [first, last];
  return [...simplifyPolyline(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplifyPolyline(points.slice(index), tolerance)];
}

/** The image's media type from the first bytes of its base64. */
function imageDataUrl(image: string): string {
  if (image.startsWith("data:image/")) return image;
  const type = image.startsWith("/9j/") ? "jpeg" : image.startsWith("UklGR") ? "webp" : "png";
  return `data:image/${type};base64,${image}`;
}

/** A Universal VTT file's map, or why it can't be used. */
export function parseUniversalVtt(raw: unknown): UniversalVttMap | { error: string } {
  const parsed = universalVttSchema.safeParse(raw);
  if (!parsed.success) return { error: "This isn't a Universal VTT map: it has no grid or no image." };
  const { resolution, image } = parsed.data;
  const fit: GridFit = {
    columns: Math.round(resolution.map_size.x),
    rows: Math.round(resolution.map_size.y),
    pxPerSquare: resolution.pixels_per_grid
  };
  if (!squaresInBounds(fit)) {
    return { error: `This map is ${fit.columns} × ${fit.rows} squares; a map can be ${MIN_SQUARES}–${MAX_SQUARES} squares a side.` };
  }

  const origin = resolution.map_origin ?? { x: 0, y: 0 };
  const toGrid = (point: Point): Point => ({ x: point.x - origin.x, y: point.y - origin.y });
  const walls: WallSegment[] = [];
  const addWall = (start: Point, end: Point, doorState?: WallSegment["doorState"]) => {
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-6) return;
    walls.push({
      id: `uvtt-wall-${walls.length + 1}`,
      start,
      end,
      blocksMovement: true,
      blocksSight: true,
      blocksProjectiles: true,
      cover: "total",
      ...(doorState ? { doorState } : {})
    });
  };
  for (const line of [...(parsed.data.line_of_sight ?? []), ...(parsed.data.objects_line_of_sight ?? [])]) {
    const points = simplifyPolyline(line.map(toGrid));
    for (let i = 0; i + 1 < points.length; i++) addWall(points[i], points[i + 1]);
  }
  let doors = 0;
  for (const portal of parsed.data.portals ?? []) {
    const before = walls.length;
    addWall(toGrid(portal.bounds[0]), toGrid(portal.bounds[portal.bounds.length - 1]), portal.closed === false ? "open" : "closed");
    if (walls.length > before) doors++;
  }

  return {
    dataUrl: imageDataUrl(image),
    size: { widthPx: fit.columns * fit.pxPerSquare, heightPx: fit.rows * fit.pxPerSquare },
    fit,
    walls,
    doors
  };
}

/**
 * Read a picked Universal VTT file. The grid's px per square is taken from the image's own
 * width when it decodes, in case an exporter scaled the image without saying so.
 */
export async function readUniversalVttFile(file: File): Promise<{ map: UniversalVttMap; image: MapImageFile } | { error: string }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { error: "This file isn't a Universal VTT map: it can't be read as one." };
  }
  const parsed = parseUniversalVtt(raw);
  if ("error" in parsed) return parsed;
  const dims = await getImageDimensions(parsed.dataUrl);
  const size = dims ? { widthPx: dims.width, heightPx: dims.height } : parsed.size;
  const map = { ...parsed, size, fit: { ...parsed.fit, pxPerSquare: size.widthPx / parsed.fit.columns } };
  return { map, image: { dataUrl: map.dataUrl, fileName: file.name, size } };
}
