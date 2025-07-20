import { contextBridge, ipcRenderer } from 'electron';

// Define the API interface that will be exposed to the renderer
export interface CompanionAPI {
  // App info
  getVersion(): Promise<string>;
  quit(): Promise<void>;
  minimize(): Promise<void>;
  toggleDevTools(): Promise<void>;
  openExternal(url: string): Promise<void>;

  // Configuration
  config: {
    get(): Promise<any>;
    set(config: any): Promise<boolean>;
    getWowPath(): Promise<string>;
    setWowPath(path: string): Promise<boolean>;
    setAutoUpload(enabled: boolean): Promise<boolean>;
  };

  // File operations
  file: {
    selectWowDirectory(): Promise<string | null>;
    checkWowInstallation(path: string): Promise<boolean>;
  };

  // File watching
  watcher: {
    start(): Promise<{ success: boolean; error?: string }>;
    stop(): Promise<{ success: boolean }>;
    getStatus(): Promise<{
      isWatching: boolean;
      lastUpdate: number | null;
      filesWatched: string[];
    }>;
  };

  // Data upload
  upload: {
    testConnection(): Promise<{
      success: boolean;
      latency?: number;
      error?: string;
      serverInfo?: any;
    }>;
    forceSync(): Promise<{ success: boolean; message?: string; error?: string }>;
  };

  // Device registration
  device: {
    register(code: string, deviceName?: string): Promise<{ success: boolean; device?: any; error?: string }>;
    checkRegistration(): Promise<{ registered: boolean; error?: string }>;
  };

  // Event listeners
  on(channel: string, callback: (...args: any[]) => void): void;
  off(channel: string, callback: (...args: any[]) => void): void;
  
  // Send events to main process
  send(channel: string, ...args: any[]): void;
}

// Exposed API object
const companionAPI: CompanionAPI = {
  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  quit: () => ipcRenderer.invoke('app:quit'),
  minimize: () => ipcRenderer.invoke('app:minimize'),
  toggleDevTools: () => ipcRenderer.invoke('app:toggleDevTools'),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),

  // Configuration
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (config: any) => ipcRenderer.invoke('config:set', config),
    getWowPath: () => ipcRenderer.invoke('config:getWowPath'),
    setWowPath: (path: string) => ipcRenderer.invoke('config:setWowPath', path),
    setAutoUpload: (enabled: boolean) => ipcRenderer.invoke('config:setAutoUpload', enabled),
  },

  // File operations
  file: {
    selectWowDirectory: () => ipcRenderer.invoke('file:selectWowDirectory'),
    checkWowInstallation: (path: string) => ipcRenderer.invoke('file:checkWowInstallation', path),
  },

  // File watching
  watcher: {
    start: () => ipcRenderer.invoke('watcher:start'),
    stop: () => ipcRenderer.invoke('watcher:stop'),
    getStatus: () => ipcRenderer.invoke('watcher:getStatus'),
  },

  // Data upload
  upload: {
    testConnection: () => ipcRenderer.invoke('upload:testConnection'),
    forceSync: () => ipcRenderer.invoke('upload:forceSync'),
  },

  // Device registration
  device: {
    register: (code: string, deviceName?: string) => ipcRenderer.invoke('device:register', code, deviceName),
    checkRegistration: () => ipcRenderer.invoke('device:checkRegistration'),
  },

  // Event handling
  on: (channel: string, callback: (...args: any[]) => void) => {
    // Validate allowed channels for security
    const allowedChannels = [
      'menu:openSettings',
      'watcher:fileChanged',
      'upload:progress',
      'upload:complete',
      'upload:error',
      'config:changed',
      'app:focus',
      'app:blur'
    ];

    if (allowedChannels.includes(channel)) {
      ipcRenderer.on(channel, (event: any, ...args: any[]) => callback(...args));
    } else {
      console.warn(`Attempted to listen to unauthorized channel: ${channel}`);
    }
  },

  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },

  send: (channel: string, ...args: any[]) => {
    // Validate allowed channels for security
    const allowedChannels = [
      'renderer:ready',
      'renderer:settings-opened',
      'renderer:settings-closed'
    ];

    if (allowedChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    } else {
      console.warn(`Attempted to send to unauthorized channel: ${channel}`);
    }
  }
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('companionAPI', companionAPI);

// Add some debug info in development
if (process.env.NODE_ENV === 'development') {
  console.log('Scribey Companion preload script loaded');
  console.log('companionAPI exposed to window.companionAPI');
}

// Type declarations for the window object (this will be available in the renderer)
declare global {
  interface Window {
    companionAPI?: CompanionAPI;
  }
} 