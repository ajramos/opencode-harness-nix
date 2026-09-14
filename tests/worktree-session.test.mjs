import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import fsSync from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

// Do not inherit user hooks, repository overrides, or network access in fixtures.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_') || name.startsWith('OPENCODE_POST_CMD')) delete process.env[name];
}
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_ALLOW_PROTOCOL = 'file';

// Exercise the shipped bundle, exposing internals only in this in-memory test module.
const bundle = resolve(process.env.WORKTREE_PLUGIN);
let source = await fs.readFile(bundle, 'utf8');
for (const helper of ['worktree-safety.mjs', 'worktree-state.mjs']) {
  source = source.replace(`./${helper}`, pathToFileURL(join(resolve(bundle, '..'), helper)).href);
}
source += '\nexport { cleanupWorktree, getMainRepoFromWorktree, getSession, upsertSession, deleteSession };\nexport const setLauncher = (fn) => { openOpencodeInDefaultTerminal = fn; };';
const plugin = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

async function fixture(t, name = 'main') {
  const root = await fs.mkdtemp(join(tmpdir(), 'harness-worktree-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const main = join(root, name);
  await fs.mkdir(main);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(main, 'init', '-b', 'main');
  await fs.writeFile(join(main, '.gitignore'), '.opencode/\nconfig.env\n.claude/settings.local.json\n');
  await fs.writeFile(join(main, 'tracked'), 'original\n');
  await fs.writeFile(join(main, '.worktreeinclude'), '# synthetic fixtures only\n\nconfig.env\n.claude/settings.local.json\n');
  git(main, 'add', '.');
  // Plumbing creates fixture history, never commits or pushes user work.
  const tree = git(main, 'write-tree');
  const head = git(main, 'commit-tree', tree, '-m', 'fixture');
  git(main, 'update-ref', 'refs/heads/main', head);
  git(main, 'update-ref', 'refs/remotes/origin/main', head);
  const wt = join(root, 'linked');
  git(main, 'worktree', 'add', '-b', 'topic', wt);
  // Prevent the unpatched implementation from committing/pushing even fixture files.
  await fs.writeFile(join(main, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  await fs.mkdir(join(main, '.claude'));
  await fs.writeFile(join(main, 'config.env'), 'SYNTHETIC=value\n', { mode: 0o600 });
  await fs.writeFile(join(main, '.claude/settings.local.json'), '{"synthetic":true}\n');
  const toasts = [];
  const commands = [];
  const client = { tui: { showToast: async ({ body }) => toasts.push(body), executeCommand: async (value) => commands.push(value) } };
  return { root, main, wt, git, head, client, toasts, commands };
}

for (const kind of ['tracked', 'untracked', 'staged']) {
  test(`cleanup refuses ${kind} changes without staging or committing`, async (t) => {
    const f = await fixture(t);
    await fs.writeFile(join(f.wt, kind === 'untracked' ? 'new-file' : 'tracked'), 'pending\n');
    if (kind === 'staged') f.git(f.wt, 'add', 'tracked');
    const before = f.git(f.wt, 'status', '--porcelain');
    const result = plugin.cleanupWorktree(f.main, f.wt, 'topic');
    assert.equal(result.success, false);
    assert.match(result.error, /pending changes/i);
    assert.equal(f.git(f.wt, 'status', '--porcelain'), before);
    assert.equal(f.git(f.wt, 'rev-parse', 'HEAD'), f.head);
  });
}

test('cleanup refuses commits absent from local remote-tracking refs', async (t) => {
  const f = await fixture(t);
  const commit = f.git(f.wt, 'commit-tree', f.git(f.wt, 'write-tree'), '-p', f.head, '-m', 'unpushed');
  f.git(f.wt, 'update-ref', 'refs/heads/topic', commit);
  assert.equal(plugin.cleanupWorktree(f.main, f.wt, 'topic').success, false);
  assert.equal(f.git(f.wt, 'rev-parse', 'HEAD'), commit);
});

test('clean published worktree can be removed without deleting its branch', async (t) => {
  const f = await fixture(t);
  assert.equal(plugin.cleanupWorktree(f.main, f.wt, 'topic').success, true);
  await assert.rejects(fs.stat(f.wt), { code: 'ENOENT' });
  assert.equal(f.git(f.main, 'rev-parse', 'topic'), f.head);
});

test('locked worktree makes removal fail and session.deleted retains tracking', async (t) => {
  const f = await fixture(t);
  f.git(f.main, 'worktree', 'lock', f.wt);
  plugin.upsertSession(f.main, 's', { branch: 'topic', worktreePath: f.wt });
  const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.main, worktree: f.main, client: f.client });
  await hooks.event({ event: { type: 'session.deleted', properties: { info: { id: 's' } } } });
  assert.ok(plugin.getSession(f.main, 's'));
  assert.ok(await fs.stat(f.wt));
  assert.match(f.toasts.at(-1).message, /locked/i);
});

test('cleanup removes unchanged include copies recorded at creation', async (t) => {
  const f = await fixture(t);
  const { copyIncludes } = await import(pathToFileURL(join(resolve(bundle, '..'), 'worktree-safety.mjs')));
  const includeCopies = await copyIncludes(f.main, f.wt);
  const result = plugin.cleanupWorktree(f.main, f.wt, 'topic', includeCopies);
  assert.equal(result.success, true, result.error);
  await assert.rejects(fs.stat(f.wt), { code: 'ENOENT' });
});

test('include baseline from another worktree cannot authorize ignored-file deletion', async (t) => {
  const f = await fixture(t);
  const { copyIncludes } = await import(pathToFileURL(join(resolve(bundle, '..'), 'worktree-safety.mjs')));
  const includeCopies = await copyIncludes(f.main, f.wt);
  const other = join(f.root, 'other-linked');
  f.git(f.main, 'worktree', 'add', '-b', 'other-topic', other);
  await fs.mkdir(join(other, '.claude'));
  await fs.copyFile(join(f.main, 'config.env'), join(other, 'config.env'));
  await fs.copyFile(join(f.main, '.claude/settings.local.json'), join(other, '.claude/settings.local.json'));
  const result = plugin.cleanupWorktree(f.main, other, 'other-topic', includeCopies);
  assert.equal(result.success, false);
  assert.match(result.error, /ignored/i);
  assert.equal(await fs.readFile(join(other, 'config.env'), 'utf8'), 'SYNTHETIC=value\n');
});

for (const kind of ['modified include', 'missing include source', 'unique ignored database']) {
  test(`cleanup preserves ${kind} and its tracking`, async (t) => {
    const f = await fixture(t);
    const file = kind === 'unique ignored database' ? '.opencode/local.db' : 'config.env';
    const { copyIncludes } = await import(pathToFileURL(join(resolve(bundle, '..'), 'worktree-safety.mjs')));
    const includeCopies = kind === 'unique ignored database' ? [] : await copyIncludes(f.main, f.wt);
    const content = 'SYNTHETIC=irreplaceable\n';
    if (kind === 'unique ignored database') {
      await fs.mkdir(join(f.wt, '.opencode'));
      await fs.writeFile(join(f.wt, file), content);
    } else if (kind === 'modified include') {
      await fs.writeFile(join(f.wt, file), content);
    }
    if (kind === 'missing include source') await fs.unlink(join(f.main, 'config.env'));
    plugin.upsertSession(f.main, 's', { branch: 'topic', worktreePath: f.wt,
      includeCopies,
      pendingWorktreeDeletion: { branch: 'topic', worktreePath: f.wt } });
    const result = plugin.cleanupWorktree(f.main, f.wt, 'topic', includeCopies);
    assert.equal(result.success, false);
    assert.match(result.error, /ignored/i);
    const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.wt, worktree: f.wt, client: f.client });
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's' } } });
    const expected = kind === 'missing include source' ? 'SYNTHETIC=value\n' : content;
    assert.equal(await fs.readFile(join(f.wt, file), 'utf8'), expected);
    assert.ok(plugin.getSession(f.main, 's')?.pendingWorktreeDeletion);
    assert.equal(f.git(f.main, 'rev-parse', 'topic'), f.head);
    assert.equal(f.git(f.wt, 'ls-files', '--', file), '');
  });
}

