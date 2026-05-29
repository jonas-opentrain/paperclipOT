import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

const TRUTHY_ENV_RE = /^(1|true|yes|on)$/i;
const COPIED_SHARED_FILES = ["config.json", "config.toml", "instructions.md"] as const;
const COPIED_SHARED_XDG_DIRS = ["cup", "cu"] as const;
const SYMLINKED_SHARED_FILES = ["auth.json"] as const;
const DEFAULT_PAPERCLIP_INSTANCE_ID = "default";

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function pathExists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

export function resolveSharedCodexHomeDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = nonEmpty(env.CODEX_HOME);
  return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), ".codex");
}

export function resolveSharedXdgConfigHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = nonEmpty(env.XDG_CONFIG_HOME);
  return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), ".config");
}

function isWorktreeMode(env: NodeJS.ProcessEnv): boolean {
  return TRUTHY_ENV_RE.test(env.PAPERCLIP_IN_WORKTREE ?? "");
}

export function resolveManagedCodexHomeDir(
  env: NodeJS.ProcessEnv,
  companyId?: string,
): string {
  const paperclipHome = nonEmpty(env.PAPERCLIP_HOME) ?? path.resolve(os.homedir(), ".paperclip");
  const instanceId = nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? DEFAULT_PAPERCLIP_INSTANCE_ID;
  return companyId
    ? path.resolve(paperclipHome, "instances", instanceId, "companies", companyId, "codex-home")
    : path.resolve(paperclipHome, "instances", instanceId, "codex-home");
}

export function resolveManagedCodexXdgConfigHome(
  env: NodeJS.ProcessEnv,
  companyId?: string,
): string {
  return path.join(resolveManagedCodexHomeDir(env, companyId), "xdg-config");
}

async function ensureParentDir(target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
}

async function ensureSymlink(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (!existing) {
    await ensureParentDir(target);
    await fs.symlink(source, target);
    return;
  }

  if (!existing.isSymbolicLink()) {
    return;
  }

  const linkedPath = await fs.readlink(target).catch(() => null);
  if (!linkedPath) return;

  const resolvedLinkedPath = path.resolve(path.dirname(target), linkedPath);
  if (resolvedLinkedPath === source) return;

  await fs.unlink(target);
  await fs.symlink(source, target);
}

async function ensureCopiedFile(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (existing) return;
  await ensureParentDir(target);
  await fs.copyFile(source, target);
}

async function syncCopiedDirectory(target: string, source: string): Promise<void> {
  await ensureParentDir(target);
  await fs.cp(source, target, {
    recursive: true,
    force: true,
    errorOnExist: false,
    dereference: false,
  });
}

async function resolveSharedXdgSourceDir(
  sourceHome: string,
  env: NodeJS.ProcessEnv,
  name: typeof COPIED_SHARED_XDG_DIRS[number],
): Promise<string | null> {
  const candidates = [
    path.join(resolveSharedXdgConfigHome(env), name),
    path.join(sourceHome, "xdg-config", name),
    path.join(sourceHome, ".config", name),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }

  return null;
}

export async function prepareManagedCodexHome(
  env: NodeJS.ProcessEnv,
  onLog: AdapterExecutionContext["onLog"],
  companyId?: string,
): Promise<{ codexHome: string; xdgConfigHome: string }> {
  const targetHome = resolveManagedCodexHomeDir(env, companyId);
  const targetXdgConfigHome = resolveManagedCodexXdgConfigHome(env, companyId);

  const sourceHome = resolveSharedCodexHomeDir(env);
  if (path.resolve(sourceHome) === path.resolve(targetHome)) {
    return {
      codexHome: targetHome,
      xdgConfigHome: resolveSharedXdgConfigHome(env),
    };
  }

  await fs.mkdir(targetHome, { recursive: true });
  await fs.mkdir(targetXdgConfigHome, { recursive: true });

  for (const name of SYMLINKED_SHARED_FILES) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureSymlink(path.join(targetHome, name), source);
  }

  for (const name of COPIED_SHARED_FILES) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureCopiedFile(path.join(targetHome, name), source);
  }

  for (const name of COPIED_SHARED_XDG_DIRS) {
    const source = await resolveSharedXdgSourceDir(sourceHome, env, name);
    if (!source) continue;
    await syncCopiedDirectory(path.join(targetXdgConfigHome, name), source);
  }

  await onLog(
    "stdout",
    `[paperclip] Using ${isWorktreeMode(env) ? "worktree-isolated" : "Paperclip-managed"} Codex home "${targetHome}" with XDG config "${targetXdgConfigHome}" (seeded from "${sourceHome}").\n`,
  );
  return {
    codexHome: targetHome,
    xdgConfigHome: targetXdgConfigHome,
  };
}
