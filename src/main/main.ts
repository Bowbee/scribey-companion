import { app, BrowserWindow, shell, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import { ConfigManager } from './config-manager';
import { FileWatcher } from './file-watcher';
import { DataUploader } from './data-uploader';

class ScribeyCompanion {
  private mainWindow: BrowserWindow | null = null;
  private configManager: ConfigManager;
  private fileWatcher: FileWatcher;
  private dataUploader: DataUploader;

  constructor() {
    this.configManager = new ConfigManager();
    this.dataUploader = new DataUploader(this.configManager);
    this.fileWatcher = new FileWatcher(this.configManager, this.dataUploader);
  }

  public async initialize(): Promise<void> {
    // Handle app events
    app.whenReady().then(() => {
      this.createWindow();
      this.setupIpcHandlers();
      this.setupMenu();
      
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          this.createWindow();
        }
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('before-quit', () => {
      this.fileWatcher.stop();
    });
  }

  private createWindow(): void {
    // Create the browser window
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/preload.js'),
        webSecurity: true,
        sandbox: false
      },
      titleBarStyle: 'hidden', // Hide native titlebar to use custom HTML one
      frame: false, // Remove window frame
      icon: path.join(__dirname, '../../assets/icon.png'), // We'll create this
      show: false, // Don't show until ready
      backgroundColor: '#1f2937' // Dark theme background
    });

    // Load the companion page from the web app
    const isDev = process.env.NODE_ENV === 'development';
    const baseUrl = isDev ? 'http://localhost:3000' : 'https://scribey.app';
    
    // Update config to use the same URL we're loading the page from
    this.configManager.setServerUrl(baseUrl);
    
    this.mainWindow.loadURL(`${baseUrl}/companion`);

    // Show window when ready
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
      
      // DevTools disabled by default - can be toggled via menu or shortcut
      // if (isDev) {
      //   this.mainWindow?.webContents.openDevTools();
      // }
    });

    // Handle external links
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // Handle window closed
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  private setupIpcHandlers(): void {
    // Config management
    ipcMain.handle('config:get', async () => {
      return this.configManager.getConfig();
    });

    ipcMain.handle('config:set', async (event, config) => {
      this.configManager.setConfig(config);
      return true;
    });

    ipcMain.handle('config:getWowPath', async () => {
      return this.configManager.getWowPath();
    });

    ipcMain.handle('config:setWowPath', async (event, wowPath) => {
      this.configManager.setWowPath(wowPath);
      return true;
    });

    ipcMain.handle('config:setAutoUpload', async (event, enabled) => {
      this.configManager.setAutoUploadEnabled(enabled);
      return true;
    });

    // File operations
    ipcMain.handle('file:selectWowDirectory', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        properties: ['openDirectory'],
        title: 'Select World of Warcraft Installation Directory',
        message: 'Choose your World of Warcraft installation folder'
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      
      return null;
    });

    ipcMain.handle('file:checkWowInstallation', async (event, wowPath) => {
      return this.fileWatcher.validateWowPath(wowPath);
    });

    // File watching
    ipcMain.handle('watcher:start', async () => {
      try {
        await this.fileWatcher.start();
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    });

    ipcMain.handle('watcher:stop', async () => {
      this.fileWatcher.stop();
      return { success: true };
    });

    ipcMain.handle('watcher:getStatus', async () => {
      return {
        isWatching: this.fileWatcher.isWatching(),
        lastUpdate: this.fileWatcher.getLastUpdate(),
        filesWatched: this.fileWatcher.getWatchedFiles()
      };
    });

    // Data upload
    ipcMain.handle('upload:testConnection', async () => {
      return this.dataUploader.testConnection();
    });

    ipcMain.handle('upload:forceSync', async () => {
      return this.dataUploader.forceSyncAll();
    });

    // Device registration
    ipcMain.handle('device:register', async (_, code: string, deviceName?: string) => {
      try {
        const deviceId = this.configManager.getDeviceId();
        const serverUrl = this.configManager.getServerUrl();
        
        const axios = await import('axios');
        const os = await import('os');
        const response = await axios.default.post(`${serverUrl}/api/companion/register-device`, {
          code: code.toUpperCase(),
          deviceId,
          deviceName: deviceName || os.hostname()
        });

        if (response.data.success) {
          console.log('Device registered successfully:', response.data.device);
          return response.data;
        } else {
          throw new Error(response.data.error || 'Registration failed');
        }
      } catch (error: any) {
        console.error('Device registration error:', error);
        if (error.response?.data?.error) {
          return {
            success: false,
            error: error.response.data.error
          };
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Check device registration status
    ipcMain.handle('device:checkRegistration', async () => {
      try {
        const deviceId = this.configManager.getDeviceId();
        const serverUrl = this.configManager.getServerUrl();
        
        const axios = await import('axios');
        // Try a test upload to see if device is registered
        const response = await axios.default.post(`${serverUrl}/api/companion/upload`, {
          deviceId,
          timestamp: Date.now(),
          characters: [] // Empty test upload
        });

        return { registered: true };
      } catch (error: any) {
        if (error.response?.status === 401 && error.response?.data?.needsRegistration) {
          return { 
            registered: false,
            error: error.response.data.error 
          };
        }
        console.error('Error checking device registration:', error);
        return { 
          registered: false, 
          error: 'Failed to check registration status' 
        };
      }
    });

    // App info
    ipcMain.handle('app:getVersion', async () => {
      return app.getVersion();
    });

    ipcMain.handle('app:quit', async () => {
      app.quit();
    });

    ipcMain.handle('app:minimize', async () => {
      this.mainWindow?.minimize();
    });

    ipcMain.handle('app:toggleDevTools', async () => {
      if (this.mainWindow?.webContents.isDevToolsOpened()) {
        this.mainWindow.webContents.closeDevTools();
      } else {
        this.mainWindow?.webContents.openDevTools();
      }
    });

    ipcMain.handle('app:openExternal', async (_, url: string) => {
      const { shell } = await import('electron');
      shell.openExternal(url);
    });
  }

  private setupMenu(): void {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Settings',
            accelerator: 'CmdOrCtrl+,',
            click: () => {
              // Send message to renderer to open settings
              this.mainWindow?.webContents.send('menu:openSettings');
            }
          },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
            click: () => {
              app.quit();
            }
          }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'close' }
        ]
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'About Scribey Companion',
            click: () => {
              dialog.showMessageBox(this.mainWindow!, {
                type: 'info',
                title: 'About Scribey Companion',
                message: 'Scribey Companion',
                detail: `Version: ${app.getVersion()}\n\nA companion app for the Scribey guild management system.\n\nVisit scribey.app for more information.`
              });
            }
          },
          {
            label: 'Visit Scribey.app',
            click: () => {
              shell.openExternal('https://scribey.app');
            }
          }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  public sendToRenderer(channel: string, ...args: any[]): void {
    this.mainWindow?.webContents.send(channel, ...args);
  }
}

// Initialize the app
const companion = new ScribeyCompanion();
companion.initialize().catch(console.error);

export { ScribeyCompanion }; 