for (const type of ['session.deleted', 'session.idle']) {
  test(`unrelated ${type} in A's checkout cannot delete A or mutate its state`, async (t) => {
    const f = await fixture(t);
    plugin.upsertSession(f.main, 'A', { branch: 'topic', worktreePath: f.wt,
      pendingWorktreeDeletion: { branch: 'topic', worktreePath: f.wt } });
    const statePath = join(f.main, '.opencode/worktree-session-state.json');
    const before = await fs.readFile(statePath, 'utf8');
    const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.wt, worktree: f.wt, client: f.client });
    await hooks.event({ event: { type, properties: { info: { id: 'B' }, sessionID: 'B' } } });
    assert.ok(await fs.stat(f.wt));
    assert.equal(await fs.readFile(statePath, 'utf8'), before);
    assert.equal(f.toasts.length, 0);
  });
}

test('automatic deletion of the exact recorded session removes only that record', async (t) => {
  const f = await fixture(t);
  plugin.upsertSession(f.main, 'A', { branch: 'topic', worktreePath: f.wt });
  plugin.upsertSession(f.main, 'B', { note: 'keep' });
  const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.wt, worktree: f.wt, client: f.client });
  await hooks.event({ event: { type: 'session.deleted', properties: { info: { id: 'A' } } } });
  await assert.rejects(fs.stat(f.wt), { code: 'ENOENT' });
  assert.equal(plugin.getSession(f.main, 'A'), undefined);
  assert.equal(plugin.getSession(f.main, 'B').note, 'keep');
});

