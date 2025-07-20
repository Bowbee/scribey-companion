#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function execWithOutput(command, options = {}) {
  log(`Executing: ${command}`, 'dim');
  try {
    const output = execSync(command, { 
      encoding: 'utf8', 
      stdio: 'inherit',
      ...options 
    });
    return output;
  } catch (error) {
    log(`Error executing command: ${command}`, 'red');
    throw error;
  }
}

function execSilent(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (error) {
    return null;
  }
}

function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function checkGitStatus() {
  const status = execSilent('git status --porcelain');
  if (status) {
    log('⚠️  You have uncommitted changes:', 'yellow');
    log(status, 'dim');
    const answer = await askQuestion('Do you want to continue anyway? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      log('Release cancelled.', 'yellow');
      process.exit(0);
    }
  }
}

function getCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return packageJson.version;
}

function getNextVersion(current, type) {
  const parts = current.split('.').map(Number);
  switch (type) {
    case 'major':
      return `${parts[0] + 1}.0.0`;
    case 'minor':
      return `${parts[0]}.${parts[1] + 1}.0`;
    case 'patch':
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    default:
      throw new Error(`Invalid version type: ${type}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const versionType = args[0] || 'patch';
  const isDraft = args.includes('--draft');
  
  log('🚀 Scribey Companion Release Script', 'cyan');
  log('==================================', 'cyan');
  
  try {
    // Check git status
    await checkGitStatus();
    
    // Get current version
    const currentVersion = getCurrentVersion();
    log(`\nCurrent version: ${currentVersion}`, 'blue');
    
    // Calculate next version
    if (!['major', 'minor', 'patch'].includes(versionType)) {
      log(`Invalid version type: ${versionType}. Use 'major', 'minor', or 'patch'.`, 'red');
      process.exit(1);
    }
    
    const nextVersion = getNextVersion(currentVersion, versionType);
    log(`Next version: ${nextVersion}`, 'green');
    
    // Confirm release
    const answer = await askQuestion(`\nCreate ${versionType} release v${nextVersion}? (y/N): `);
    if (answer.toLowerCase() !== 'y') {
      log('Release cancelled.', 'yellow');
      process.exit(0);
    }
    
    // Check if we're on main/master branch
    const currentBranch = execSilent('git branch --show-current');
    if (!['main', 'master'].includes(currentBranch)) {
      log(`⚠️  You're on branch '${currentBranch}', not 'main' or 'master'.`, 'yellow');
      const continueAnswer = await askQuestion('Continue anyway? (y/N): ');
      if (continueAnswer.toLowerCase() !== 'y') {
        log('Release cancelled.', 'yellow');
        process.exit(0);
      }
    }
    
    // Update version
    log('\n📝 Updating version...', 'yellow');
    execWithOutput(`npm version ${versionType} --no-git-tag-version`);
    
    // Commit version change
    log('\n💾 Committing version change...', 'yellow');
    execWithOutput('git add package.json package-lock.json');
    execWithOutput(`git commit -m "chore: bump version to ${nextVersion}"`);
    
    // Create git tag
    log('\n🏷️  Creating git tag...', 'yellow');
    execWithOutput(`git tag v${nextVersion}`);
    
    // Push changes and tags
    log('\n📤 Pushing to remote...', 'yellow');
    execWithOutput('git push');
    execWithOutput('git push --tags');
    
    if (isDraft) {
      log('\n📦 Creating draft release...', 'yellow');
      execWithOutput('npm run release:draft');
    } else {
      log('\n🚀 Publishing release...', 'yellow');
      execWithOutput('npm run release');
    }
    
    log(`\n✅ Release v${nextVersion} completed successfully!`, 'green');
    log(`\n🔗 Check your release at: https://github.com/yourusername/scribey-companion/releases/tag/v${nextVersion}`, 'cyan');
    
  } catch (error) {
    log('\n❌ Release failed!', 'red');
    log(error.message, 'red');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
} 