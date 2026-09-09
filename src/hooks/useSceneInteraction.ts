import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject
} from "react";
import {
  cellsInArea,
  combatantsInArea,
  DEFAULT_GRID_VISUALS,
  findPath,
  gridDistance,
  coverBetween,
  lineOfEffect,
  lineOfSight,
  sizeFootprint,
  type PlacedTemplate
} from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { useSelectedCombatant } from "@/hooks/useSelectedCombatant";
import {
  clamp,
  getCellPoint,
  getSnappedWallPoint,
  pointsMatch,
  uniqueWallNodes,
  type GridPoint
} from "@/components/scene/coords";

const DEFAULT_TEMPLATE_DRAFT: Omit<PlacedTemplate, "id"> = {
  name: "20 ft Circle",
  origin: { x: 0, y: 0 },
  area: { type: "circle", size: 20, direction: "east", width: 5 },
  affects: "all",
  color: "#287277"
};

interface UseSceneInteractionArgs {
  /** From `useViewport` — the map handlers no-op while a pan is happening. */
  isPanning: boolean;
  isPanningRef: RefObject<boolean>;
}

/**
 * All interactive scene-editing state: the active tool's transient state
 * (measure/sight endpoints, wall cursor, template draft), the selection of
 * walls / terrain / templates / nodes, the derived readouts (measured path,
 * line of sight, template targets, movement preview), and the pointer handlers
 * for the `.battlemap` element.
 *
 * Consumed by `SceneCanvas` (rendering) and, for now, by the legacy Scene
 * panel in the page component (inspectors). Phase 3 moves the panel side into a
 * dedicated ContextInspector that reads the same result.
 */
