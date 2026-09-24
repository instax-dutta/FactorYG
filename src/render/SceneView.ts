import * as THREE from 'three';
import { CELL, GRID_H, GRID_W, TICK_HZ, UI_HZ } from '../config/constants';
import { createRenderer, type RenderBackend } from './rendererFactory';
import {
  boundsFromGrid,
  cameraPositionFrom,
  createCameraState,
  orthoFrustum,
  pan as panCamera,
  screenToGroundDelta,
  zoomAbout,
  ZOOM_MAX,
  ZOOM_MIN,
  type CameraState,
} from './IsoCamera';
import { createGrid, GROUND_NAME } from './GridRenderer';
import { GhostPreview } from './GhostPreview';
import { machineFootprint } from './machineShapes';
import {
  createEntityMesh,
  disposeEntityMesh,
  rotationToYaw,
  setItemMarker,
  setSelectedHighlight,
} from './EntityMeshFactory';

import { cellToWorld, worldToCell, type Cell, type PlacementPreview } from '../sim/placement';
import type { MachineType, Rotation } from '../sim/machines';
import { createPauseTracker, resumeFromSave } from '../sim/offline';
import { applySave, clearSave, loadSave, saveToStorage } from '../sim/save';
import { createHistory } from '../sim/history';
import { straightRun } from '../sim/runs';
import { createSaveSchedule, runForcedSave } from '../sim/autosave';
import { startingUnlocks } from '../sim/techTree';
import { Simulation, type SimSnapshot } from '../sim/simulation';
import { createFixedStepClock, FIXED_DT } from '../sim/tickLoop';
import { generateNodes } from '../sim/worldgen';
import { createThrottledPush, useUiStore, type MachineInfo } from '../ui/store';
import { machineInfoFor as describeMachine } from '../ui/machineInfo';
import { NODE_LEGEND } from '../ui/nodeLegend';

const CAMERA_DISTANCE = 200;
const KEY_PAN_SPEED = 12; // world units per second
const WHEEL_ZOOM_STEP = 0.02;
/** Below this, a press is a click; above it, the gesture is a map drag. */
const DRAG_THRESHOLD_PX = 4;

export interface SceneDisposeOptions {
  save?: boolean;
}

export interface MountSceneOptions {
  signal?: AbortSignal;
}

export interface SceneHandle {
  backend: RenderBackend;
  dispose(options?: SceneDisposeOptions): void;
}

/**
 * Phase 1 scene: three.js owns rendering, the plain-TS Simulation owns the
 * factory, React owns the HUD. Nothing here holds game state of its own.
 */
