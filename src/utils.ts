import { createHash } from "node:crypto";
import { access, cp, lstat, mkdir, readFile, readdir, readlink, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { CliError } from "./errors";

export const MANIFEST_FILE = "skills.yaml";
export const LOCK_FILE = "skills.lock";
export const ALLOW_UNSAFE_PATHS_ENV = "SKILLS_ALLOW_UNSAFE_PATHS";

export async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true });
}

export async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const info = await stat(targetPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function readDocument<T>(targetPath: string): Promise<T> {
  const raw = await readFile(targetPath, "utf8");
  return parseYaml(raw) as T;
}

export async function writeYamlDocument(targetPath: string, value: unknown): Promise<void> {
  const contents = stringifyYaml(value, {
    indent: 2,
    lineWidth: 0,
    minContentWidth: 0,
    defaultKeyType: "QUOTE_DOUBLE"
  });
  await writeFile(targetPath, contents, "utf8");
}

export interface CopyDirOptions {
  dereference?: boolean;
}

export interface CleanupRootOptions {
  containmentRoot?: string;
  label?: string;
}

export async function copyDir(source: string, destination: string, options: CopyDirOptions = {}): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true, dereference: options.dereference ?? false });
}

export async function resolveCleanupRoot(rootDir: string, options: CleanupRootOptions = {}): Promise<string> {
  const resolvedRootDir = await resolvePathForContainment(rootDir);
  if (options.containmentRoot) {
    await assertPathWithinRootReal(
      options.containmentRoot,
      resolvedRootDir,
      options.label ?? `cleanup root ${rootDir}`
    );
  }
  return resolvedRootDir;
}

export async function removeStaleRootEntries(
  rootDir: string,
  desiredEntries: Iterable<string>,
  options: CleanupRootOptions = {}
): Promise<void> {
  if (!(await exists(rootDir))) {
    return;
  }

  const resolvedRootDir = await resolveCleanupRoot(rootDir, options);
  const desired = new Set(desiredEntries);
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    if (desired.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(rootDir, entry.name);
    if (!entry.isSymbolicLink()) {
      await assertPathWithinRootReal(resolvedRootDir, entryPath, `cleanup entry ${entry.name} in ${rootDir}`);
    }
    await rm(entryPath, { recursive: true, force: true });
  }
}

export function normalizeRelativePath(cwd: string, targetPath: string): string {
  const absolute = path.resolve(cwd, targetPath);
  const relative = path.relative(cwd, absolute);
  if (!relative || relative === ".") {
    return ".";
  }
  return relative.startsWith(".") ? relative : `./${relative}`;
}

export function sanitizeSkillId(skillId: string): string {
  const sanitized = skillId
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment === "." || segment === ".." ? "_" : segment.replace(/[^A-Za-z0-9._-]/g, "_")))
    .join("__");
  return sanitized || "skill";
}

export function isResolvedSkillVersion(version: string): boolean {
  return version === "unversioned" || (semver.valid(version) !== null && semver.clean(version) === version);
}

export function sanitizeInstalledSkillVersion(version: string): string {
  const sanitized = version
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment === "." || segment === ".." ? "_" : segment.replace(/[^A-Za-z0-9._-]/g, "_")))
    .join("_");
  return sanitized || "unversioned";
}

export function buildInstalledEntryName(skillId: string, version: string): string {
  return `${sanitizeSkillId(skillId)}@${sanitizeInstalledSkillVersion(version)}`;
}

export function detectPlatformOs(): "darwin" | "linux" | "win32" {
  if (os.platform() === "darwin") {
    return "darwin";
  }
  if (os.platform() === "win32") {
    return "win32";
  }
  return "linux";
}

export function formatSkillVersion(version?: string, isPath = false): string {
  if (isPath) {
    return "(path)";
  }
  return version ?? "*";
}

