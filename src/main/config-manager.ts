import Store from 'electron-store';
import * as path from 'path';
import * as fs from 'fs';
import { machineId } from 'node-machine-id';

export interface CompanionConfig {
  wowPath: string;
  serverUrl: string;
  autoUpload: boolean;
  uploadInterval: number;
  characters: CharacterConfig[];
  settings: AppSettings;
  deviceId?: string;
}

export interface CharacterConfig {
  name: string;
  realm: string;
  enabled: boolean;
  lastSync?: number;
}

export interface AppSettings {
  minimizeToTray: boolean;
  startWithWindows: boolean;
  autoStartWatching: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  retryAttempts: number;
  retryDelay: number;
}

const DEFAULT_CONFIG: CompanionConfig = {
  wowPath: '',
  serverUrl: 'https://scribey.app', // Will be overridden by main process
  autoUpload: true,
  uploadInterval: 30000, // 30 seconds
  characters: [],
  settings: {
    minimizeToTray: false,
    startWithWindows: false,
    autoStartWatching: true,
    logLevel: 'info',
    retryAttempts: 3,
    retryDelay: 5000
  }
};

export class ConfigManager {
  private store: Store<CompanionConfig>;
  private _deviceId: string | null = null;

  constructor() {
    this.store = new Store<CompanionConfig>({
      name: 'scribey-companion-config',
      defaults: DEFAULT_CONFIG,
      schema: {
        wowPath: {
          type: 'string',
          default: ''
        },
        serverUrl: {
          type: 'string',
          default: 'https://scribey.app'
        },
        autoUpload: {
          type: 'boolean',
          default: true
        },
        uploadInterval: {
          type: 'number',
          default: 30000,
          minimum: 5000
        },
        characters: {
          type: 'array',
          default: []
        },
        settings: {
          type: 'object',
          default: DEFAULT_CONFIG.settings
        }
      }
    });

    this.initializeDeviceId();
  }

  private async initializeDeviceId(): Promise<void> {
    try {
      this._deviceId = await machineId();
      if (!this.store.get('deviceId')) {
        this.store.set('deviceId', this._deviceId);
      }
    } catch (error) {
      console.warn('Failed to get machine ID:', error);
      this._deviceId = 'unknown-device';
    }
  }

  public getConfig(): CompanionConfig {
    return this.store.store;
  }

  public setConfig(config: Partial<CompanionConfig>): void {
    this.store.set(config);
  }

  public getWowPath(): string {
    return this.store.get('wowPath');
  }

  public setWowPath(wowPath: string): void {
    this.store.set('wowPath', wowPath);
  }

  public getServerUrl(): string {
    return this.store.get('serverUrl');
  }

  public setServerUrl(url: string): void {
    this.store.set('serverUrl', url);
  }

  public getCharacters(): CharacterConfig[] {
    return this.store.get('characters');
  }

  public addCharacter(character: CharacterConfig): void {
    const characters = this.getCharacters();
    const existingIndex = characters.findIndex(c => 
      c.name === character.name && c.realm === character.realm
    );
    
    if (existingIndex >= 0) {
      characters[existingIndex] = character;
    } else {
      characters.push(character);
    }
    
    this.store.set('characters', characters);
  }

  public removeCharacter(name: string, realm: string): void {
    const characters = this.getCharacters().filter(c => 
      !(c.name === name && c.realm === realm)
    );
    this.store.set('characters', characters);
  }

  public updateCharacterSync(name: string, realm: string, timestamp: number): void {
    const characters = this.getCharacters();
    const character = characters.find(c => c.name === name && c.realm === realm);
    
    if (character) {
      character.lastSync = timestamp;
      this.store.set('characters', characters);
    }
  }

  public getSettings(): AppSettings {
    return this.store.get('settings');
  }

  public updateSettings(settings: Partial<AppSettings>): void {
    const currentSettings = this.getSettings();
    this.store.set('settings', { ...currentSettings, ...settings });
  }

  public getDeviceId(): string {
    return this._deviceId || this.store.get('deviceId') || 'unknown-device';
  }

  public isAutoUploadEnabled(): boolean {
    return this.store.get('autoUpload');
  }

  public setAutoUploadEnabled(enabled: boolean): void {
    this.store.set('autoUpload', enabled);
  }

  public getUploadInterval(): number {
    return this.store.get('uploadInterval');
  }

  // Helper methods for path validation
  public validateWowPath(wowPath: string): boolean {
    if (!wowPath || !fs.existsSync(wowPath)) {
      return false;
    }

    // Check for common WoW installation indicators
    const indicators = [
      'Wow.exe',
      'WowClassic.exe', 
      '_retail_',
      '_classic_',
      'Interface'
    ];

    return indicators.some(indicator => 
      fs.existsSync(path.join(wowPath, indicator))
    );
  }

  public getAddonSavedVariablesPath(characterName?: string): string {
    const wowPath = this.getWowPath();
    if (!wowPath) {
      throw new Error('WoW path not configured');
    }

    // Path pattern: WoW\_classic_\WTF\Account\[ACCOUNT]\SavedVariables\Scribey.lua
    // or for character-specific: WoW\_classic_\WTF\Account\[ACCOUNT]\[SERVER]\[CHARACTER]\SavedVariables\Scribey.lua
    
    const wtfPath = path.join(wowPath, '_classic_', 'WTF');
    
    if (characterName) {
      // Character-specific path (if needed in the future)
      const [charName, realm] = characterName.split('-');
      return path.join(wtfPath, 'Account', '*', realm, charName, 'SavedVariables', 'Scribey.lua');
    } else {
      // Account-wide SavedVariables
      return path.join(wtfPath, 'Account', '*', 'SavedVariables', 'Scribey.lua');
    }
  }

  public reset(): void {
    this.store.clear();
    this.store.set(DEFAULT_CONFIG);
  }
} 