export function useSceneInteraction({ isPanning, isPanningRef }: UseSceneInteractionArgs) {
  const encounter = useEncounterStore((state) => state.encounter);
  const tool = useEncounterStore((state) => state.tool);
  const pendingWallStart = useEncounterStore((state) => state.pendingWallStart);
  const handleMapClick = useEncounterStore((state) => state.handleMapClick);
  const addTemplate = useEncounterStore((state) => state.addTemplate);
  const updateTemplate = useEncounterStore((state) => state.updateTemplate);
  const moveWallNode = useEncounterStore((state) => state.moveWallNode);
  const { selectedCombatant, selectedDefinition } = useSelectedCombatant();

  const grid = encounter.map.grid;
  const cellSize = grid.squareSizePx || DEFAULT_GRID_VISUALS.squareSizePx;

  const [wallCursorPoint, setWallCursorPoint] = useState<GridPoint | null>(null);
  const [selectedWallNode, setSelectedWallNode] = useState<GridPoint | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [draggingWallNode, setDraggingWallNode] = useState(false);
  const [draggingTemplateId, setDraggingTemplateId] = useState<string | null>(null);
  const [wallDragPoint, setWallDragPoint] = useState<GridPoint | null>(null);
  const [measureStart, setMeasureStart] = useState<GridPoint | null>(null);
  const [measureEnd, setMeasureEnd] = useState<GridPoint | null>(null);
  const [sightStart, setSightStart] = useState<GridPoint | null>(null);
  const [sightEnd, setSightEnd] = useState<GridPoint | null>(null);
  const [templateDraft, setTemplateDraft] = useState<Omit<PlacedTemplate, "id">>(DEFAULT_TEMPLATE_DRAFT);
  const suppressNextMapClickRef = useRef(false);

  const activeWallNode = draggingWallNode && wallDragPoint ? wallDragPoint : selectedWallNode;
  const displayWalls = useMemo(() => {
    if (!selectedWallNode || !wallDragPoint) {
      return encounter.map.walls;
    }
    return encounter.map.walls.map((wall) => ({
      ...wall,
      start: pointsMatch(wall.start, selectedWallNode) ? wallDragPoint : wall.start,
      end: pointsMatch(wall.end, selectedWallNode) ? wallDragPoint : wall.end
    }));
  }, [encounter.map.walls, selectedWallNode, wallDragPoint]);
  const wallNodes = useMemo(() => uniqueWallNodes(displayWalls), [displayWalls]);
  const selectedWall = selectedWallId
    ? encounter.map.walls.find((wall) => wall.id === selectedWallId) ?? null
    : null;
  const selectedTerrain = selectedTerrainId
    ? encounter.map.terrain.find((terrain) => terrain.id === selectedTerrainId) ?? null
    : null;
  const selectedTemplate = selectedTemplateId
    ? (encounter.map.templates ?? []).find((template) => template.id === selectedTemplateId) ?? null
    : null;
  const templatePreview = selectedTemplate ?? templateDraft;
  const definitionsById = useMemo(
    () => new Map(encounter.definitions.map((definition) => [definition.id, definition])),
    [encounter.definitions]
  );
  const templatePreviewCells = useMemo(
    () => cellsInArea(encounter.map, templatePreview.origin, templatePreview.area),
    [encounter.map, templatePreview]
  );
  const templateAffectedCombatants = useMemo(
    () =>
      combatantsInArea(
        encounter.map,
        templatePreview.origin,
        templatePreview.area,
        encounter.combatants,
        definitionsById
      ),
    [definitionsById, encounter.combatants, encounter.map, templatePreview]
  );

  const enemies = encounter.combatants.filter(
    (combatant) => combatant.faction !== selectedCombatant?.faction && combatant.state === "active"
  );
  const nearestEnemy = selectedCombatant
    ? [...enemies].sort(
        (a, b) =>
          gridDistance(selectedCombatant.position, a.position, encounter.map.grid) -
          gridDistance(selectedCombatant.position, b.position, encounter.map.grid)
      )[0]
    : null;
  const occupiedCellsForSelected = selectedCombatant
    ? encounter.combatants
        .filter((combatant) => combatant.id !== selectedCombatant.id && combatant.state === "active")
        .map((combatant) => combatant.position)
    : [];
  const measuredDistance =
    measureStart && measureEnd ? gridDistance(measureStart, measureEnd, encounter.map.grid) : null;
  const measuredPath =
    measureStart && measureEnd && selectedDefinition
      ? findPath(
          encounter.map,
          measureStart,
          measureEnd,
          sizeFootprint(selectedDefinition.size),
          occupiedCellsForSelected
        )
      : null;
  const measuredPathCostFeet = measuredPath?.reachable
    ? measuredPath.cost * encounter.map.grid.distancePerSquare
    : null;
  const sightResult =
    sightStart && sightEnd
      ? {
          sight: lineOfSight(encounter.map, sightStart, sightEnd),
          effect: lineOfEffect(encounter.map, sightStart, sightEnd),
          cover: coverBetween(encounter.map, sightStart, 1, sightEnd, 1).level,
          distance: gridDistance(sightStart, sightEnd, encounter.map.grid)
        }
      : null;
  const previewPath = useMemo(() => {
    if (!selectedCombatant || !nearestEnemy || !selectedDefinition) {
      return null;
    }
    return findPath(
      encounter.map,
      selectedCombatant.position,
      nearestEnemy.position,
      sizeFootprint(selectedDefinition.size),
      encounter.combatants
        .filter(
          (combatant) =>
            combatant.id !== selectedCombatant.id &&
            combatant.id !== nearestEnemy.id &&
            combatant.state === "active"
        )
        .map((combatant) => combatant.position)
    );
  }, [encounter, nearestEnemy, selectedCombatant, selectedDefinition]);

  useEffect(() => {
    if (draggingWallNode) {
      return;
    }
    if (selectedWallNode && !wallNodes.some((node) => pointsMatch(node, selectedWallNode))) {
      setSelectedWallNode(null);
      setWallDragPoint(null);
      setDraggingWallNode(false);
    }
  }, [draggingWallNode, selectedWallNode, wallNodes]);

  useEffect(() => {
    if (tool !== "measure") {
      setMeasureStart(null);
      setMeasureEnd(null);
    }
    if (tool !== "sight") {
      setSightStart(null);
      setSightEnd(null);
    }
  }, [tool]);

  function onMapClick(event: MouseEvent<HTMLDivElement>) {
    if (isPanning || isPanningRef.current) {
      return;
    }
    if (suppressNextMapClickRef.current) {
      suppressNextMapClickRef.current = false;
      return;
    }
    if (!(event.target instanceof HTMLElement) || event.target.closest(".token")) {
      return;
    }
    const point =
      tool === "wall"
        ? getSnappedWallPoint(event.currentTarget, event.clientX, event.clientY, cellSize, grid.width, grid.height)
        : getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
    const { x, y } = point;
    const inBounds =
      tool === "wall"
        ? x >= 0 && y >= 0 && x <= grid.width && y <= grid.height
        : x >= 0 && y >= 0 && x < grid.width && y < grid.height;
    if (!inBounds) {
      return;
    }
    if (tool === "template") {
      const id = addTemplate({ ...templateDraft, origin: point });
      setSelectedTemplateId(id);
      return;
    }
    if (tool === "sight") {
      if (!sightStart) {
        setSightStart(point);
        setSightEnd(point);
      } else {
        setSightEnd(point);
      }
      return;
    }
    if (tool === "measure") {
      if (!measureStart) {
        setMeasureStart(point);
        setMeasureEnd(point);
      } else {
        setMeasureEnd(point);
      }
      return;
    }
    handleMapClick(point);
  }

  function onMapPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (isPanning || isPanningRef.current) {
      return;
    }
    if (draggingTemplateId) {
      const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
      updateTemplate(draggingTemplateId, {
        origin: {
          x: clamp(point.x, 0, grid.width - 1),
          y: clamp(point.y, 0, grid.height - 1)
        }
      });
      return;
    }
    if (tool === "measure" && measureStart) {
      const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
      setMeasureEnd({ x: clamp(point.x, 0, grid.width - 1), y: clamp(point.y, 0, grid.height - 1) });
      return;
    }
    if (tool === "sight" && sightStart) {
      const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
      setSightEnd({ x: clamp(point.x, 0, grid.width - 1), y: clamp(point.y, 0, grid.height - 1) });
      return;
    }
    if (tool === "template" && !selectedTemplateId) {
      const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
      setTemplateDraft((current) => ({
        ...current,
        origin: {
          x: clamp(point.x, 0, grid.width - 1),
          y: clamp(point.y, 0, grid.height - 1)
        }
      }));
      return;
    }
    if (tool !== "wall") {
      return;
    }
    const point = getSnappedWallPoint(event.currentTarget, event.clientX, event.clientY, cellSize, grid.width, grid.height);
    setWallCursorPoint(point);
    if (draggingWallNode) {
      setWallDragPoint(point);
    }
  }

  function onMapPointerLeave() {
    setWallCursorPoint(null);
  }

  function onMapPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (draggingTemplateId) {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDraggingTemplateId(null);
      window.setTimeout(() => {
        suppressNextMapClickRef.current = false;
      }, 50);
      return;
    }
    if (!draggingWallNode || !selectedWallNode || !wallDragPoint) {
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    moveWallNode(selectedWallNode, wallDragPoint);
    setSelectedWallNode(wallDragPoint);
    setDraggingWallNode(false);
    setWallDragPoint(null);
    window.setTimeout(() => {
      suppressNextMapClickRef.current = false;
    }, 50);
  }

  function onWallNodePointerDown(event: PointerEvent<SVGCircleElement>, node: GridPoint) {
    event.preventDefault();
    event.stopPropagation();
    suppressNextMapClickRef.current = true;
    event.currentTarget.ownerSVGElement?.parentElement?.setPointerCapture?.(event.pointerId);
    setSelectedWallNode(node);
    setDraggingWallNode(true);
    setWallDragPoint(node);
  }

  function onTemplatePointerDown(event: PointerEvent<SVGRectElement>, templateId: string) {
    event.preventDefault();
    event.stopPropagation();
    suppressNextMapClickRef.current = true;
    event.currentTarget.ownerSVGElement?.parentElement?.setPointerCapture?.(event.pointerId);
    setSelectedTemplateId(templateId);
    setSelectedWallId(null);
    setSelectedTerrainId(null);
    setDraggingTemplateId(templateId);
  }

  return {
    tool,
    pendingWallStart,
    cellSize,
    selectedCombatant,
    selectedDefinition,
    nearestEnemy,

    // selection
    selectedWallId,
    selectedTerrainId,
    selectedTemplateId,
    selectedWallNode,
    setSelectedWallId,
    setSelectedTerrainId,
    setSelectedTemplateId,
    setSelectedWallNode,
    selectedWall,
    selectedTerrain,
    selectedTemplate,

    // walls
    displayWalls,
    wallNodes,
    activeWallNode,
    wallCursorPoint,
    wallDragPoint,
    draggingWallNode,
    setWallDragPoint,
    setDraggingWallNode,

    // templates
    templateDraft,
    setTemplateDraft,
    templatePreview,
    templatePreviewCells,
    templateAffectedCombatants,

    // measure / sight
    measureStart,
    measureEnd,
    sightStart,
    sightEnd,
    measuredDistance,
    measuredPath,
    measuredPathCostFeet,
    sightResult,

    // movement preview
    previewPath,

    // handlers for the .battlemap element
    onMapClick,
    onMapPointerMove,
    onMapPointerLeave,
    onMapPointerUp,
    onWallNodePointerDown,
    onTemplatePointerDown
  };
}

export type SceneInteraction = ReturnType<typeof useSceneInteraction>;