export async function mountScene(
  container: HTMLElement,
  options: MountSceneOptions = {},
): Promise<SceneHandle> {
  function safeStorage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  const storage = safeStorage();
  const sim = new Simulation({ unlocked: startingUnlocks() });
  const loadResult = storage ? loadSave(storage) : ({ kind: 'empty' } as const);

  function saveNow(): boolean {
    const ui = useUiStore.getState();
    ui.setSaveStatus('saving');
    try {
      if (!storage) throw new Error('storage unavailable');
      const save = saveToStorage(sim, storage);
      ui.setSaveStatus('saved', save.lastSavedAt);
      return true;
    } catch {
      ui.setSaveStatus('error');
      ui.showToast('Save failed. Your latest changes may not be stored.', 'danger');
      return false;
    }
  }

  if (loadResult.kind === 'loaded') {
    applySave(sim, loadResult.save);
    const resume = resumeFromSave(
      Object.values(loadResult.save.productionChains),
      loadResult.save.lastSavedAt,
      Date.now(),
      sim.prestigeState().permanentMultipliers.sellValue,
    );
    sim.creditOffline(resume.report);
    if (resume.showModal) useUiStore.getState().showOffline(resume.report);
    saveNow();
  }
  if (loadResult.kind === 'recovered') {
    useUiStore.getState().setRecoveryPending(true);
    if (storage) saveNow();
  }

  const cleanupCallbacks: Array<() => void> = [];
  let cleanedUp = false;

  function runCleanup(): void {
    if (cleanedUp) return;
    cleanedUp = true;
    for (let index = cleanupCallbacks.length - 1; index >= 0; index -= 1) cleanupCallbacks[index]();
    cleanupCallbacks.length = 0;
  }

  try {
    return await initialize();
  } catch (error) {
    runCleanup();
    throw error;
  }

  async function initialize(): Promise<SceneHandle> {
    const { backend, renderer } = await createRenderer();
    const canvas = renderer.domElement;
    canvas.dataset.rendererBackend = backend;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Factory map. Use arrow keys to move the cell cursor.');
    canvas.setAttribute(
      'aria-keyshortcuts',
      'ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space R X Escape',
    );
    cleanupCallbacks.push(() => {
      renderer.dispose();
      canvas.remove();
    });
    options.signal?.throwIfAborted();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1016);
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, 90, 15);
    scene.add(sun);
    let gridGroup = createGrid();
    scene.add(gridGroup);
    cleanupCallbacks.push(() => disposeEntityMesh(gridGroup));
    const nodeMarkers = createNodeMarkers();
    scene.add(nodeMarkers);
    cleanupCallbacks.push(() => disposeEntityMesh(nodeMarkers));

    // Live view of the plot: the sim owns it and it grows on expansion. Starts
    // from the constants; a saved larger plot is picked up by the first snapshot
    // push, which rebuilds the grid mesh and camera clamp.
    let bounds = boundsFromGrid(GRID_W, GRID_H);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 2);
    let camState: CameraState = createCameraState(bounds);

    const ghost = new GhostPreview();
    scene.add(ghost.cursorGroup);
    scene.add(ghost.group);
    cleanupCallbacks.push(() => ghost.dispose());

    const meshRoot = new THREE.Group();
    scene.add(meshRoot);
    const meshes = new Map<string, THREE.Mesh>();
    cleanupCallbacks.push(() => {
      for (const mesh of meshes.values()) disposeEntityMesh(mesh);
      meshes.clear();
      meshRoot.clear();
    });

    // Undo lives in memory and starts empty: a save the player has loaded is
    // already the world they accepted, so there is nothing behind it to undo into.
    const history = createHistory();

    function syncUndo(): void {
      useUiStore.getState().setCanUndo(history.canUndo());
    }

    // --- mesh sync ----------------------------------------------------------

    function syncMeshes(): void {
      const live = new Set<string>();
      for (const entity of sim.entities()) {
        live.add(entity.id);
        let mesh = meshes.get(entity.id);
        if (!mesh) {
          mesh = createEntityMesh(entity.type, entity.rotation);
          meshRoot.add(mesh);
          meshes.set(entity.id, mesh);
        }
        const world = cellToWorld(entity);
        mesh.position.set(world.x, machineFootprint(entity.type).lift, world.z);
        mesh.rotation.y = rotationToYaw(entity.rotation);
        setItemMarker(mesh, entity.item);
      }

      for (const [id, mesh] of meshes) {
        if (live.has(id)) continue;
        meshRoot.remove(mesh);
        disposeEntityMesh(mesh);
        meshes.delete(id);
      }
    }

    /** The pure sim -> panel mapping lives in `ui/machineInfo`, so it is testable. */
    function machineInfoFor(cell: Cell): MachineInfo | null {
      const entity = sim.entityAt(cell);
      if (!entity) return null;
      const multipliers = sim.prestigeState().permanentMultipliers;
      return describeMachine(
        entity,
        sim.entityReachesDepot(cell),
        multipliers.productionSpeed,
        multipliers.sellValue,
      );
    }

    function updatePlacementStatus(status: PlacementPreview | null): void {
      useUiStore.getState().setPlacementStatus(status);
    }

    function runStatus(previews: PlacementPreview[]): PlacementPreview | null {
      return previews.find((preview) => !preview.check.ok) ?? previews.find((preview) => preview.connection !== 'connected') ?? null;
    }

    function machineLabel(type: MachineType): string {
      return type.charAt(0).toUpperCase() + type.slice(1);
    }

    function keyboardCenter(): Cell {
      const plot = sim.bounds();
      return { x: Math.floor(plot.width / 2), y: Math.floor(plot.height / 2) };
    }

    function clampKeyboardCell(cell: Cell): Cell {
      const plot = sim.bounds();
      return {
        x: Math.min(plot.width - 1, Math.max(0, cell.x)),
        y: Math.min(plot.height - 1, Math.max(0, cell.y)),
      };
    }

    function announce(message: string): void {
      useUiStore.getState().setKeyboardAnnouncement(message);
    }

    function syncKeyboardCursor(cell: Cell | null): void {
      const ui = useUiStore.getState();
      if (!cell) {
        ui.setKeyboardCursor(null);
        ghost.hideCursor();
        canvas.dataset.keyboardCursorVisible = 'false';
        delete canvas.dataset.keyboardCursor;
        return;
      }
      const next = clampKeyboardCell(cell);
      ui.setKeyboardCursor(next);
      canvas.dataset.keyboardCursor = `${next.x},${next.y}`;
      const focused = document.activeElement === canvas;
      canvas.dataset.keyboardCursorVisible = focused ? 'true' : 'false';
      if (focused) ghost.showCursor(next);
      else ghost.hideCursor();
    }

    function updateKeyboardPreview(cell: Cell | null): void {
      const ui = useUiStore.getState();
      if (!cell || !ui.selectedTool) {
        ghost.hide();
        updatePlacementStatus(null);
        return;
      }
      const preview = sim.previewAt(ui.selectedTool, cell.x, cell.y, ui.rotation);
      ghost.showAt(cell, preview, ui.selectedTool, ui.rotation);
      updatePlacementStatus(preview);
    }

    function inspectKeyboardCell(cell: Cell): void {
      announce('');
      updatePlacementStatus(null);
      useUiStore.getState().selectMachine(cell, machineInfoFor(cell));
      applySelectionHighlight();
    }

    function moveKeyboardCursor(dx: number, dy: number): void {
      const current = useUiStore.getState().keyboardCursor ?? keyboardCenter();
      syncKeyboardCursor({ x: current.x + dx, y: current.y + dy });
      const next = useUiStore.getState().keyboardCursor;
      inspectKeyboardCell(next as Cell);
      updateKeyboardPreview(next);
    }

    function placeAtCell(tool: MachineType, cell: Cell, rotation: Rotation) {
      const preview = sim.previewAt(tool, cell.x, cell.y, rotation);
      const result = sim.place(tool, cell.x, cell.y, rotation);
      if (result.ok) useUiStore.getState().clearToast();
      updatePlacementStatus(preview);
      if (result.ok) {
        history.recordPlace(cell);
        syncUndo();
        syncMeshes();
        saveForced();
        pushSnapshot(sim.snapshot());
      } else if (preview.message) {
        useUiStore.getState().showToast(preview.message, 'warning');
      }
      return { preview, result };
    }

    function demolishAt(cell: Cell): { removed: boolean; type: MachineType | null } {
      const doomed = sim.entityAt(cell);
      const removed = sim.removeAt(cell);
      if (removed && doomed) history.recordDemolish(doomed);
      if (removed) {
        syncUndo();
        saveForced();
      }
      syncMeshes();
      pushSnapshot(sim.snapshot());
      useUiStore.getState().selectMachine(cell, machineInfoFor(cell));
      applySelectionHighlight();
      announce(removed && doomed ? `Demolished ${machineLabel(doomed.type)}` : `Nothing to demolish at cell ${cell.x}, ${cell.y}`);
      return { removed, type: doomed?.type ?? null };
    }

    function clearKeyboardTool(): void {
      useUiStore.getState().setSelectedTool(null);
      ghost.hide();
      updatePlacementStatus(null);
      announce('Tool cleared');
    }

    function rotateKeyboardTool(): boolean {
      const ui = useUiStore.getState();
      ui.rotate();
      const rotation = useUiStore.getState().rotation;
      const direction = rotation === 0 ? 'N' : rotation === 90 ? 'E' : rotation === 180 ? 'S' : 'W';
      announce(ui.selectedTool ? `Rotated ${machineLabel(ui.selectedTool)} to ${direction}` : `Rotated to ${direction}`);
      updateKeyboardPreview(ui.keyboardCursor);
      return true;
    }

    function onCanvasFocus(): void {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const before = useUiStore.getState();
      const shouldInspect = before.keyboardCursor === null;
      const cell = before.keyboardCursor ?? keyboardCenter();
      syncKeyboardCursor(cell);
      const focusedCell = useUiStore.getState().keyboardCursor as Cell;
      if (shouldInspect || !useUiStore.getState().inspectedCell) inspectKeyboardCell(focusedCell);
      updateKeyboardPreview(focusedCell);
    }

    function onCanvasBlur(): void {
      ghost.hideCursor();
      ghost.hide();
      updatePlacementStatus(null);
      canvas.dataset.keyboardCursorVisible = 'false';
    }

    function techPanelOpen(): boolean {
      return document.querySelector('[data-testid="tech-panel"]') !== null;
    }

    function isMapKey(key: string): boolean {
      const lower = key.toLowerCase();
      return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown' ||
        lower === 'r' || lower === 'x' || key === 'Enter' || key === ' ' || key === 'Spacebar';
    }

    function hasMapModifier(event: KeyboardEvent): boolean {
      return event.ctrlKey || event.metaKey || event.altKey;
    }

    function isUndoShortcut(event: KeyboardEvent, key: string): boolean {
      return (event.ctrlKey || event.metaKey) && !event.altKey && key.toLowerCase() === 'z';
    }

    function onCanvasKeyDown(event: KeyboardEvent): void {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const key = event.key;
      const lower = key.toLowerCase();
      if (techPanelOpen() && !isUndoShortcut(event, key)) return;
      if (isMapKey(key) && hasMapModifier(event)) return;
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        if (key === 'ArrowLeft') moveKeyboardCursor(-1, 0);
        if (key === 'ArrowRight') moveKeyboardCursor(1, 0);
        if (key === 'ArrowUp') moveKeyboardCursor(0, -1);
        if (key === 'ArrowDown') moveKeyboardCursor(0, 1);
        return;
      }
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        event.stopPropagation();
        const ui = useUiStore.getState();
        const cell = ui.keyboardCursor ?? keyboardCenter();
        syncKeyboardCursor(cell);
        if (!ui.selectedTool) {
          inspectKeyboardCell(cell);
          updateKeyboardPreview(null);
          return;
        }
        const outcome = placeAtCell(ui.selectedTool, cell, ui.rotation);
        if (outcome.result.ok) {
          inspectKeyboardCell(cell);
          ghost.hide();
          updatePlacementStatus(outcome.preview);
          announce(`Placed ${machineLabel(ui.selectedTool)}`);
        } else {
          announce(`Placement refused: ${outcome.preview.message ?? 'Cell unavailable'}`);
        }
        return;
      }
      if (lower === 'x') {
        event.preventDefault();
        event.stopPropagation();
        const cell = useUiStore.getState().keyboardCursor ?? keyboardCenter();
        syncKeyboardCursor(cell);
        demolishAt(cell);
        updateKeyboardPreview(cell);
        return;
      }
      if (lower === 'r') {
        if (!rotateKeyboardTool()) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        clearKeyboardTool();
      }
    }

    function globalShortcutBlocked(target: EventTarget | null, allowUndo = false): boolean {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
      if (target instanceof Element && target.closest('button, input, select, textarea, a[href], [contenteditable="true"], [role="button"], [data-testid="tech-panel"]') !== null) return true;
      return techPanelOpen() && !allowUndo;
    }

    function applySelectionHighlight(): void {
      const selectedId = useUiStore.getState().selected?.id;
      for (const [id, mesh] of meshes) setSelectedHighlight(mesh, selectedId === id);
    }

    function refreshSelection(): void {
      const ui = useUiStore.getState();
      if (!ui.inspectedCell) return;
      ui.selectMachine(ui.inspectedCell, machineInfoFor(ui.inspectedCell));
      applySelectionHighlight();
    }

    function applySnapshot(snapshot: SimSnapshot): void {
      const ui = useUiStore.getState();
      ui.setEconomy(snapshot.currency, snapshot.cps);
      ui.setUnlocks(sim.unlocks());
      ui.setPrestigeState(sim.prestigeState());
      // Counted here rather than in the HUD: the UI layer never walks the grid.
      ui.setExtractors(snapshot.entities.reduce((total, entity) => total + (entity.type === 'extractor' ? 1 : 0), 0));
      ui.setPlot(snapshot.plot);
      rebuildPlotIfGrown(snapshot.plot.width, snapshot.plot.height);
      if (ui.keyboardCursor) syncKeyboardCursor(ui.keyboardCursor);
    }

    /** Rebuilds the grid mesh and camera clamp once the plot has grown. */
    function rebuildPlotIfGrown(width: number, height: number): void {
      const next = boundsFromGrid(width, height);
      if (next.maxX === bounds.maxX && next.maxZ === bounds.maxZ) return;
      bounds = next;
      scene.remove(gridGroup);
      disposeEntityMesh(gridGroup);
      gridGroup = createGrid(width, height);
      scene.add(gridGroup);
      // Keep the camera's clamped target inside the new, larger plot.
      camState = panCamera(camState, 0, 0, bounds);
    }

    // --- camera -------------------------------------------------------------

    function viewport(): { width: number; height: number } {
      return {
        width: container.clientWidth || 1,
        height: container.clientHeight || 1,
      };
    }

    function applyCamera(): void {
      const { width, height } = viewport();
      const position = cameraPositionFrom(camState, CAMERA_DISTANCE);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(camState.x, 0, camState.z);

      const frustum = orthoFrustum(camState.zoom, width / height);
      camera.left = frustum.left;
      camera.right = frustum.right;
      camera.top = frustum.top;
      camera.bottom = frustum.bottom;
      camera.updateProjectionMatrix();
    }

    function resize(): void {
      const { width, height } = viewport();
      renderer.setSize(width, height, false);
      applyCamera();
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    cleanupCallbacks.push(() => observer.disconnect());

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function updatePointer(event: { clientX: number; clientY: number }): void {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    }

    function raycastGround(event: { clientX: number; clientY: number }): { x: number; z: number } | null {
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const ground = scene.getObjectByName(GROUND_NAME);
      if (!ground) return null;
      const hits = raycaster.intersectObject(ground, false);
      return hits.length === 0 ? null : { x: hits[0].point.x, z: hits[0].point.z };
    }

    function raycastCell(event: { clientX: number; clientY: number }): Cell | null {
      const ground = raycastGround(event);
      return ground ? worldToCell(ground.x, ground.z) : null;
    }

    // --- input --------------------------------------------------------------

    const pressed = new Set<string>();
    let dragging = false;
    let dragMoved = false;
    let dragButton = -1;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let dragAnchor: { x: number; z: number } | null = null;
    let dragMode: 'pan' | 'move' | 'build' = 'pan';
    let dragSource: Cell | null = null;
    /** Where a belt drag started, i.e. the first cell of the run being drawn. */
    let runAnchor: Cell | null = null;

    /**
     * Cursor moved by (dxCss, dyCss) pixels: translate the camera so the map
     * travels with it (content follows the cursor, 1:1, foreshortening included).
     */
    function panByCursorDelta(dxCss: number, dyCss: number): void {
      const { height } = viewport();
      const delta = screenToGroundDelta(-dxCss, -dyCss, camState.zoom / height);
      camState = panCamera(camState, delta.x, delta.z, bounds);
      applyCamera();
    }

    function onPointerDown(event: PointerEvent): void {
      dragging = true;
      dragMoved = false;
      dragButton = event.button;
      downX = lastX = event.clientX;
      downY = lastY = event.clientY;
      dragAnchor = raycastGround(event);
      // Shift + drag relocates the machine under the cursor instead of panning.
      // The source is captured here, not on drop: the camera must stay put while
      // dragging, or the cell under the cursor would slide away from the machine
      // the player grabbed.
      const shiftClick = event.shiftKey && event.button === 0;
      const grabbed = shiftClick ? raycastCell(event) : null;
      dragSource = grabbed && sim.entityAt(grabbed) ? grabbed : null;

      // Drag with the belt tool armed and the drag lays a run of belts. Belts only:
      // a row of smelters is a mistake, and for every other tool a click means one
      // machine, so dragging stays available for the camera.
      const tool = useUiStore.getState().selectedTool;
      runAnchor = !shiftClick && event.button === 0 && tool === 'belt' ? raycastCell(event) : null;

      dragMode = dragSource ? 'move' : runAnchor ? 'build' : 'pan';
      canvas.setPointerCapture(event.pointerId);
    }

    /** Reverses the last edit. Shared by the keyboard shortcut and the button. */
    function undoLastEdit(): void {
      if (!history.undo(sim)) {
        syncUndo();
        return;
      }
      syncUndo();
      syncMeshes();
      saveForced();
      pushSnapshot(sim.snapshot());
      pushSnapshot.flush();
      // The undo may have removed the machine the panel is describing, or put
      // one back, so the panel is re-read from the world rather than trusted.
      refreshSelection();
      applySelectionHighlight();
    }

    function onPointerMove(event: PointerEvent): void {
      if (dragging && dragMode === 'move') {
        if (!dragMoved && Math.abs(event.clientX - downX) + Math.abs(event.clientY - downY) > DRAG_THRESHOLD_PX) {
          dragMoved = true;
        }
        if (dragMoved) {
          // Preview the machine as itself, facing as it does, so the player sees
          // the drop before committing to it — the ghost is also what shows a
          // drop that is refused (occupied cell, extractor off a node).
          const source = dragSource;
          const entity = source ? sim.entityAt(source) : null;
          const cell = entity ? raycastCell(event) : null;
          if (source && entity && cell) {
            ghost.showAt(cell, sim.canMove(source, cell), entity.type, entity.rotation);
            updatePlacementStatus(null);
          } else {
            ghost.hide();
            updatePlacementStatus(null);
          }
          lastX = event.clientX;
          lastY = event.clientY;
          return;
        }
      }

      if (dragging && dragMode === 'build') {
        if (!dragMoved && Math.abs(event.clientX - downX) + Math.abs(event.clientY - downY) > DRAG_THRESHOLD_PX) {
          dragMoved = true;
        }
        const anchor = runAnchor;
        const cell = anchor ? raycastCell(event) : null;
        if (anchor && cell && dragMoved) {
          const run = straightRun(anchor, cell);
          const previews = sim.previewRun(run);
          const previewByCell = new Map(
            run.cells.map((at, index) => [`${at.x},${at.y}`, previews[index]]),
          );
          ghost.showRun(
            run.cells,
            run.rotation,
            (at) => previewByCell.get(`${at.x},${at.y}`) ?? sim.previewAt('belt', at.x, at.y, run.rotation),
          );
          updatePlacementStatus(runStatus(previews));
          lastX = event.clientX;
          lastY = event.clientY;
          return;
        }
      }

      if (dragging) {
        if (!dragMoved && Math.abs(event.clientX - downX) + Math.abs(event.clientY - downY) > DRAG_THRESHOLD_PX) {
          dragMoved = true;
          ghost.hide();
        }
        if (dragMoved) {
          const grabbed = dragAnchor;
          const now = grabbed ? raycastGround(event) : null;
          if (grabbed && now) {
            camState = panCamera(camState, grabbed.x - now.x, grabbed.z - now.z, bounds);
            applyCamera();
          } else {
            panByCursorDelta(event.clientX - lastX, event.clientY - lastY);
          }
          lastX = event.clientX;
          lastY = event.clientY;
          return;
        }
      }

      const tool = useUiStore.getState().selectedTool;
      if (!tool) {
        ghost.hide();
        updatePlacementStatus(null);
        return;
      }
      const cell = raycastCell(event);
      if (!cell) {
        ghost.hide();
        updatePlacementStatus(null);
        return;
      }
      const rotation = useUiStore.getState().rotation;
      const preview = sim.previewAt(tool, cell.x, cell.y, rotation);
      ghost.showAt(cell, preview, tool, rotation);
      updatePlacementStatus(preview);
    }

    function onPointerUp(event: PointerEvent): void {
      const wasDragging = dragging;
      const button = dragButton;
      const moved = dragMoved;
      const mode = dragMode;
      const source = dragSource;
      const anchor = runAnchor;
      dragging = false;
      dragMoved = false;
      dragButton = -1;
      dragAnchor = null;
      dragMode = 'pan';
      dragSource = null;
      runAnchor = null;
      if (event.type === 'pointercancel') {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        ghost.hide();
        updatePlacementStatus(null);
        return;
      }
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);

      if (mode === 'build') {
        ghost.hide();
        // A drag that never moved is a click, and falls through to place one belt.
        if (moved && anchor) {
          const cell = raycastCell(event);
          if (cell) {
            const run = straightRun(anchor, cell);
            const previews = sim.previewRun(run);
            const placed = sim.placeRun(run);
            const status = runStatus(previews);
            updatePlacementStatus(status);
            if (placed.length > 0) {
              // One drag is one edit, so it is one undo. Removing twelve belts a
              // click at a time would be its own punishment.
              history.recordRun(placed);
              syncUndo();
              saveForced();
              syncMeshes();
              pushSnapshot(sim.snapshot());
              pushSnapshot.flush();
            } else if (status?.message) {
              useUiStore.getState().showToast(status.message, 'warning');
            }
          } else {
            updatePlacementStatus(null);
          }
          return;
        }
      }

      if (mode === 'move') {
        ghost.hide();
        // A shift-click with no drag is still a click: it inspects, below.
        if (moved && source) {
          const cell = raycastCell(event);
          if (cell && sim.move(source, cell).ok) {
            history.recordMove(source, cell);
            syncUndo();
            saveForced();
            syncMeshes();
            pushSnapshot(sim.snapshot());
            pushSnapshot.flush();
            // Follow the machine: the panel should describe where it landed, not
            // the cell it left.
            useUiStore.getState().selectMachine(cell, machineInfoFor(cell));
            applySelectionHighlight();
          } else if (!cell) {
            updatePlacementStatus(null);
          }
          return;
        }
      }

      const cell = raycastCell(event);
      if (!cell) {
        // Clicked off the plot, so there is nothing to inspect. Drop the
        // selection instead of leaving a stale machine (and its demolish button)
        // on screen for a cell the player is no longer pointing at.
        updatePlacementStatus(null);
        if (button === 0) {
          useUiStore.getState().clearSelection();
          applySelectionHighlight();
        }
        return;
      }

      if (!wasDragging || moved) {
        if (moved) updatePlacementStatus(null);
        return;
      }

      if (button === 2) {
        updatePlacementStatus(null);
        demolishAt(cell);
        return;
      }
      if (button !== 0) {
        updatePlacementStatus(null);
        return;
      }

      const tool = useUiStore.getState().selectedTool;
      if (!tool) {
        // No build tool: clicking inspects the cell.
        updatePlacementStatus(null);
        useUiStore.getState().selectMachine(cell, machineInfoFor(cell));
        applySelectionHighlight();
        return;
      }

      const rotation = useUiStore.getState().rotation;
      placeAtCell(tool, cell, rotation);
    }

    function onContextMenu(event: MouseEvent): void {
      event.preventDefault();
    }

    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      // Scroll up (deltaY < 0) zooms in; zoom is the frustum height in world units.
      const nextZoom = camState.zoom + event.deltaY * WHEEL_ZOOM_STEP;
      const anchor = raycastGround(event);
      if (anchor) {
        camState = zoomAbout(camState, nextZoom, anchor, bounds);
      } else {
        camState = {
          ...camState,
          zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextZoom)),
        };
      }
      applyCamera();
    }

    function onKeyDown(event: KeyboardEvent): void {
      const key = event.key.toLowerCase();
      if (isUndoShortcut(event, key)) {
        if (globalShortcutBlocked(event.target, true)) return;
        event.preventDefault();
        undoLastEdit();
        return;
      }
      if (globalShortcutBlocked(event.target)) return;
      if (isMapKey(event.key) && hasMapModifier(event)) return;
      if (key === 'r') {
        if (rotateKeyboardTool()) event.preventDefault();
        return;
      }
      if (key === 'x') {
        const cell = useUiStore.getState().keyboardCursor;
        if (!cell) return;
        event.preventDefault();
        demolishAt(cell);
        updateKeyboardPreview(cell);
        return;
      }
      if (key === 'escape') {
        if (!useUiStore.getState().selectedTool) return;
        event.preventDefault();
        clearKeyboardTool();
        return;
      }
      if (key.startsWith('arrow')) {
        event.preventDefault();
        return;
      }
      if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
        event.preventDefault();
        pressed.add(key);
      }
    }

    function onKeyUp(event: KeyboardEvent): void {
      pressed.delete(event.key.toLowerCase());
    }

    function onBlur(): void {
      pressed.clear();
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        pause.hide(hiddenAt);
        pushSnapshot.flush();
        saveForced();
        // The forced save counts: the next autosave is a full interval away.
        return;
      }

      // Back in view: a paused factory has not been producing, so the time it
      // spent hidden is credited exactly like an absence.
      const now = Date.now();
      const awaySec = pause.show(now);
      if (awaySec <= 0) {
        hiddenAt = null;
        return;
      }

      const resume = resumeFromSave(
        sim.chains(),
        hiddenAt ?? now - awaySec * 1000,
        now,
        sim.prestigeState().permanentMultipliers.sellValue,
      );
      hiddenAt = null;
      sim.creditOffline(resume.report);
      if (resume.showModal) useUiStore.getState().showOffline(resume.report);
      saveForced();

      // Start the frame delta from here, so the hidden stretch is not handed to
      // the tick clock as one enormous frame.
      lastTick = performance.now();
      clock.reset();
      syncMeshes();
      pushSnapshot(sim.snapshot());
      pushSnapshot.flush();
    }

    function onPageHide(): void {
      saveForced();
    }

    canvas.addEventListener('keydown', onCanvasKeyDown);
    canvas.addEventListener('focus', onCanvasFocus);
    canvas.addEventListener('blur', onCanvasBlur);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    cleanupCallbacks.push(() => {
      canvas.removeEventListener('keydown', onCanvasKeyDown);
      canvas.removeEventListener('focus', onCanvasFocus);
      canvas.removeEventListener('blur', onCanvasBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    });

    // --- sim loop (fixed timestep, decoupled from rAF) -------------------------

    const pushSnapshot = createThrottledPush<SimSnapshot>({
      apply: (snapshot) => {
        applySnapshot(snapshot);
        refreshSelection();
      },
      hz: UI_HZ,
      now: () => performance.now(),
    });

    const SIM_INTERVAL_MS = 1000 / TICK_HZ;
    // The clock owns how much factory time passes; this timer only asks it.
    const clock = createFixedStepClock();
    // Autosave rides those same steps, so its cadence follows the factory.
    const saveSchedule = createSaveSchedule();

    function saveForced(): boolean {
      return runForcedSave(saveNow, saveSchedule);
    }

    // A hidden tab pauses the factory; the time away is credited on return.
    const pause = createPauseTracker();
    let hiddenAt: number | null = null;
    let lastTick = performance.now();
    let lastSync = 0;

    const simTimer = window.setInterval(() => {
      const now = performance.now();
      const elapsedSec = (now - lastTick) / 1000;
      lastTick = now;
      // Paused: no ticks, and no frame delta banked for later.
      if (pause.isHidden() || useUiStore.getState().paused) return;

      const steps = clock.advance(elapsedSec);

      if (steps > 0) {
        for (let step = 0; step < steps; step++) sim.tick();

        // Items ride the belts, so meshes are re-synced at UI rate, not per frame.
        if (now - lastSync >= SIM_INTERVAL_MS) {
          lastSync = now;
          syncMeshes();
        }
        pushSnapshot(sim.snapshot());
      }

      if (saveSchedule.advance(steps * FIXED_DT)) saveNow();
    }, SIM_INTERVAL_MS);
    cleanupCallbacks.push(() => window.clearInterval(simTimer));

    useUiStore.getState().registerActions({
      demolishSelected: () => {
        const cell = useUiStore.getState().inspectedCell;
        if (!cell) return;
        demolishAt(cell);
      },
      togglePause: () => {
        const nextPaused = !useUiStore.getState().paused;
        useUiStore.getState().setPaused(nextPaused);
        if (nextPaused) {
          pushSnapshot.flush();
          useUiStore.getState().showToast('Factory paused', 'info');
          saveForced();
          return;
        }
        lastTick = performance.now();
        clock.reset();
        useUiStore.getState().showToast('Factory resumed', 'success');
      },
      undo: () => undoLastEdit(),
      prestige: () => {
        const result = sim.prestige();
        // A refusal costs nothing. The button is disabled below the threshold, and
        // this is the sim's own guard against a click that would trade a working
        // factory for nothing.
        if (result.ok) {
          // The edits being undone were made to the factory that was just spent,
          // so undoing them afterwards would resurrect it item by item.
          history.clear();
          syncUndo();
          useUiStore.getState().clearSelection();
          syncMeshes();
          saveForced();
        }
        pushSnapshot(sim.snapshot());
        pushSnapshot.flush();
      },
      restart: () => {
        sim.restart();
        history.clear();
        syncUndo();
        // Dropped *before* the fresh save is written. The write below (and the
        // save-on-unload) already covers the normal path — this is for a write
        // that fails, so a player who threw their factory away cannot have it
        // resurrected by a reload.
        if (storage) {
          try {
            clearSave(storage);
          } catch {}
        }
        // Otherwise the ticks queued while the player was in the confirm dialog
        // would all land on the new factory at once.
        clock.reset();
        lastTick = performance.now();
        useUiStore.getState().clearSelection();
        syncMeshes();
        saveForced();
        pushSnapshot(sim.snapshot());
        pushSnapshot.flush();
      },
      unlockNode: (id) => {
        const result = sim.unlock(id);
        // A refusal (already owned, missing prerequisite, too poor) costs nothing,
        // so the push is the only thing to do either way.
        if (result.ok) {
          syncMeshes();
          useUiStore.getState().showToast(`Unlocked ${result.node.label}`, 'success');
          saveForced();
        }
        pushSnapshot(sim.snapshot());
        pushSnapshot.flush();
        useUiStore.getState().setUnlocks(sim.unlocks());
      },
      upgradeSelected: () => {
        const cell = useUiStore.getState().inspectedCell;
        if (!cell) return;
        const result = sim.upgrade(cell);
        // Refusals (empty cell, maxed out, too poor) cost nothing either.
        if (result.ok) saveForced();
        pushSnapshot(sim.snapshot());
        pushSnapshot.flush();
        refreshSelection();
      },
      buyExpansion: () => {
        const result = sim.buyExpansion();
        // Refusals (maxed, too poor) cost nothing; the plot in the snapshot
        // either grew or didn't, and applySnapshot rebuilds the grid for it.
        if (result.ok) saveForced();
        pushSnapshot(sim.snapshot());
        pushSnapshot.flush();
      },
    });

    useUiStore.getState().setBackend(backend);
    syncUndo();
    syncMeshes();
    pushSnapshot(sim.snapshot());
    pushSnapshot.flush();
    lastTick = performance.now();
    let lastFrame = performance.now();
    let frameHandle = 0;

    function frame(now: number): void {
      frameHandle = requestAnimationFrame(frame);
      const elapsed = Math.min((now - lastFrame) / 1000, 0.25);
      lastFrame = now;

      if (pressed.size > 0) {
        const { height } = viewport();
        const pxPerWorld = height / camState.zoom;
        const step = KEY_PAN_SPEED * elapsed * pxPerWorld;
        let contentX = 0;
        let contentY = 0;
        // Keys move the camera: W looks north, so content slides down the screen.
        if (pressed.has('w')) contentY += step;
        if (pressed.has('s')) contentY -= step;
        if (pressed.has('a')) contentX += step;
        if (pressed.has('d')) contentX -= step;
        if (contentX !== 0 || contentY !== 0) panByCursorDelta(contentX, contentY);
      }

      renderer.render(scene, camera);
    }

    frameHandle = requestAnimationFrame(frame);
    cleanupCallbacks.push(() => cancelAnimationFrame(frameHandle));

    return {
      backend,
      dispose({ save = true }: SceneDisposeOptions = {}): void {
        if (save) saveForced();
        pushSnapshot.flush();
        runCleanup();
      },
    };
  }
}

/** Faint discs under resource nodes so players can find them. */
function createNodeMarkers(): THREE.Group {
  const group = new THREE.Group();
  const nodes = generateNodes();
  for (const node of nodes) {
    // Same palette as belt cargo and the UI legend, so one source of truth.
    const color = NODE_LEGEND[node.resource];
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8 * CELL, 0.8 * CELL),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(node.x, 0.01, node.y);
    group.add(marker);
  }
  return group;
}
