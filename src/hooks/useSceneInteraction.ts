import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject
} from "react";
import {
  combatantsInArea,
  DEFAULT_GRID_VISUALS,
  findPath,
  gridDistance,
  sizeFootprint,
  zoneTerrainOverlay
} from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { useSelectedCombatant } from "@/hooks/useSelectedCombatant";
import {
  clamp,
  getCellPoint,
  getLocalPoint,
  getSnappedWallPoint,
  pointsMatch,
  uniqueWallNodes,
  type GridPoint
} from "@/components/scene/coords";

interface UseSceneInteractionArgs {
  /** From `useViewport` — the map handlers no-op while a pan is happening. */
  isPanning: boolean;
  isPanningRef: RefObject<boolean>;
}

/**
 * All interactive scene-editing state: the active tool's transient state
 * (measure endpoints, wall cursor), the selection of walls / terrain /
 * templates / nodes, the derived readouts (measured path, template targets,
 * movement preview), and the pointer handlers for the `.battlemap` element.
 * Each tool owns its own layer — Select only touches tokens, Wall only
 * touches walls/nodes — so a tool's pointer handler no-ops outside its tool.
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
  const placeCombatant = useEncounterStore((state) => state.placeCombatant);
  const updateTemplate = useEncounterStore((state) => state.updateTemplate);
  const moveWallNode = useEncounterStore((state) => state.moveWallNode);
  const paintTerrainCells = useEncounterStore((state) => state.paintTerrainCells);
  const { selectedCombatant, selectedDefinition } = useSelectedCombatant();

  const grid = encounter.map.grid;
  const cellSize = grid.squareSizePx || DEFAULT_GRID_VISUALS.squareSizePx;

  const [wallCursorPoint, setWallCursorPoint] = useState<GridPoint | null>(null);
  // Multi-select: plain click replaces, Shift+click toggles. Walls and nodes are
  // mutually exclusive selections.
  const [selectedWallNodes, setSelectedWallNodes] = useState<GridPoint[]>([]);
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([]);
  // Multi-select: plain click replaces, Shift+click toggles (same rule as walls).
  const [selectedTerrainIds, setSelectedTerrainIds] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [draggingWallNode, setDraggingWallNode] = useState(false);
  const [draggingTemplateId, setDraggingTemplateId] = useState<string | null>(null);
  const [wallDragPoint, setWallDragPoint] = useState<GridPoint | null>(null);
  const [measureStart, setMeasureStart] = useState<GridPoint | null>(null);
  const [measureEnd, setMeasureEnd] = useState<GridPoint | null>(null);
  const [wallMenu, setWallMenu] = useState<{ x: number; y: number } | null>(null);
  const [terrainMenu, setTerrainMenu] = useState<{ x: number; y: number } | null>(null);
  // In-progress terrain paint-brush drag: the ordered, deduped cells the
  // cursor has crossed since pointer-down. Committed as one undo step on
  // pointer-up (see paintTerrainCells) — nothing is written to the store
  // mid-drag, so a preview render of this list is the only feedback.
  const [paintStroke, setPaintStroke] = useState<GridPoint[] | null>(null);
  // Right-click-a-token menu. Carries the target id so the menu can act on it
  // even before a future multi-selection model exists.
  const [tokenMenu, setTokenMenu] = useState<{ x: number; y: number; combatantId: string } | null>(null);
  // A token being dragged with the Select tool. `pixel` is the live cursor-tracked
  // top-left (battlemap px) for a 1:1 feel; `cell` is where it will snap. The
  // move is committed to the store once, on pointer-up.
  const [draggedToken, setDraggedToken] = useState<
    { id: string; cell: GridPoint; pixel: { x: number; y: number } | null } | null
  >(null);
  // The token that was just dropped — briefly tagged so it eases into its cell
  // and fades back to full opacity instead of snapping.
  const [droppingTokenId, setDroppingTokenId] = useState<string | null>(null);
  // Offset (battlemap px) from the token's top-left to the grab point, so the
  // token doesn't jump under the cursor when the drag starts.
  const dragGrabRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dropTimerRef = useRef<number | null>(null);
  const suppressNextMapClickRef = useRef(false);

  // Board multi-selection of tokens. Plain click replaces, Shift+click toggles.
  // The store keeps a single `selectedCombatantId` (the "primary" — drives the
  // sheet, sidebar, AI preview); this array is "primary + shift-added extras"
  // and is what the token outlines and the token context menu act on. It always
  // contains the primary unless the user has deliberately toggled everything off.
  // Seed empty so the server render and the first client render agree: the
  // encounter store rehydrates `selectedCombatantId` from localStorage
  // synchronously on the client, so reading it here during render would diverge
  // from the server's module default and trip a hydration mismatch on the
  // token's `selected` class. The mount effect below snaps it to the real
  // primary (same "restore after mount" shape as useViewport / the page prefs).
  const [selectedCombatantIds, setSelectedCombatantIds] = useState<string[]>([]);
  // The primary we last reconciled against, so the store subscription below can
  // tell an *external* move of the selection (Combat panel row, turn advance,
  // duplicate, delete re-point, scene load) from our own push.
  const reconciledPrimaryRef = useRef<string | null>(null);
  // Live mirror so the imperative helpers and the once-bound keydown listener
  // can read the current set without stale closures.
  const selectedCombatantIdsRef = useRef(selectedCombatantIds);
  selectedCombatantIdsRef.current = selectedCombatantIds;

  const selectWall = useCallback((id: string, additive = false) => {
    setSelectedWallNodes([]);
    setSelectedTerrainId(null);
    setSelectedTemplateId(null);
    setSelectedWallIds((prev) =>
      additive
        ? (prev.includes(id) ? prev.filter((wallId) => wallId !== id) : [...prev, id])
        : [id]
    );
  }, []);
  const selectNode = useCallback((node: GridPoint, additive = false) => {
    setSelectedWallIds([]);
    setSelectedWallNodes((prev) =>
      additive
        ? (prev.some((n) => pointsMatch(n, node)) ? prev.filter((n) => !pointsMatch(n, node)) : [...prev, node])
        : [node]
    );
  }, []);
  const clearWallSelection = useCallback(() => {
    setSelectedWallIds([]);
    setSelectedWallNodes([]);
    setWallMenu(null);
  }, []);
  const selectTerrain = useCallback((id: string, additive = false) => {
    setSelectedTerrainIds((prev) =>
      additive
        ? (prev.includes(id) ? prev.filter((terrainId) => terrainId !== id) : [...prev, id])
        : [id]
    );
  }, []);
  const clearTerrainSelection = useCallback(() => {
    setSelectedTerrainIds([]);
    setTerrainMenu(null);
  }, []);

  /**
   * Apply a board selection: keep the ref mirror in sync, push the newest member
   * to the store's primary selection, and mark it reconciled so the store
   * subscription treats it as ours (not an external move). `null` primary means
   * the set was toggled fully empty — the store's primary is left as-is so the
   * sheet keeps working.
   */
  const applyBoardSelection = useCallback((next: string[]) => {
    selectedCombatantIdsRef.current = next;
    const primary = next.length ? next[next.length - 1] : null;
    reconciledPrimaryRef.current = primary;
    setSelectedCombatantIds(next);
    if (primary && primary !== useEncounterStore.getState().selectedCombatantId) {
      useEncounterStore.getState().selectCombatant(primary);
    }
  }, []);

  /**
   * Select a token on the board. `additive` (Shift) toggles it in the set;
   * otherwise the set is replaced with just this id. The store's primary
   * selection follows the newest member.
   */
  const selectCombatantOnBoard = useCallback((id: string, additive = false) => {
    const prev = selectedCombatantIdsRef.current;
    const next = additive
      ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
      : (prev.length === 1 && prev[0] === id ? prev : [id]);
    if (next === prev) return;
    applyBoardSelection(next);
  }, [applyBoardSelection]);

  /** Collapse the board selection back to just the store's primary (drop shift-added extras). */
  const clearCombatantSelection = useCallback(() => {
    const primary = useEncounterStore.getState().selectedCombatantId;
    applyBoardSelection(primary ? [primary] : []);
  }, [applyBoardSelection]);

  // Back-compat single-selection views (ContextInspector node editor, ScenePanel).
  const selectedWallId = selectedWallIds[0] ?? null;
  const selectedTerrainId = selectedTerrainIds[0] ?? null;
  const setSelectedTerrainId = (id: string | null) => setSelectedTerrainIds(id ? [id] : []);
  const selectedWallNode = selectedWallNodes[0] ?? null;
  const setSelectedWallNode = (node: GridPoint | null) => setSelectedWallNodes(node ? [node] : []);
  const setSelectedWallId = (id: string | null) => {
    if (id) {
      selectWall(id, false);
    } else {
      setSelectedWallIds([]);
      setSelectedWallNodes([]);
    }
  };

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
  const selectedWall = selectedWallIds.length === 1
    ? encounter.map.walls.find((wall) => wall.id === selectedWallIds[0]) ?? null
    : null;
  const selectedTerrain = selectedTerrainIds.length === 1
    ? encounter.map.terrain.find((terrain) => terrain.id === selectedTerrainIds[0]) ?? null
    : null;
  const selectedTemplate = selectedTemplateId
    ? (encounter.map.templates ?? []).find((template) => template.id === selectedTemplateId) ?? null
    : null;
  const definitionsById = useMemo(
    () => new Map(encounter.definitions.map((definition) => [definition.id, definition])),
    [encounter.definitions]
  );
  const templateAffectedCombatants = useMemo(
    () =>
      selectedTemplate
        ? combatantsInArea(
            encounter.map,
            selectedTemplate.origin,
            selectedTemplate.area,
            encounter.combatants,
            definitionsById
          )
        : [],
    [definitionsById, encounter.combatants, encounter.map, selectedTemplate]
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
  const mapWithZoneTerrain = zoneTerrainOverlay(encounter.map, encounter.activeZones);
  const measuredDistance =
    measureStart && measureEnd ? gridDistance(measureStart, measureEnd, encounter.map.grid) : null;
  const measuredPath =
    measureStart && measureEnd && selectedDefinition
      ? findPath(
          mapWithZoneTerrain,
          measureStart,
          measureEnd,
          sizeFootprint(selectedDefinition.size),
          occupiedCellsForSelected
        )
      : null;
  const measuredPathCostFeet = measuredPath?.reachable
    ? measuredPath.cost * encounter.map.grid.distancePerSquare
    : null;
  const previewPath = useMemo(() => {
    if (!selectedCombatant || !nearestEnemy || !selectedDefinition) {
      return null;
    }
    return findPath(
      zoneTerrainOverlay(encounter.map, encounter.activeZones),
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
    setSelectedWallNodes((prev) => {
      const live = prev.filter((node) => wallNodes.some((candidate) => pointsMatch(candidate, node)));
      return live.length === prev.length ? prev : live;
    });
  }, [draggingWallNode, wallNodes]);

  useEffect(() => {
    if (tool !== "measure") {
      setMeasureStart(null);
      setMeasureEnd(null);
    }
    setWallMenu(null);
    setTokenMenu(null);
    setTerrainMenu(null);
    setPaintStroke(null);
    setDraggedToken(null);
    setDroppingTokenId(null);
  }, [tool]);

  // Clear the drop timer on unmount.
  useEffect(() => () => {
    if (dropTimerRef.current !== null) {
      window.clearTimeout(dropTimerRef.current);
    }
  }, []);

  // Drop selected walls that no longer exist (deleted from the menu / undone),
  // and close the menu once its target selection is empty.
  useEffect(() => {
    setSelectedWallIds((prev) => {
      const live = prev.filter((id) => encounter.map.walls.some((wall) => wall.id === id));
      return live.length === prev.length ? prev : live;
    });
  }, [encounter.map.walls]);
  useEffect(() => {
    if (wallMenu && selectedWallIds.length === 0 && selectedWallNodes.length === 0) {
      setWallMenu(null);
    }
  }, [wallMenu, selectedWallIds, selectedWallNodes]);

  // Drop selected terrain tiles that no longer exist (deleted from the menu /
  // undone), and close the menu once its target selection is empty.
  useEffect(() => {
    setSelectedTerrainIds((prev) => {
      const live = prev.filter((id) => encounter.map.terrain.some((terrain) => terrain.id === id));
      return live.length === prev.length ? prev : live;
    });
  }, [encounter.map.terrain]);
  useEffect(() => {
    if (terrainMenu && selectedTerrainIds.length === 0) {
      setTerrainMenu(null);
    }
  }, [terrainMenu, selectedTerrainIds]);

  // Close the token menu / cancel a drag if the target combatant is gone
  // (deleted from the menu, undone, scene swap).
  useEffect(() => {
    if (tokenMenu && !encounter.combatants.some((combatant) => combatant.id === tokenMenu.combatantId)) {
      setTokenMenu(null);
    }
    setDraggedToken((current) =>
      current && !encounter.combatants.some((combatant) => combatant.id === current.id) ? null : current
    );
  }, [encounter.combatants, tokenMenu]);

  // Adopt the store's persisted primary once, after mount — see the note on the
  // empty seed above. Runs before the store subscription is wired, so no
  // external selection move can interleave.
  useEffect(() => {
    const primary = useEncounterStore.getState().selectedCombatantId;
    if (!primary) return;
    reconciledPrimaryRef.current = primary;
    selectedCombatantIdsRef.current = [primary];
    setSelectedCombatantIds([primary]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop board-selected tokens that no longer exist (deleted / undone / scene swap).
  useEffect(() => {
    const prev = selectedCombatantIdsRef.current;
    const live = prev.filter((id) => encounter.combatants.some((combatant) => combatant.id === id));
    if (live.length === prev.length) {
      return;
    }
    selectedCombatantIdsRef.current = live;
    setSelectedCombatantIds(live);
  }, [encounter.combatants]);

  // Follow *external* moves of the store's primary selection (Combat panel row,
  // turn advance, duplicate, delete re-point, scene load): collapse the board
  // selection onto the new primary. Our own pushes set `reconciledPrimaryRef`
  // first, so they're recognised here and skipped. Subscribing (vs. reading a
  // selector) keeps this synchronous with the store write and immune to the
  // stale-value races a bidirectional effect pair would hit.
  useEffect(() => {
    return useEncounterStore.subscribe((state, prevState) => {
      if (state.selectedCombatantId === prevState.selectedCombatantId) {
        return;
      }
      const primary = state.selectedCombatantId;
      if (primary === reconciledPrimaryRef.current) {
        return;
      }
      reconciledPrimaryRef.current = primary;
      const prev = selectedCombatantIdsRef.current;
      const next = !primary
        ? (prev.length ? [] : prev)
        : (prev.includes(primary) ? prev : [primary]);
      if (next === prev) {
        return;
      }
      selectedCombatantIdsRef.current = next;
      setSelectedCombatantIds(next);
    });
  }, []);

  // Enter / Escape ends an in-progress wall chain without leaving the tool;
  // Escape with no chain clears the wall/node selection. Bound once; reads live
  // store state (matches how `useViewport` binds its Space listener).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== "Escape") {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        return;
      }
      const state = useEncounterStore.getState();
      if (state.tool === "wall" && state.pendingWallStart) {
        event.preventDefault();
        state.cancelWallPlacement();
        return;
      }
      if (event.key === "Escape") {
        clearWallSelection();
        clearTerrainSelection();
        if (selectedCombatantIdsRef.current.length > 1) {
          clearCombatantSelection();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearWallSelection, clearTerrainSelection, clearCombatantSelection]);

  /** Right-click on empty canvas: never show the browser menu; dismiss any open wall menu, else end a wall chain. */
  function onMapContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (wallMenu || tokenMenu || terrainMenu) {
      setWallMenu(null);
      setTokenMenu(null);
      setTerrainMenu(null);
      return;
    }
    const state = useEncounterStore.getState();
    if (state.tool === "wall" && state.pendingWallStart) {
      state.cancelWallPlacement();
    }
  }

  /** If a wall chain is being drawn, finish it and report that we handled the right-click. */
  const finishChainIfDrawing = () => {
    const state = useEncounterStore.getState();
    if (state.tool === "wall" && state.pendingWallStart) {
      state.cancelWallPlacement();
      return true;
    }
    return false;
  };

  /**
   * Right-click a wall segment: if it's already in the selection the menu acts on
   * the whole set; otherwise the selection is replaced with just this wall
   * (Foundry behaviour). No-op beyond finishing the chain while drawing.
   */
  function openWallMenu(wallId: string, x: number, y: number) {
    if (finishChainIfDrawing()) return;
    setTokenMenu(null);
    if (!selectedWallIds.includes(wallId)) {
      selectWall(wallId, false);
    }
    setWallMenu({ x, y });
  }

  /** Right-click a wall node: same replace-unless-selected rule, then open the menu. */
  function openNodeMenu(node: GridPoint, x: number, y: number) {
    if (finishChainIfDrawing()) return;
    setTokenMenu(null);
    if (!selectedWallNodes.some((n) => pointsMatch(n, node))) {
      selectNode(node, false);
    }
    setWallMenu({ x, y });
  }

  const closeWallMenu = useCallback(() => {
    setWallMenu(null);
  }, []);

  /**
   * Right-click a terrain tile: if it's already in the selection the menu acts
   * on the whole set; otherwise the selection is replaced with just this tile
   * (same Foundry-style rule as walls/tokens).
   */
  function openTerrainMenu(terrainId: string, x: number, y: number) {
    if (finishChainIfDrawing()) return;
    setWallMenu(null);
    setTokenMenu(null);
    if (!selectedTerrainIds.includes(terrainId)) {
      selectTerrain(terrainId, false);
    }
    setTerrainMenu({ x, y });
  }

  const closeTerrainMenu = useCallback(() => {
    setTerrainMenu(null);
  }, []);

  /**
   * Right-click a token: finish an in-progress wall chain (parity with the wall
   * menu). If the token is already in the board selection the menu acts on the
   * whole set; otherwise the selection is replaced with just this token (Foundry
   * behaviour).
   */
  function openTokenMenu(combatantId: string, x: number, y: number) {
    if (finishChainIfDrawing()) return;
    setWallMenu(null);
    clearWallSelection();
    if (!selectedCombatantIds.includes(combatantId)) {
      selectCombatantOnBoard(combatantId, false);
    }
    setTokenMenu({ x, y, combatantId });
  }

  const closeTokenMenu = useCallback(() => {
    setTokenMenu(null);
  }, []);

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
    // A plain click on empty canvas (walls / nodes / terrain / tokens stop their
    // own propagation) drops the wall/node selection and collapses a token
    // multi-selection back to the primary — except while drawing walls.
    if (tool !== "wall" && !event.shiftKey) {
      if (selectedWallIds.length > 0 || selectedWallNodes.length > 0) {
        clearWallSelection();
      }
      if (selectedCombatantIds.length > 1) {
        clearCombatantSelection();
      }
    }
    if (tool !== "terrain" && !event.shiftKey && selectedTerrainIds.length > 0) {
      clearTerrainSelection();
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

  /**
   * Press with the Terrain tool starts a paint-brush stroke; move/up below
   * extend and commit it. Shift+press is reserved for toggling an existing
   * tile into the multi-selection (handled by the tile's own onClick in
   * SceneOverlays) rather than painting over it.
   */
  function onMapPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (isPanning || isPanningRef.current || tool !== "terrain" || event.button !== 0 || event.shiftKey) {
      return;
    }
    // Unlike onMapClick's equivalent guard, this must also admit SVG targets
    // (terrain tiles re-enable pointer-events on an otherwise inert overlay,
    // see .terrain in globals.css) so pressing an existing tile still starts
    // a paint stroke, not just presses on empty canvas.
    if (!(event.target instanceof Element) || event.target.closest(".token")) {
      return;
    }
    const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
    if (point.x < 0 || point.y < 0 || point.x >= grid.width || point.y >= grid.height) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPaintStroke([point]);
  }

  function onMapPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (isPanning || isPanningRef.current) {
      return;
    }
    if (paintStroke) {
      const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
      if (point.x >= 0 && point.y >= 0 && point.x < grid.width && point.y < grid.height) {
        setPaintStroke((prev) => {
          if (!prev) return prev;
          const last = prev[prev.length - 1];
          if (last && pointsMatch(last, point)) return prev;
          if (prev.some((cell) => pointsMatch(cell, point))) return prev;
          return [...prev, point];
        });
      }
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
    if (draggedToken) {
      const local = getLocalPoint(event.currentTarget, event.clientX, event.clientY);
      const grab = dragGrabRef.current;
      const rawX = local.x - grab.x;
      const rawY = local.y - grab.y;
      const pixel = {
        x: clamp(rawX, 0, (grid.width - 1) * cellSize),
        y: clamp(rawY, 0, (grid.height - 1) * cellSize)
      };
      const cell = {
        x: clamp(Math.round(rawX / cellSize), 0, grid.width - 1),
        y: clamp(Math.round(rawY / cellSize), 0, grid.height - 1)
      };
      setDraggedToken((current) => (current ? { ...current, pixel, cell } : current));
      return;
    }
    if (tool === "measure" && measureStart) {
      const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
      setMeasureEnd({ x: clamp(point.x, 0, grid.width - 1), y: clamp(point.y, 0, grid.height - 1) });
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
    if (paintStroke) {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      paintTerrainCells(paintStroke);
      setPaintStroke(null);
      suppressNextMapClickRef.current = true;
      window.setTimeout(() => {
        suppressNextMapClickRef.current = false;
      }, 50);
      return;
    }
    if (draggedToken) {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // No-op inside the store when the cell is unchanged, so a plain click that
      // didn't move adds no undo entry.
      placeCombatant(draggedToken.id, draggedToken.cell);
      const droppedId = draggedToken.id;
      const moved = draggedToken.pixel !== null;
      setDraggedToken(null);
      if (moved) {
        // Ease the token into its cell + back to full opacity.
        setDroppingTokenId(droppedId);
        if (dropTimerRef.current !== null) {
          window.clearTimeout(dropTimerRef.current);
        }
        dropTimerRef.current = window.setTimeout(() => {
          setDroppingTokenId(null);
          dropTimerRef.current = null;
        }, 180);
      }
      window.setTimeout(() => {
        suppressNextMapClickRef.current = false;
      }, 50);
      return;
    }
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
    if (tool !== "wall") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressNextMapClickRef.current = true;
    if (event.shiftKey) {
      // Shift+click toggles the node in the multi-selection — no drag.
      selectNode(node, true);
      return;
    }
    selectNode(node, false);
    event.currentTarget.ownerSVGElement?.parentElement?.setPointerCapture?.(event.pointerId);
    setDraggingWallNode(true);
    setWallDragPoint(node);
  }

  /**
   * Press a token with the Select tool to select or drag it. Shift+press
   * toggles the token in the board multi-selection (no drag). Under every
   * other tool this is a no-op — walls / terrain each own their own layer.
   */
  function onTokenPointerDown(event: PointerEvent<HTMLButtonElement>, combatantId: string) {
    if (tool !== "select" || event.button !== 0) {
      return;
    }
    event.stopPropagation();
    if (event.shiftKey) {
      selectCombatantOnBoard(combatantId, true);
      return;
    }
    const combatant = encounter.combatants.find((entry) => entry.id === combatantId);
    if (!combatant) {
      return;
    }
    event.preventDefault();
    suppressNextMapClickRef.current = true;
    selectCombatantOnBoard(combatantId, false);
    const battlemap = event.currentTarget.closest<HTMLElement>(".battlemap");
    const local = battlemap ? getLocalPoint(battlemap, event.clientX, event.clientY) : null;
    // Where inside the token the grab landed, so it doesn't jump under the cursor.
    dragGrabRef.current = local
      ? { x: local.x - combatant.position.x * cellSize, y: local.y - combatant.position.y * cellSize }
      : { x: cellSize / 2, y: cellSize / 2 };
    battlemap?.setPointerCapture?.(event.pointerId);
    setDroppingTokenId(null);
    setDraggedToken({ id: combatantId, cell: combatant.position, pixel: null });
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
    selectedWallIds,
    selectedWallNodes,
    selectedWallCount: selectedWallIds.length,
    selectedWallNodeCount: selectedWallNodes.length,
    selectWall,
    selectNode,
    clearWallSelection,
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

    // terrain tiles
    selectedTerrainIds,
    selectedTerrainCount: selectedTerrainIds.length,
    selectTerrain,
    clearTerrainSelection,
    terrainMenu,
    openTerrainMenu,
    closeTerrainMenu,
    paintStroke,

    // walls
    displayWalls,
    wallNodes,
    activeWallNode,
    wallCursorPoint,
    wallDragPoint,
    draggingWallNode,
    setWallDragPoint,
    setDraggingWallNode,
    wallMenu,
    openWallMenu,
    openNodeMenu,
    closeWallMenu,

    // token selection + context menu + drag
    selectedCombatantIds,
    selectedCombatantCount: selectedCombatantIds.length,
    selectCombatantOnBoard,
    clearCombatantSelection,
    tokenMenu,
    openTokenMenu,
    closeTokenMenu,
    draggedToken,
    droppingTokenId,

    // templates
    templateAffectedCombatants,

    // measure
    measureStart,
    measureEnd,
    measuredDistance,
    measuredPath,
    measuredPathCostFeet,

    // movement preview
    previewPath,

    // handlers for the .battlemap element
    onMapClick,
    onMapContextMenu,
    onMapPointerDown,
    onMapPointerMove,
    onMapPointerLeave,
    onMapPointerUp,
    onWallNodePointerDown,
    onTemplatePointerDown,
    onTokenPointerDown
  };
}

export type SceneInteraction = ReturnType<typeof useSceneInteraction>;
