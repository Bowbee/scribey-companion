#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

function main() {
  const args = process.argv.slice(2);
  const platform = args[0] || 'current';
  
  log('🚀 Scribey Companion Build Script', 'cyan');
  log('================================', 'cyan');
  
  try {
    // Clean previous builds
    log('\n📁 Cleaning previous builds...', 'yellow');
    execWithOutput('npm run clean');
    
    // Build TypeScript
    log('\n🔨 Building TypeScript...', 'yellow');
    execWithOutput('npm run build');
    
    // Build Electron app
    log('\n📦 Building Electron app...', 'yellow');
    
    switch (platform.toLowerCase()) {
      case 'win':
      case 'windows':
        log('Building for Windows...', 'blue');
        execWithOutput('npm run dist:win');
        break;
      case 'mac':
      case 'macos':
        log('Building for macOS...', 'blue');
        execWithOutput('npm run dist:mac');
        break;
      case 'linux':
        log('Building for Linux...', 'blue');
        execWithOutput('npm run dist:linux');
        break;
      case 'all':
        log('Building for all platforms...', 'blue');
        execWithOutput('npm run dist:all');
        break;
      case 'current':
      default:
        log('Building for current platform...', 'blue');
        execWithOutput('npm run dist');
        break;
    }
    
    // Check build output
    const buildDir = path.join(process.cwd(), 'build');
    if (fs.existsSync(buildDir)) {
      const files = fs.readdirSync(buildDir);
      log('\n✅ Build completed successfully!', 'green');
      log('\n📋 Generated files:', 'bright');
      files.forEach(file => {
        const stats = fs.statSync(path.join(buildDir, file));
        const size = (stats.size / 1024 / 1024).toFixed(2);
        log(`  • ${file} (${size} MB)`, 'dim');
      });
    } else {
      log('\n❌ Build directory not found!', 'red');
      process.exit(1);
    }
    
  } catch (error) {
    log('\n❌ Build failed!', 'red');
    log(error.message, 'red');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
} 