test('Git metadata identifies arbitrary linked paths and deletion recovers missing state', async (t) => {
  const f = await fixture(t);
  assert.equal(plugin.getMainRepoFromWorktree(f.wt), await fs.realpath(f.main));
  assert.equal(plugin.getMainRepoFromWorktree(f.main), null);
  const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.wt, worktree: f.main, client: f.client });
  assert.match(await hooks.tool.deleteworktree.execute({}, { sessionID: 's' }), /scheduled/i);
  assert.ok(plugin.getSession(f.main, 's')?.pendingWorktreeDeletion);
});

test('failed idle deletion stays tracked, does not loop, and explicit retry succeeds', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.wt, 'tracked'), 'pending\n');
  plugin.upsertSession(f.main, 's', { branch: 'topic', worktreePath: f.wt, pendingWorktreeDeletion: { branch: 'topic', worktreePath: f.wt } });
  const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.wt, worktree: f.wt, client: f.client });
  const event = { event: { type: 'session.idle', properties: { sessionID: 's' } } };
  await hooks.event(event);
  assert.ok(plugin.getSession(f.main, 's')?.pendingWorktreeDeletion);
  const count = f.toasts.length;
  await hooks.event(event);
  assert.equal(f.toasts.length, count);
  await fs.writeFile(join(f.wt, 'tracked'), 'original\n');
  await hooks.tool.deleteworktree.execute({}, { sessionID: 's' });
  await hooks.event(event);
  assert.equal(plugin.getSession(f.main, 's'), undefined);
});

test('create awaits includes before launch, preserves session handoff and configuration tools', async (t) => {
  const f = await fixture(t);
  const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.main, worktree: f.main, client: f.client });
  // No network: origin is not configured, so ls-remote fails locally.
  const result = await hooks.tool.createworktree.execute({ branch: 'copy-test' }, { sessionID: 's' });
  assert.match(result, /Created worktree/);
  const state = plugin.getSession(f.main, 's');
  assert.equal(await fs.readFile(join(state.worktreePath, 'config.env'), 'utf8'), 'SYNTHETIC=value\n');
  assert.equal((await fs.stat(join(state.worktreePath, 'config.env'))).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(join(state.worktreePath, '.claude/settings.local.json'), 'utf8'), '{"synthetic":true}\n');
  assert.deepEqual(state.includeCopies.map(copy => copy.path), ['config.env', '.claude/settings.local.json']);
  let launched;
  plugin.setLauncher((path, id) => { launched = { path, id }; });
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's' } } });
  assert.deepEqual(launched, { path: state.worktreePath, id: 's' });
  assert.deepEqual(f.commands, [{ body: { command: 'session_new' } }]);
  assert.ok(hooks.tool.setterminal && hooks.tool.setpostworktree && hooks.tool.setworktreesync);
});

