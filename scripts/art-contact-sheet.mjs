import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MACHINES_DIR = join(ROOT, "public", "assets", "machines");
const RESOURCES_DIR = join(ROOT, "public", "assets", "resources");
const OUT_DIR = join(ROOT, ".art-preview");
const BACKDROP = "#2a2a2a";
const FRAME_SUFFIXES = ["-idle", "-active", "-active-1"];

function requireTool(tool, args) {
  try {
    execFileSync(tool, args, { stdio: "ignore" });
  } catch {
    console.error(`${tool} is required for the art contact sheet but is not runnable.`);
    process.exit(1);
  }
}

function listSvgFiles(dir) {
  return readdirSync(dir)
    .filter((name) => extname(name) === ".svg")
    .sort();
}

function renderTile(svgPath, pngPath, zoom) {
  execFileSync("rsvg-convert", ["-b", BACKDROP, "-z", String(zoom), svgPath, "-o", pngPath]);
}

function appendHorizontally(paths, target) {
  execFileSync("magick", [...paths, "+append", target]);
}

function appendVertically(paths, target) {
  execFileSync("magick", [...paths, "-append", target]);
}

function groupMachineFrames(files) {
  const byMachine = new Map();

  for (const name of files) {
    const stem = basename(name, ".svg");
    const suffix = FRAME_SUFFIXES.find((candidate) => stem.endsWith(candidate));
    if (suffix === undefined) {
      continue;
    }
    const machine = stem.slice(0, -suffix.length);
    const frames = byMachine.get(machine) ?? new Map();
    frames.set(suffix, name);
    byMachine.set(machine, frames);
  }

  return [...byMachine.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([machine, frames]) => ({
      machine,
      frames: FRAME_SUFFIXES.map((suffix) => frames.get(suffix)).filter((name) => name !== undefined),
    }))
    .filter((entry) => entry.frames.length === FRAME_SUFFIXES.length);
}

function buildMachineAnimationSheet(machineRows) {
  const rowPaths = [];

  for (const { machine, frames } of machineRows) {
    const framePaths = frames.map((name) => join(OUT_DIR, `machine-${basename(name, ".svg")}.png`));
    const rowPath = join(OUT_DIR, `row-${machine}.png`);
    appendHorizontally(framePaths, rowPath);
    rowPaths.push(rowPath);
  }

  const target = join(OUT_DIR, "machines-animation.png");
  appendVertically(rowPaths, target);
  return target;
}

function buildSilhouetteSheet(machineRows, rotate) {
  const paths = machineRows.map(({ frames }) => {
    const idle = join(OUT_DIR, `machine-${basename(frames[0], ".svg")}.png`);
    if (!rotate) {
      return idle;
    }
    const rotated = join(OUT_DIR, `rotated-${basename(frames[0], ".svg")}.png`);
    execFileSync("magick", [idle, "-rotate", "90", rotated]);
    return rotated;
  });

  const target = join(OUT_DIR, rotate ? "machines-rotated-90.png" : "machines-silhouettes.png");
  appendHorizontally(paths, target);
  return target;
}

function buildResourceSheet() {
  const names = listSvgFiles(RESOURCES_DIR);
  const paths = names.map((name) => join(OUT_DIR, `resource-${basename(name, ".svg")}.png`));
  const perRow = 5;
  const rowPaths = [];

  for (let start = 0; start < paths.length; start += perRow) {
    const rowPath = join(OUT_DIR, `resource-row-${rowPaths.length}.png`);
    appendHorizontally(paths.slice(start, start + perRow), rowPath);
    rowPaths.push(rowPath);
  }

  const target = join(OUT_DIR, "resources.png");
  appendVertically(rowPaths, target);
  return target;
}

function main() {
  requireTool("rsvg-convert", ["--version"]);
  requireTool("magick", ["--version"]);

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  for (const name of listSvgFiles(MACHINES_DIR)) {
    renderTile(join(MACHINES_DIR, name), join(OUT_DIR, `machine-${basename(name, ".svg")}.png`), 4);
  }
  for (const name of listSvgFiles(RESOURCES_DIR)) {
    renderTile(join(RESOURCES_DIR, name), join(OUT_DIR, `resource-${basename(name, ".svg")}.png`), 6);
  }

  const machineRows = groupMachineFrames(listSvgFiles(MACHINES_DIR));
  const incomplete = listSvgFiles(MACHINES_DIR).filter(
    (name) => !machineRows.some((row) => row.frames.includes(name)),
  );

  const sheets = [
    buildMachineAnimationSheet(machineRows),
    buildSilhouetteSheet(machineRows, false),
    buildSilhouetteSheet(machineRows, true),
    buildResourceSheet(),
  ];

  console.log(`Rendered ${machineRows.length} machines and ${listSvgFiles(RESOURCES_DIR).length} resources.`);
  for (const sheet of sheets) {
    console.log(sheet.replace(`${ROOT}/`, ""));
  }
  if (incomplete.length > 0) {
    console.error(`Machine files outside the idle/active/active-1 set: ${incomplete.join(", ")}`);
    process.exit(1);
  }
}

main();
