// Build-time, fail-closed patch of the pinned, self-contained npm distribution.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const path = process.argv[2];
let source = readFileSync(path, 'utf8');
if (createHash('sha256').update(source).digest('hex') !== '30e69f976511d19e991653832d4538f0778a0142b481eb714ea5b7cadfa9a36c') {
  throw new Error('Unexpected upstream distribution hash; review patch before updating');
}
function replace(before, after) {
  if (source.split(before).length !== 2) throw new Error(`Upstream patch context changed: ${before.slice(0, 100)}`);
  source = source.replace(before, after);
}
function section(start, end, replacement) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`Upstream section missing: ${start}`);
  replace(source.slice(a, b), replacement);
}
source = 'import { safeCleanup, mainRepo, worktreeInfo, copyIncludes } from "./worktree-safety.mjs";\nimport { getSession, upsertSession, deleteSession } from "./worktree-state.mjs";\n' + source;
section('var commitAndPush = ', 'var pruneWorktrees = ', '');
replace('import { execSync } from "child_process";', 'import { execFileSync } from "child_process";');
replace('var run = (cmd, cwd) => execSync(cmd, {', 'var run = (args, cwd) => execFileSync("git", args, {');
for (const [before, after] of [
  ['"git rev-parse --is-inside-work-tree"', '["rev-parse", "--is-inside-work-tree"]'],
  ['"git branch --show-current"', '["branch", "--show-current"]'],
  ['"git status --porcelain"', '["status", "--porcelain"]'],
  ['`git show-ref --verify --quiet refs/heads/${branch}`', '["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]'],
  ['`git ls-remote --exit-code --heads origin ${branch}`', '["ls-remote", "--exit-code", "--heads", "origin", branch]'],
  ['"git worktree prune"', '["worktree", "prune"]'],
  ['`git worktree add "${worktreePath}" -b "${branch}" "${baseBranch}"`', '["worktree", "add", "-b", branch, "--", worktreePath, baseBranch]'],
  ['`git merge --ff-only origin/${branch}`', '["merge", "--ff-only", `origin/${branch}`]'],
  ['`git rev-list --left-right --count origin/${branch}...${branch}`', '["rev-list", "--left-right", "--count", `origin/${branch}...${branch}`]'],
]) replace(before, after);
// These two upstream calls occur in both local/remote branch paths.
for (const [before, after] of [
  ['`git fetch origin "${branch}"`', '["fetch", "origin", branch]'],
  ['`git worktree add "${worktreePath}" "${branch}"`', '["worktree", "add", "--", worktreePath, branch]'],
]) {
  if (source.split(before).length !== 3) throw new Error('Repeated Git patch context changed');
  source = source.replaceAll(before, after);
}
replace('var createWorktreeSession = (directory, branch) => {', `var createWorktreeSession = (directory, branch) => {
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) throw new Error();
    run(["check-ref-format", "--branch", branch], directory);
  } catch {
    return { success: false, error: "Invalid branch name" };
  }`);
section('var getMainRepoFromWorktree = ', '// .opencode/plugin/src/', 'var getMainRepoFromWorktree = mainRepo;\n\n');
section('var resolveRepoRoot = ', '// .opencode/plugin/src/events/session-created.ts', '');
replace('    event: async ({ event }) => {', '    event: async ({ event }) => {\n      if (["session.created", "session.idle", "session.error", "session.deleted"].includes(event.type) && !isGitRepo(directory)) return;');
section('var cleanupWorktree = ', 'var createWorktreeSession = ', 'var cleanupWorktree = safeCleanup;\n');
replace('if (worktree.includes("worktrees"))\n    return;', 'if (getMainRepoFromWorktree(directory))\n    return;');
replace('if (worktree.includes("worktrees")) {', 'if (getMainRepoFromWorktree(worktree)) {');
replace('getSystemPromptForWorktree(worktree);', 'getSystemPromptForWorktree(directory);');
replace('if (!worktree.includes("worktrees")) {', 'if (!getMainRepoFromWorktree(directory)) {');
replace('  const result = cleanupWorktree(directory, state.worktreePath, state.branch);', '  const main = getMainRepoFromWorktree(directory) || directory;\n  const result = cleanupWorktree(main, state.worktreePath, state.branch, state.includeCopies);');
replace('  deleteSession(directory, sessionId);\n};\n\n// .opencode/plugin/src/events/session-error', '  if (result.success) deleteSession(main, sessionId);\n};\n\n// .opencode/plugin/src/events/session-error');
replace('        deleteSession(directory, sessionId);', '        deleteSession(mainRepo, sessionId);');
replace('    upsertSession(directory, sessionId, { pendingWorktreeDeletion: undefined });', '    if (state.pendingWorktreeDeletion.failed) return;\n    upsertSession(directory, sessionId, { pendingWorktreeDeletion: { ...state.pendingWorktreeDeletion, failed: true } });');
replace('      const result = cleanupWorktree(mainRepo, worktreePath, branch);', '      const result = cleanupWorktree(mainRepo, worktreePath, branch, state.includeCopies);');
replace('    upsertSession(directory, sessionId, { pendingWorktreeSpawn: undefined });\n    openOpencodeInDefaultTerminal(worktreePath, sessionID, directory);', `    if (state.pendingWorktreeSpawn.failed) return;
    upsertSession(directory, sessionId, { pendingWorktreeSpawn: { ...state.pendingWorktreeSpawn, failed: true } });
    openOpencodeInDefaultTerminal(worktreePath, sessionID, directory);
    upsertSession(directory, sessionId, { pendingWorktreeSpawn: undefined });`);
source = source.replaceAll('Committed & cleaned', 'Cleaned');
replace('title: "Session Saved"', 'title: "Worktree Cleaned"');
replace('Deletes the current worktree session. Commits any changes, pushes to remote, and removes the worktree.', 'Removes a clean worktree without force. Unchanged files copied from .worktreeinclude are disposable; modified or unknown ignored files and unpushed commits are preserved. Never stages, commits, or pushes. Failure retains tracking; call again to retry.');
replace('    const state = getSession(directory, sessionId);\n    const debugInfo', '    const info = worktreeInfo(directory);\n    const state = { branch: info.branch, worktreePath: info.path };\n    const debugInfo');
replace('    upsertSession(directory, sessionId, {\n      pendingWorktreeDeletion:', '    upsertSession(directory, sessionId, {\n      branch: state.branch,\n      worktreePath: state.worktreePath,\n      pendingWorktreeDeletion:');
replace('    const result = createWorktreeSession(directory, branch);', '    if (isGitRepo(directory)) getSession(directory, context.sessionID);\n    const result = createWorktreeSession(directory, branch);');
replace('    upsertSession(directory, context.sessionID, {\n      branch,', `    upsertSession(directory, context.sessionID, { branch, worktreePath: result.worktreePath, pendingWorktreeSpawn: undefined });
    try {
      const includeCopies = await copyIncludes(directory, result.worktreePath);
      upsertSession(directory, context.sessionID, { includeCopies });
    } catch (error) {
      const message = "Worktree include copy failed; worktree retained, launch blocked: " + String(error);
      await client.tui.showToast({ body: { title: "Include Copy Failed", message, variant: "error" } });
      return message;
    }
    upsertSession(directory, context.sessionID, {
      branch,`);
writeFileSync(path, source);