test('explicit cleanup removes worktree with unchanged recorded include copies', async (t) => {
  const f = await fixture(t);
  const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.main, worktree: f.main, client: f.client });
  assert.match(await hooks.tool.createworktree.execute({ branch: 'cleanup-copy' }, { sessionID: 's' }), /Created worktree/);
  const state = plugin.getSession(f.main, 's');
  plugin.setLauncher(() => {});
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's' } } });
  const worktreeHooks = await plugin.GitWorktreeSessionPlugin({ directory: state.worktreePath, worktree: state.worktreePath, client: f.client });
  assert.match(await worktreeHooks.tool.deleteworktree.execute({}, { sessionID: 's' }), /scheduled/i);
  await worktreeHooks.event({ event: { type: 'session.idle', properties: { sessionID: 's' } } });
  await assert.rejects(fs.stat(state.worktreePath), { code: 'ENOENT' }, JSON.stringify({ state: plugin.getSession(f.main, 's'), toasts: f.toasts }));
  assert.equal(plugin.getSession(f.main, 's'), undefined);
});

for (const entry of ['../escape', '/absolute', '*.env', '.git/config', 'tracked', 'missing.env']) {
  test(`invalid include ${entry} blocks launch and preserves created worktree`, async (t) => {
    const f = await fixture(t);
    await fs.writeFile(join(f.main, '.worktreeinclude'), `${entry}\n`);
    const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.main, worktree: f.main, client: f.client });
    const result = await hooks.tool.createworktree.execute({ branch: 'bad-copy' }, { sessionID: 's' });
    assert.match(result, /include.*failed/i);
    const state = plugin.getSession(f.main, 's');
    assert.ok(state.worktreePath);
    assert.equal(state.pendingWorktreeSpawn, undefined);
    assert.ok(await fs.stat(state.worktreePath));
  });
}

for (const kind of ['source-file', 'source-parent', 'manifest', 'destination-parent', 'destination-file', 'destination-tracked', 'not-ignored']) {
  test(`include rejects ${kind} without changing outside or existing files`, async (t) => {
    const f = await fixture(t);
    const { copyIncludes } = await import(pathToFileURL(join(resolve(bundle, '..'), 'worktree-safety.mjs')));
    const outside = join(f.root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(join(outside, 'settings.local.json'), 'SYNTHETIC=outside\n');
    if (kind === 'source-file') {
      await fs.unlink(join(f.main, 'config.env'));
      await fs.symlink(join(outside, 'settings.local.json'), join(f.main, 'config.env'));
    } else if (kind === 'source-parent') {
      await fs.rm(join(f.main, '.claude'), { recursive: true });
      await fs.symlink(outside, join(f.main, '.claude'));
    } else if (kind === 'manifest') {
      await fs.unlink(join(f.main, '.worktreeinclude'));
      await fs.symlink(join(outside, 'settings.local.json'), join(f.main, '.worktreeinclude'));
    } else if (kind === 'destination-parent') {
      await fs.symlink(outside, join(f.wt, '.claude'));
    } else if (kind === 'not-ignored') {
      await fs.writeFile(join(f.main, '.worktreeinclude'), 'ordinary\n');
      await fs.writeFile(join(f.main, 'ordinary'), 'not ignored');
    } else {
      await fs.writeFile(join(f.wt, 'config.env'), 'SYNTHETIC=existing\n');
      if (kind === 'destination-tracked') f.git(f.wt, 'add', '-f', 'config.env');
    }
    await assert.rejects(copyIncludes(f.main, f.wt));
    assert.equal(await fs.readFile(join(outside, 'settings.local.json'), 'utf8'), 'SYNTHETIC=outside\n');
    if (kind.startsWith('destination-') && kind !== 'destination-parent') {
      assert.equal(await fs.readFile(join(f.wt, 'config.env'), 'utf8'), 'SYNTHETIC=existing\n');
    }
  });
}

test('no manifest is a no-op; absent remote evidence refuses cleanup', async (t) => {
  const f = await fixture(t);
  const { copyIncludes } = await import(pathToFileURL(join(resolve(bundle, '..'), 'worktree-safety.mjs')));
  await fs.unlink(join(f.main, '.worktreeinclude'));
  await copyIncludes(f.main, f.wt);
  await assert.rejects(fs.stat(join(f.wt, 'config.env')), { code: 'ENOENT' });
  f.git(f.main, 'update-ref', '-d', 'refs/remotes/origin/main');
  assert.equal(plugin.cleanupWorktree(f.main, f.wt, 'topic').success, false);
});

test('cleanup refuses main checkout, mismatched branch, and unrelated repository', async (t) => {
  const f = await fixture(t);
  const other = await fixture(t);
  assert.equal(plugin.cleanupWorktree(f.main, f.main, 'main').success, false);
  assert.equal(plugin.cleanupWorktree(f.main, f.wt, 'other').success, false);
  assert.equal(plugin.cleanupWorktree(other.main, f.wt, 'topic').success, false);
});

test('create rejects branch traversal and shell syntax before touching Git', async (t) => {
  const f = await fixture(t);
  const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.main, worktree: f.main, client: f.client });
  for (const branch of ['../outside', 'topic;false', '-flag']) {
    assert.match(await hooks.tool.createworktree.execute({ branch }, { sessionID: 's' }), /invalid branch/i);
    assert.equal(plugin.getSession(f.main, 's'), undefined);
    await assert.rejects(fs.stat(join(f.main, '.opencode')), { code: 'ENOENT' });
  }
});