export function resolveFileUrlOrPath(baseDir: string, value: string): string {
  if (value.startsWith("file://")) {
    return fileURLToPath(new URL(value));
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(baseDir, value);
}

export function allowsUnsafePaths(): boolean {
  return process.env[ALLOW_UNSAFE_PATHS_ENV] === "1";
}

export function isPathWithinRoot(rootDir: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertPathWithinRoot(rootDir: string, targetPath: string, label: string): void {
  if (!allowsUnsafePaths() && !isPathWithinRoot(rootDir, targetPath)) {
    throw new CliError(
      `${label} resolves outside ${rootDir}. Set ${ALLOW_UNSAFE_PATHS_ENV}=1 to opt in.`,
      2
    );
  }
}

export function isExplicitAbsolutePath(value: string): boolean {
  return value.startsWith("file://") || path.isAbsolute(value);
}

export function assertConfiguredPathWithinRoot(rootDir: string, configuredValue: string, resolvedPath: string, label: string): void {
  void configuredValue;
  assertPathWithinRoot(rootDir, resolvedPath, label);
}

async function resolvePathForContainment(targetPath: string): Promise<string> {
  const absolutePath = path.resolve(targetPath);
  try {
    return await realpath(absolutePath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }

    const parentPath = path.dirname(absolutePath);
    if (parentPath === absolutePath) {
      return absolutePath;
    }
    const resolvedParentPath = await resolvePathForContainment(parentPath);
    return path.join(resolvedParentPath, path.basename(absolutePath));
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function isPathWithinRootReal(rootDir: string, targetPath: string): Promise<boolean> {
  const [resolvedRootDir, resolvedTargetPath] = await Promise.all([
    resolvePathForContainment(rootDir),
    resolvePathForContainment(targetPath)
  ]);
  const relative = path.relative(resolvedRootDir, resolvedTargetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function assertPathWithinRootReal(rootDir: string, targetPath: string, label: string): Promise<void> {
  if (!allowsUnsafePaths() && !(await isPathWithinRootReal(rootDir, targetPath))) {
    throw new CliError(
      `${label} resolves outside ${rootDir}. Set ${ALLOW_UNSAFE_PATHS_ENV}=1 to opt in.`,
      2
    );
  }
}

export async function assertConfiguredPathWithinRootReal(
  rootDir: string,
  configuredValue: string,
  resolvedPath: string,
  label: string
): Promise<void> {
  void configuredValue;
  await assertPathWithinRootReal(rootDir, resolvedPath, label);
}

export async function hasSkillRootMarker(skillRoot: string): Promise<boolean> {
  return (await exists(path.join(skillRoot, "skill.yaml"))) || (await exists(path.join(skillRoot, "SKILL.md")));
}

export async function assertSkillRootMarker(skillRoot: string, label: string): Promise<void> {
  if (!allowsUnsafePaths() && !(await hasSkillRootMarker(skillRoot))) {
    throw new CliError(
      `${label} must contain SKILL.md or skill.yaml. Set ${ALLOW_UNSAFE_PATHS_ENV}=1 to opt in.`,
      2
    );
  }
}

export async function assertNoSymlinksInTree(rootDir: string, label: string): Promise<void> {
  await assertNoSymlinksInTreeRecursive(rootDir, ".", label);
}

export async function hashDirectoryContents(rootDir: string): Promise<string> {
  const hash = createHash("sha256");
  await appendDirectoryDigest(hash, rootDir, ".", new Set<string>());
  return `sha256:${hash.digest("hex")}`;
}

async function appendDirectoryDigest(
  hash: ReturnType<typeof createHash>,
  rootDir: string,
  relativeDir: string,
  activeRealPaths: Set<string>
): Promise<void> {
  const currentDir = relativeDir === "." ? rootDir : path.join(rootDir, relativeDir);
  const realDir = await realpath(currentDir);
  if (activeRealPaths.has(realDir)) {
    throw new CliError(`Unable to hash ${rootDir}: recursive directory cycle detected at ${currentDir}`, 2);
  }

  activeRealPaths.add(realDir);
  hash.update(`dir ${normalizeDigestPath(relativeDir)}\n`);

  const entries = (await readdir(currentDir, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const entryName of entries) {
    const relativeEntry = relativeDir === "." ? entryName : path.posix.join(relativeDir, entryName);
    const absoluteEntry = path.join(currentDir, entryName);
    const entryInfo = await stat(absoluteEntry);

    if (entryInfo.isDirectory()) {
      await appendDirectoryDigest(hash, rootDir, relativeEntry, activeRealPaths);
      continue;
    }

    if (entryInfo.isFile()) {
      hash.update(`file ${normalizeDigestPath(relativeEntry)} ${entryInfo.size}\n`);
      hash.update(await readFile(absoluteEntry));
      hash.update("\n");
      continue;
    }

    hash.update(`other ${normalizeDigestPath(relativeEntry)}\n`);
  }

  activeRealPaths.delete(realDir);
}

function normalizeDigestPath(value: string): string {
  return value.replaceAll("\\", "/");
}

async function assertNoSymlinksInTreeRecursive(rootDir: string, relativePath: string, label: string): Promise<void> {
  const absolutePath = relativePath === "." ? rootDir : path.join(rootDir, relativePath);
  const info = await lstat(absolutePath);
  if (info.isSymbolicLink()) {
    const linkTarget = await readlink(absolutePath);
    throw new CliError(
      `${label} contains a symbolic link at ${relativePath} -> ${linkTarget}. Provider recovery rejects symlinks before caching.`,
      2
    );
  }

  if (!info.isDirectory()) {
    return;
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  for (const entry of entries) {
    const childRelativePath = relativePath === "." ? entry.name : path.posix.join(relativePath, entry.name);
    if (entry.isSymbolicLink()) {
      const linkTarget = await readlink(path.join(absolutePath, entry.name));
      throw new CliError(
        `${label} contains a symbolic link at ${childRelativePath} -> ${linkTarget}. Provider recovery rejects symlinks before caching.`,
        2
      );
    }
    if (entry.isDirectory()) {
      await assertNoSymlinksInTreeRecursive(rootDir, childRelativePath, label);
    }
  }
}

export function printInfo(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function printWarning(message: string): void {
  process.stdout.write(`! ${message}\n`);
}

export function printSuccess(message: string): void {
  process.stdout.write(`✔ ${message}\n`);
}

export function printError(message: string): void {
  process.stderr.write(`✖ ${message}\n`);
}

export function assertCondition(condition: unknown, message: string, exitCode = 2): asserts condition {
  if (!condition) {
    throw new CliError(message, exitCode);
  }
}
