import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, realpath, readFile, mkdir, open, unlink } from 'node:fs/promises';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

export function worktreeInfo(directory) {
  const path = realpathSync(git(directory, 'rev-parse', '--show-toplevel'));
  const entries = git(directory, 'worktree', 'list', '--porcelain', '-z').split('\0');
  const main = realpathSync(entries[0].slice('worktree '.length));
  return { path, main, linked: path !== main, branch: git(path, 'branch', '--show-current') };
}

export function mainRepo(directory) {
  try {
    const info = worktreeInfo(directory);
    return info.linked ? info.main : null;
  } catch {
    return null;
  }
}

const fingerprint = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function verifiedIncludeCopies(main, worktree, copies) {
  const verified = new Set();
  for (const copy of Array.isArray(copies) ? copies : []) {
    const relative = copy?.path;
    if (typeof relative !== 'string' || isAbsolute(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) continue;
    if (copy.worktree !== worktree) continue;
    const source = join(main, relative);
    const target = join(worktree, relative);
    try {
      if (!lstatSync(source).isFile() || !lstatSync(target).isFile()) continue;
      if (realpathSync(source) !== source || realpathSync(target) !== target) continue;
      if (fingerprint(source) !== copy.sha256 || fingerprint(target) !== copy.sha256) continue;
      verified.add(relative);
    } catch {
      // Missing or changed files are not safe to discard.
    }
  }
  return verified;
}

export function safeCleanup(directory, path, branch, includeCopies = []) {
  try {
    const info = worktreeInfo(path);
    if (!info.linked || info.path !== realpathSync(path) || info.main !== worktreeInfo(directory).main || info.branch !== branch) {
      throw new Error('Refusing cleanup: worktree identity does not match Git metadata');
    }
    if (git(path, 'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none')) {
      throw new Error('Refusing cleanup: pending changes; commit or discard them explicitly');
    }
    const ignored = git(path, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z').split('\0').filter(Boolean);
    const disposable = verifiedIncludeCopies(info.main, info.path, includeCopies);
    if (ignored.some(relative => !disposable.has(relative))) {
      throw new Error('Refusing cleanup: unknown or modified ignored files exist; preserve or remove them explicitly');
    }
    // No fetch or push: fail closed against locally known remote-tracking history.
    if (git(path, 'rev-list', '--count', 'HEAD', '--not', '--remotes') !== '0') {
      throw new Error('Refusing cleanup: unpushed commits (or no local remote-tracking evidence)');
    }
    git(info.main, 'worktree', 'remove', '--', info.path);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function containedFile(root, relative, destination = false) {
  const parts = relative.split('/');
  let path = root;
  for (let i = 0; i < parts.length; i++) {
    path = join(path, parts[i]);
    let stat;
    try { stat = await lstat(path); } catch (error) {
      if (destination && error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) {
      throw new Error(`Unsafe include path: ${relative}`);
    }
    if (i === parts.length - 1 && (!stat.isFile() || destination)) {
      throw new Error(`Include must be a regular source file and a new destination: ${relative}`);
    }
  }
  return path;
}

export async function copyIncludes(directory, worktree) {
  const source = await realpath(worktreeInfo(directory).main);
  const target = await realpath(worktree);
  if (!worktreeInfo(target).linked || worktreeInfo(target).main !== source) {
    throw new Error('Include destination is not a linked worktree of this repository');
  }
  let manifest;
  try { manifest = await containedFile(source, '.worktreeinclude'); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const entries = [...new Set((await readFile(manifest, 'utf8')).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')))];
  const files = [];
  for (const entry of entries) {
    if (isAbsolute(entry) || /[\\\x00-\x1f*?\[\]{}!]/.test(entry) || entry.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
      throw new Error(`Invalid literal include path: ${entry}`);
    }
    for (const root of [source, target]) {
      if (git(root, '--literal-pathspecs', 'ls-files', '--', entry)) throw new Error(`Tracked include forbidden: ${entry}`);
      git(root, 'check-ignore', '--quiet', '--', entry);
    }
    files.push({ entry, from: await containedFile(source, entry), to: await containedFile(target, entry, true) });
  }
  // Validate every entry before copying; never overwrite an existing destination.
  const created = [];
  const copies = [];
  try {
    for (const { entry, from, to } of files) {
      await mkdir(dirname(to), { recursive: true });
      await containedFile(target, entry, true);
      const input = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await input.stat();
        if (!stat.isFile()) throw new Error(`Invalid include source: ${entry}`);
        const output = await open(to, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        created.push(to);
        try {
          const content = await input.readFile();
          await output.writeFile(content);
          copies.push({ path: entry, sha256: createHash('sha256').update(content).digest('hex'), worktree: target });
        } finally { await output.close(); }
      } finally { await input.close(); }
    }
  } catch (error) {
    for (const path of created.reverse()) await unlink(path);
    throw error;
  }
  return copies;
}