test('synchronous launch failure retains pending spawn without endless idle retries', async (t) => {
  const f = await fixture(t);
  plugin.upsertSession(f.main, 's', { branch: 'topic', worktreePath: f.wt,
    pendingWorktreeSpawn: { branch: 'topic', worktreePath: f.wt, sessionID: 's' } });
  const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.main, worktree: f.main, client: f.client });
  plugin.setLauncher(() => { throw new Error('synthetic launcher failure'); });
  const event = { event: { type: 'session.idle', properties: { sessionID: 's' } } };
  await hooks.event(event);
  assert.ok(plugin.getSession(f.main, 's').pendingWorktreeSpawn);
  assert.equal(f.commands.length, 0);
  assert.match(f.toasts.at(-1).message, /synthetic launcher failure/);
  const count = f.toasts.length;
  await hooks.event(event);
  assert.equal(f.toasts.length, count);
});

test('create treats repository paths with shell metacharacters literally', async (t) => {
  const f = await fixture(t, 'main $literal "quoted"');
  const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.main, worktree: f.main, client: f.client });
  assert.match(await hooks.tool.createworktree.execute({ branch: 'feature/copy' }, { sessionID: 's' }), /Created worktree/);
  assert.equal(await fs.readFile(join(plugin.getSession(f.main, 's').worktreePath, 'config.env'), 'utf8'), 'SYNTHETIC=value\n');
});

for (const contents of ['{broken', '{"sessions":[]}', '{"sessions":{"s":null}}']) {
  test(`corrupt state ${contents} refuses reads, mutations, and automatic deletion`, async (t) => {
    const f = await fixture(t);
    plugin.upsertSession(f.main, 's', { branch: 'topic', worktreePath: f.wt });
    const statePath = join(f.main, '.opencode/worktree-session-state.json');
    await fs.writeFile(statePath, contents);
    assert.throws(() => plugin.getSession(f.main, 's'), /state/i);
    assert.throws(() => plugin.upsertSession(f.main, 'new', { branch: 'new' }), /state/i);
    assert.throws(() => plugin.deleteSession(f.main, 's'), /state/i);
    const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.wt, worktree: f.wt, client: f.client });
    await assert.rejects(hooks.event({ event: { type: 'session.deleted', properties: { info: { id: 's' } } } }), /state/i);
    assert.equal(await fs.readFile(statePath, 'utf8'), contents);
    assert.ok(await fs.stat(f.wt));
    await assert.rejects(fs.stat(`${statePath}.lock`), { code: 'ENOENT' });
    assert.deepEqual((await fs.readdir(join(f.main, '.opencode'))).filter(name => name.endsWith('.tmp')), []);
  });
}

