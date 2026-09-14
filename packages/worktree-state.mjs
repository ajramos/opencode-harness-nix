import {
  constants, openSync, closeSync, readFileSync, writeFileSync, fsyncSync,
  lstatSync, fstatSync, mkdirSync, renameSync, unlinkSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { worktreeInfo } from './worktree-safety.mjs';

function statePath(directory, create = false) {
  const root = join(worktreeInfo(directory).main, '.opencode');
  if (create) mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    if (!lstatSync(root).isDirectory()) throw new Error(`Unsafe worktree state directory: ${root}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return join(root, 'worktree-session-state.json');
}

function readState(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ENOENT') return { sessions: {} };
    throw new Error(`Cannot read worktree state at ${path}: ${error.code}`);
  }
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`Invalid worktree state file: ${path}`);
    const contents = readFileSync(fd, 'utf8');
    let state;
    try { state = JSON.parse(contents); } catch {
      throw new Error(`Invalid worktree state JSON at ${path}; repair it before retrying`);
    }
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!record(state) || !record(state.sessions) || Object.entries(state.sessions).some(
      ([id, session]) => !record(session) || session.sessionId !== id,
    )) throw new Error(`Invalid worktree state schema at ${path}; repair it before retrying`);
    return state;
  } finally { closeSync(fd); }
}

// Keep the descriptor open until release: its inode cannot be reused by a new owner.
function unlinkOwned(path, fd) {
  let current;
  try { current = lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const owned = fstatSync(fd);
  if (current.dev === owned.dev && current.ino === owned.ino) unlinkSync(path);
}

function mutateSession(directory, sessionId, patch) {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('Invalid worktree state session ID');
  const path = statePath(directory, true);
  const lock = `${path}.lock`;
  const deadline = performance.now() + 2000;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  let lockFd;
  while (lockFd === undefined) {
    try { lockFd = openSync(lock, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (performance.now() >= deadline) throw new Error(`Worktree state lock timed out: ${lock}; another writer or stale lock requires attention`);
      Atomics.wait(wait, 0, 0, 20);
    }
  }
  let temporary;
  let tempFd;
  try {
    writeFileSync(lockFd, JSON.stringify({ pid: process.pid, token: randomUUID() }));
    // The read, merge/delete, and atomic replacement all belong to this lock.
    const state = readState(path);
    const exists = Object.hasOwn(state.sessions, sessionId);
    if (patch === undefined) {
      if (!exists) return;
      delete state.sessions[sessionId];
    } else {
      const previous = exists ? state.sessions[sessionId] : { createdAt: Date.now() };
      state.sessions = { ...state.sessions, [sessionId]: { ...previous, ...patch, sessionId } };
    }
    temporary = `${path}.${randomUUID()}.tmp`;
    tempFd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(tempFd, JSON.stringify(state, null, 2));
    fsyncSync(tempFd);
    renameSync(temporary, path);
  } finally {
    try {
      if (tempFd !== undefined) {
        try { unlinkOwned(temporary, tempFd); } finally { closeSync(tempFd); }
      }
    } finally {
      try { unlinkOwned(lock, lockFd); } finally { closeSync(lockFd); }
    }
  }
}

export function getSession(directory, sessionId) {
  const state = readState(statePath(directory));
  return Object.hasOwn(state.sessions, sessionId) ? state.sessions[sessionId] : undefined;
}

export function upsertSession(directory, sessionId, patch = {}) {
  mutateSession(directory, sessionId, patch);
}

export function deleteSession(directory, sessionId) {
  mutateSession(directory, sessionId);
}
