/**
 * scripts/sync-prod.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Local Production Synchronization Engine (dev -> main).
 * ─────────────────────────────────────────────────────────────────────────────
 * Automates the creation of an ultra-lean, sanitized production tree on 'main'
 * by applying '.prodignore' rules in an isolated git worktree.
 * 
 * Guarantees that:
 * 1. The local working directory and 'dev' branch are 100% untouched.
 * 2. All research datasets, scratch scripts, directives, and logs stay in 'dev'.
 * 3. Production 'main' contains strictly core Next.js application & engine code.
 * 4. Production build integrity is verified prior to committing.
 * 5. Commits to 'main' cleanly extend origin/main without forcing non-fast-forwards.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface SyncOptions {
  isDryRun: boolean;
  shouldPush: boolean;
  shouldSkipBuild: boolean;
}

const REQUIRED_PROD_ENTRIES = [
  'src',
  'public',
  'package.json',
  'next.config.ts',
  'tsconfig.json',
  'postcss.config.mjs',
];

function parseArguments(): SyncOptions {
  const args = process.argv.slice(2);
  return {
    isDryRun: args.includes('--dry-run'),
    shouldPush: args.includes('--push'),
    shouldSkipBuild: args.includes('--skip-build'),
  };
}

function readProdIgnorePatterns(rootPath: string): string[] {
  const ignoreFilePath = path.join(rootPath, '.prodignore');
  if (!fs.existsSync(ignoreFilePath)) {
    console.warn('⚠️ [SYNC] .prodignore file not found at repository root.');
    return [];
  }

  return fs
    .readFileSync(ignoreFilePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function executeGitCommand(command: string, cwd: string): string {
  try {
    return execSync(command, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
  } catch (error: any) {
    const errorDetails = error.stderr?.toString() || error.message;
    throw new Error(`Git command failed: "${command}"\nDetails: ${errorDetails}`);
  }
}

function pruneWorktreeEntries(worktreePath: string, patterns: string[]) {
  for (const pattern of patterns) {
    const cleanPattern = pattern.replace(/\/$/, '');
    try {
      executeGitCommand(`git rm -rf --ignore-unmatch "${cleanPattern}"`, worktreePath);
    } catch {
      const targetPath = path.join(worktreePath, cleanPattern);
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
    }
  }
  executeGitCommand('git add -A', worktreePath);
}

function validateProductionIntegrity(worktreePath: string) {
  for (const requiredEntry of REQUIRED_PROD_ENTRIES) {
    const fullPath = path.join(worktreePath, requiredEntry);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Integrity check failed: missing required entry "${requiredEntry}"`);
    }
  }
}

function verifyProductionBuild(worktreePath: string) {
  console.log('🏗️ [SYNC] Verifying production build integrity in isolated worktree...');
  try {
    execSync('npm run build', {
      cwd: worktreePath,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    console.log('✅ [SYNC] Production build verification succeeded (0 errors).');
  } catch {
    throw new Error('Production build verification failed in worktree.');
  }
}

export function runProductionSync() {
  const options = parseArguments();
  const rootPath = process.cwd();
  const worktreePath = path.join(rootPath, '.git', 'temp_prod_worktree');

  console.log('\n===============================================================');
  console.log(' 🚀 PRODUCTION BRANCH SANITIZATION & SYNC ENGINE (dev -> main)');
  console.log('===============================================================');
  console.log(` Mode:        ${options.isDryRun ? 'DRY-RUN (No commits pushed)' : 'LIVE SYNC'}`);
  console.log(` Push Remote: ${options.shouldPush ? 'YES (origin/main)' : 'NO (local main only)'}`);
  console.log('===============================================================\n');

  const currentBranch = executeGitCommand('git rev-parse --abbrev-ref HEAD', rootPath);
  const patterns = readProdIgnorePatterns(rootPath);
  console.log(`📋 [SYNC] Loaded ${patterns.length} exclusion patterns from .prodignore`);

  if (fs.existsSync(worktreePath)) {
    console.log('🧹 [SYNC] Cleaning up preexisting temporary worktree...');
    executeGitCommand(`git worktree remove --force "${worktreePath}"`, rootPath);
  }

  try {
    console.log('🌿 [SYNC] Fetching latest remote branches...');
    executeGitCommand('git fetch origin main:main || git fetch origin main', rootPath);

    console.log('🌿 [SYNC] Creating isolated worktree for main...');
    executeGitCommand(`git worktree add --force "${worktreePath}" main`, rootPath);

    console.log('🔄 [SYNC] Resetting worktree to origin/main baseline...');
    executeGitCommand('git reset --hard origin/main', worktreePath);

    console.log(`📥 [SYNC] Pulling latest file state from '${currentBranch}' into production worktree...`);
    executeGitCommand(`git checkout ${currentBranch} -- .`, worktreePath);

    console.log('✂️ [SYNC] Applying .prodignore exclusion rules...');
    pruneWorktreeEntries(worktreePath, patterns);

    console.log('🔍 [SYNC] Validating production core integrity...');
    validateProductionIntegrity(worktreePath);

    if (!options.shouldSkipBuild) {
      verifyProductionBuild(worktreePath);
    }

    const changedFiles = executeGitCommand('git status --porcelain', worktreePath);
    if (!changedFiles) {
      console.log('✨ [SYNC] Production branch is already fully synchronized.');
      return;
    }

    if (options.isDryRun) {
      console.log('\n🔍 [DRY-RUN] Files that will be committed/deleted on main:');
      console.log(changedFiles);
      console.log('\n✅ [DRY-RUN] Dry run completed successfully without committing to git.');
      return;
    }

    const devCommitHash = executeGitCommand('git rev-parse --short HEAD', rootPath);
    const commitMessage = `chore(prod): sanitize and sync production core from dev (${devCommitHash}) [skip ci]`;

    console.log(`💾 [SYNC] Committing sanitized production tree: "${commitMessage}"...`);
    executeGitCommand(`git commit -m "${commitMessage}"`, worktreePath);

    if (options.shouldPush) {
      console.log('🚀 [SYNC] Pushing sanitized main branch to origin/main...');
      executeGitCommand('git push origin main', worktreePath);
      console.log('✅ [SYNC] Successfully pushed main to origin.');
    }

    console.log('\n🎉 [SYNC] Production branch (main) synchronized cleanly!');
    console.log(`🔒 [SYNC] Local branch (${currentBranch}) and working files remain 100% untouched.\n`);
  } finally {
    if (fs.existsSync(worktreePath)) {
      try {
        executeGitCommand(`git worktree remove --force "${worktreePath}"`, rootPath);
      } catch (err: any) {
        console.warn(`⚠️ [SYNC] Worktree cleanup notice:`, err.message);
      }
    }
  }
}

if (require.main === module) {
  try {
    runProductionSync();
  } catch (error: any) {
    console.error(`\n❌ [SYNC ERROR] ${error.message}`);
    process.exit(1);
  }
}