test('corrupt state refuses creation before adding an untracked worktree', async (t) => {
  const f = await fixture(t);
  plugin.upsertSession(f.main, 's', {});
  await fs.writeFile(join(f.main, '.opencode/worktree-session-state.json'), '{broken');
  const hooks = await plugin.GitWorktreeSessionPlugin({ directory: f.main, worktree: f.main, client: f.client });
  await assert.rejects(hooks.tool.createworktree.execute({ branch: 'must-not-exist' }, { sessionID: 's' }), /state/i);
  assert.throws(() => f.git(f.main, 'show-ref', '--verify', 'refs/heads/must-not-exist'));
  await assert.rejects(fs.stat(join(f.main, '.opencode/worktrees/must-not-exist')), { code: 'ENOENT' });
});

for (const replaceLock of [false, true]) {
  test(`failed atomic rename preserves state and ${replaceLock ? 'a replacement owner lock' : 'releases its own lock'}`, async (t) => {
    const f = await fixture(t);
    plugin.upsertSession(f.main, 'keep', { note: 'original' });
    const statePath = join(await fs.realpath(f.main), '.opencode/worktree-session-state.json');
    const before = await fs.readFile(statePath, 'utf8');
    const rename = fsSync.renameSync;
    // Inject an IO failure only at this fixture's atomic commit boundary.
    fsSync.renameSync = (from, to) => {
      if (to !== statePath) return rename(from, to);
      if (replaceLock) {
        fsSync.unlinkSync(`${statePath}.lock`);
        fsSync.writeFileSync(`${statePath}.lock`, 'replacement owner');
      }
      throw new Error('synthetic rename failure');
    };
    syncBuiltinESMExports();
    try { assert.throws(() => plugin.upsertSession(f.main, 'new', {}), /synthetic rename failure/); } finally {
      fsSync.renameSync = rename;
      syncBuiltinESMExports();
    }
    assert.equal(await fs.readFile(statePath, 'utf8'), before);
    assert.deepEqual((await fs.readdir(join(f.main, '.opencode'))).filter(name => name.endsWith('.tmp')), []);
    if (replaceLock) assert.equal(await fs.readFile(`${statePath}.lock`, 'utf8'), 'replacement owner');
    else {
      await assert.rejects(fs.stat(`${statePath}.lock`), { code: 'ENOENT' });
      plugin.upsertSession(f.main, 'new', { note: 'retry' });
      assert.equal(plugin.getSession(f.main, 'new').note, 'retry');
    }
  });
}

test('state replacement is atomic and does not truncate an existing reader', async (t) => {
  const f = await fixture(t);
  plugin.upsertSession(f.main, 'keep', { note: 'old snapshot' });
  const statePath = join(f.main, '.opencode/worktree-session-state.json');
  const before = await fs.readFile(statePath, 'utf8');
  const reader = await fs.open(statePath, 'r');
  try {
    plugin.upsertSession(f.main, 'new', { note: 'new snapshot' });
    assert.equal(await reader.readFile('utf8'), before);
  } finally { await reader.close(); }
  assert.equal(plugin.getSession(f.main, 'new').note, 'new snapshot');
  assert.equal((await fs.stat(statePath)).mode & 0o777, 0o600);
});

test('upsert without a patch preserves an existing session', async (t) => {
  const f = await fixture(t);
  plugin.upsertSession(f.main, 'keep', { note: 'original' });
  plugin.upsertSession(f.main, 'keep');
  assert.equal(plugin.getSession(f.main, 'keep')?.note, 'original');
});

