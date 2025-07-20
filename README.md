# Scribey Companion App

A standalone Electron application that monitors World of Warcraft addon data and syncs it with the Scribey web application.

## Overview

The Scribey Companion App uses a split architecture where the UI is loaded from the Scribey web application (`scribey.app/companion`) while the file monitoring and system integration is handled by the Electron application. This design allows the core logic to remain private while the Electron app can be open-sourced for auditing.

## Features

- **File Monitoring**: Automatically watches WoW SavedVariables files for changes
- **Real-time Upload**: Uploads character and card data to Scribey when detected
- **Split Architecture**: UI loaded from web app, privileged functions in Electron
- **Cross-platform**: Works on Windows, macOS, and Linux
- **Secure**: Uses Electron's context isolation and preload scripts
- **Auto-updates**: Can be configured for automatic updates

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web UI        │    │   Electron       │    │   WoW Addon     │
│  (scribey.app)  │◄───┤   Main Process   │◄───┤  (Scribey.lua)  │
│                 │    │                  │    │                 │
│ - User Interface│    │ - File Watching  │    │ - Data Export   │
│ - Settings      │    │ - Data Upload    │    │ - Card Tracking │
│ - Status Display│    │ - System APIs    │    │ - Professions   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Prerequisites

- Node.js 18+ and npm
- World of Warcraft with the Scribey addon installed
- Active internet connection for syncing with Scribey

## Development Setup

1. **Clone and Install Dependencies**
   ```bash
   cd companion-app
   npm install
   ```

2. **Development Mode**
   ```bash
   # Start TypeScript compilation in watch mode
   npm run dev

   # In another terminal, start Electron
   npm run start:dev
   ```

3. **Build for Production**
   ```bash
   # Build TypeScript
   npm run build

   # Start production version
   npm start
   ```

## Building Installers

1. **Build All Platforms** (requires appropriate OS)
   ```bash
   npm run dist
   ```

2. **Build for Specific Platform**
   ```bash
   # Windows
   npm run dist -- --win

   # macOS
   npm run dist -- --mac

   # Linux
   npm run dist -- --linux
   ```

## Configuration

The companion app stores its configuration using `electron-store`. Configuration includes:

- **WoW Installation Path**: Path to World of Warcraft installation
- **Server URL**: Scribey server URL (default: https://scribey.app)
- **Auto Upload**: Whether to automatically upload detected changes
- **Character Settings**: Which characters to monitor

## File Watching

The app monitors these files for changes:
```
World of Warcraft\_retail_\WTF\Account\[ACCOUNT]\SavedVariables\Scribey.lua
```

When changes are detected, the app:
1. Parses the Lua data structure
2. Extracts character, card, and profession information
3. Uploads the data to the Scribey API
4. Updates local sync timestamps

## API Integration

The companion app communicates with these Scribey API endpoints:

- `GET /api/companion/status` - Server status and connectivity test
- `POST /api/companion/upload` - Upload character and card data
- `POST /api/companion/sync` - Force sync request

## Security

- **Context Isolation**: Renderer process is isolated from Node.js APIs
- **Preload Script**: Controlled API exposure through `contextBridge`
- **Input Validation**: All API inputs are validated
- **Secure Defaults**: Web security enabled, remote modules disabled

## Preload API

The preload script exposes these APIs to the web UI:

```typescript
window.companionAPI = {
  // App controls
  getVersion(): Promise<string>
  quit(): Promise<void>
  minimize(): Promise<void>

  // Configuration
  config: {
    get(): Promise<Config>
    set(config): Promise<boolean>
    getWowPath(): Promise<string>
    setWowPath(path): Promise<boolean>
  }

  // File operations
  file: {
    selectWowDirectory(): Promise<string | null>
    checkWowInstallation(path): Promise<boolean>
  }

  // File watching
  watcher: {
    start(): Promise<{ success: boolean; error?: string }>
    stop(): Promise<{ success: boolean }>
    getStatus(): Promise<WatcherStatus>
  }

  // Data upload
  upload: {
    testConnection(): Promise<ConnectionTest>
    forceSync(): Promise<UploadResponse>
  }

  // Event handling
  on(channel, callback): void
  off(channel, callback): void
  send(channel, ...args): void
}
```

## Development Tips

1. **Debug Mode**: The app opens DevTools in development mode
2. **Hot Reload**: Web UI hot reloads when the Next.js dev server is running
3. **Logs**: Check both Electron console and network tab for debugging
4. **File Paths**: Use platform-appropriate path separators

## Troubleshooting

### App Won't Start
- Check Node.js version (18+ required)
- Verify all dependencies are installed: `npm install`
- Check for TypeScript compilation errors: `npm run build`

### File Watching Not Working
- Verify WoW installation path is correct
- Check file permissions on WoW directory
- Ensure Scribey addon is installed and working
- Try manually triggering file changes

### Upload Failures
- Check internet connectivity
- Verify Scribey server status
- Check API endpoints in browser DevTools
- Review error logs in Electron console

### Path Issues on Windows
- Use forward slashes in glob patterns
- Set `windowsPathsNoEscape: true` in glob options
- Test paths with `path.resolve()` and `fs.existsSync()`

## Building for Distribution

### Code Signing (Optional)
For production builds, you may want to code sign the application:

```javascript
// In package.json build config
"build": {
  "win": {
    "certificateFile": "path/to/certificate.p12",
    "certificatePassword": "password"
  },
  "mac": {
    "identity": "Developer ID Application: Your Name"
  }
}
```

### Auto-updater (Optional)
To enable auto-updates, configure the update server:

```javascript
// In main.ts
import { autoUpdater } from 'electron-updater';

autoUpdater.checkForUpdatesAndNotify();
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on target platforms
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:
- Visit [scribey.app](https://scribey.app)
- Check the GitHub issues page
- Join the Discord community 