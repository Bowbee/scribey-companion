# Build and Release Documentation

This document describes the build and release process for Scribey Companion.

## Prerequisites

- Node.js 18 or higher
- npm
- Git (for releases)

## Available Scripts

### Development Scripts

```bash
# Start development mode with file watching
npm run dev

# Start development mode for main process only
npm run dev:main

# Start development mode for preload script only
npm run dev:preload

# Start the app in development mode
npm run start:dev

# Start the app in production mode
npm start
```

### Build Scripts

```bash
# Build TypeScript files
npm run build

# Clean build artifacts
npm run clean

# Build for current platform
npm run dist

# Build for specific platforms
npm run dist:win     # Windows
npm run dist:mac     # macOS
npm run dist:linux   # Linux
npm run dist:all     # All platforms

# Complete build process (clean + build + dist)
npm run build:all

# Enhanced build script with logging
npm run script:build [platform]
```

#### Enhanced Build Script Usage

The enhanced build script provides better logging and error handling:

```bash
# Build for current platform
npm run script:build

# Build for specific platform
npm run script:build windows
npm run script:build mac
npm run script:build linux
npm run script:build all
```

### Release Scripts

```bash
# Version bump scripts
npm run version:patch  # 1.0.0 -> 1.0.1
npm run version:minor  # 1.0.0 -> 1.1.0
npm run version:major  # 1.0.0 -> 2.0.0

# Release scripts
npm run release        # Build and publish to GitHub
npm run release:draft  # Build and create draft release

# Enhanced release script
npm run script:release [version-type] [--draft]
```

#### Enhanced Release Script Usage

The enhanced release script provides interactive version management:

```bash
# Create patch release (default)
npm run script:release

# Create specific version type
npm run script:release patch
npm run script:release minor
npm run script:release major

# Create draft release
npm run script:release patch --draft
```

## GitHub Actions Workflow

The project includes an automated GitHub Actions workflow that:

- Triggers on version tags (v*.*.*)
- Builds for all platforms (Windows, macOS, Linux)
- Creates GitHub releases automatically
- Uploads build artifacts

### Manual GitHub Actions Trigger

You can also trigger the workflow manually from the GitHub Actions tab.

## Publishing Process

### Automated Publishing (Recommended)

1. Use the enhanced release script:
   ```bash
   npm run script:release patch  # or minor/major
   ```

2. The script will:
   - Check for uncommitted changes
   - Show current and next version
   - Ask for confirmation
   - Update version in package.json
   - Commit changes
   - Create and push git tag
   - Trigger GitHub Actions workflow

3. GitHub Actions will:
   - Build for all platforms
   - Create GitHub release
   - Upload installers

### Manual Publishing

1. Update version:
   ```bash
   npm run version:patch  # or minor/major
   ```

2. Build and publish:
   ```bash
   npm run release
   ```

## Platform-Specific Builds

### Windows
- **Output**: `.exe` installer (NSIS)
- **Architecture**: x64
- **Requirements**: Windows 10 or higher

### macOS
- **Output**: `.dmg` disk image
- **Architecture**: x64, ARM64 (Apple Silicon)
- **Requirements**: macOS 10.15 or higher

### Linux
- **Output**: `.AppImage` portable application
- **Architecture**: x64
- **Requirements**: Most modern Linux distributions

## Build Configuration

The build process is configured in `package.json` under the `build` section:

- **App ID**: `com.scribey.companion`
- **Product Name**: `Scribey Companion`
- **Output Directory**: `build/`
- **Publish Provider**: GitHub Releases

## Environment Variables

For publishing, you'll need:

- `GH_TOKEN`: GitHub token with repo access (automatically provided in GitHub Actions)

## Troubleshooting

### Build Failures

1. **TypeScript compilation errors**: Fix TypeScript errors and try again
2. **Missing dependencies**: Run `npm ci` to install all dependencies
3. **Platform-specific issues**: Ensure you're building on the correct platform or use the `all` option

### Publishing Failures

1. **GitHub token issues**: Ensure `GH_TOKEN` is set and has proper permissions
2. **Network issues**: Check internet connectivity
3. **Git issues**: Ensure you're on the correct branch and have committed all changes

### Common Issues

1. **Permission denied on scripts**: On Unix systems, you may need to make scripts executable:
   ```bash
   chmod +x scripts/build.js scripts/release.js
   ```

2. **Node.js version**: Ensure you're using Node.js 18 or higher

3. **Git configuration**: Ensure Git is configured with your name and email:
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "your.email@example.com"
   ```

## Security Considerations

### Code Signing

For production releases, you should set up code signing:

- **Windows**: Obtain a code signing certificate and configure in electron-builder
- **macOS**: Set up Apple Developer account and configure notarization
- **Linux**: AppImages don't require code signing

### Environment Variables

Never commit sensitive tokens or certificates to the repository. Use:
- GitHub Secrets for CI/CD
- Local environment files (excluded from git)
- Secure credential storage systems

## Support

For build and release issues:
1. Check this documentation
2. Review GitHub Actions logs
3. Check electron-builder documentation
4. Create an issue in the repository 