test('session events outside Git remain no-ops without state errors', async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, 'not-a-repository');
  await fs.mkdir(directory);
  const hooks = await plugin.GitWorktreeSessionPlugin({ directory, worktree: directory, client: f.client });
  for (const type of ['session.created', 'session.idle', 'session.error', 'session.deleted']) {
    await hooks.event({ event: { type, properties: { info: { id: 's' }, sessionID: 's' } } });
  }
  assert.deepEqual(f.toasts, []);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('busy state lock times out without stealing it or changing state', async (t) => {
  const f = await fixture(t);
  plugin.upsertSession(f.main, 'keep', { note: 'keep' });
  const statePath = join(f.main, '.opencode/worktree-session-state.json');
  const before = await fs.readFile(statePath, 'utf8');
  await fs.writeFile(`${statePath}.lock`, 'another owner');
  const start = Date.now();
  assert.throws(() => plugin.upsertSession(f.main, 'new', {}), /state.*lock/i);
  assert.ok(Date.now() - start < 10000, 'lock wait must be bounded');
  assert.equal(await fs.readFile(`${statePath}.lock`, 'utf8'), 'another owner');
  assert.equal(await fs.readFile(statePath, 'utf8'), before);
  // Explicit fixture-owner recovery; the implementation must never steal a lock.
  await fs.unlink(`${statePath}.lock`);
  plugin.upsertSession(f.main, 'new', { note: 'recovered' });
  assert.equal(plugin.getSession(f.main, 'new').note, 'recovered');
});

test('multiprocess state mutations preserve all records, merged fields, and deletions', { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  plugin.upsertSession(f.main, 'keep', { note: 'original' });
  for (let i = 0; i < 8; i++) plugin.upsertSession(f.main, `remove-${i}`, {});
  const testModule = join(f.root, 'instrumented-bundle.mjs');
  await fs.writeFile(testModule, source);
  const children = [];
  t.after(() => { for (const child of children) if (child.exitCode === null) child.kill(); });
  const tasks = Array.from({ length: 4 }, (_, worker) => {
    const code = `
      const { upsertSession, deleteSession } = await import(${JSON.stringify(pathToFileURL(testModule).href)});
      // Widen the read/modify/write race using real IO, without changing its data.
      const fs = (await import('node:fs')).default;
      const { syncBuiltinESMExports } = await import('node:module');
      const read = fs.readFileSync;
      fs.readFileSync = (...args) => {
        const result = read(...args);
        if (typeof args[0] === 'number' || String(args[0]).endsWith('worktree-session-state.json')) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
        }
        return result;
      };
      syncBuiltinESMExports();
      process.send('ready');
      process.once('message', () => {
        for (let i = 0; i < 8; i++) {
          ${worker === 0 ? `deleteSession(${JSON.stringify(f.main)}, 'remove-' + i);` : ''}
          upsertSession(${JSON.stringify(worker % 2 ? f.wt : f.main)}, 'worker-${worker}-' + i, { value: i });
          upsertSession(${JSON.stringify(f.main)}, 'shared', { worker${worker}: i });
        }
        process.disconnect();
      });
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], timeout: 30000 });
    children.push(child);
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    const ready = new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Worker exited before ready: ${code}: ${errors}`)));
    });
    const done = new Promise(resolve => child.once('exit', code => resolve({ code, errors })));
    return { ready, done, child };
  });
  await Promise.all(tasks.map(task => task.ready));
  for (const task of tasks) task.child.send('go');
  const exits = await Promise.all(tasks.map(task => task.done));
  for (const exit of exits) assert.equal(exit.code, 0, exit.errors);
  const state = JSON.parse(await fs.readFile(join(f.main, '.opencode/worktree-session-state.json'), 'utf8'));
  assert.equal(Object.keys(state.sessions).length, 34);
  assert.equal(state.sessions.keep.note, 'original');
  for (let i = 0; i < 8; i++) {
    assert.equal(state.sessions[`remove-${i}`], undefined);
    for (let worker = 0; worker < 4; worker++) assert.equal(state.sessions[`worker-${worker}-${i}`].value, i);
  }
  for (let worker = 0; worker < 4; worker++) assert.equal(state.sessions.shared[`worker${worker}`], 7);
});
