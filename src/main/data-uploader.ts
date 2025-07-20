import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { ConfigManager } from './config-manager';
import { AddonData } from './file-watcher';

export interface UploadResponse {
  success: boolean;
  message?: string;
  error?: string;
  timestamp?: number;
}

export interface ConnectionTest {
  success: boolean;
  latency?: number;
  error?: string;
  serverInfo?: {
    name: string;
    version: string;
    status: string;
  };
}

export class DataUploader {
  private httpClient: AxiosInstance;
  private uploadQueue: Array<{ data: AddonData; filePath: string; timestamp: number }> = [];
  private isUploading = false;
  private lastUploadAttempt: number = 0;
  private consecutiveFailures = 0;

  constructor(private configManager: ConfigManager) {
    this.httpClient = axios.create({
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Scribey-Companion/1.0.0',
      },
    });

    // Add request interceptor to include auth and device info
    this.httpClient.interceptors.request.use((config: any) => {
      config.headers['X-Device-ID'] = this.configManager.getDeviceId();
      config.headers['X-App-Version'] = '1.0.0'; // TODO: Get from package.json
      
      return config;
    });

    // Add response interceptor for error handling
    this.httpClient.interceptors.response.use(
      (response: any) => {
        this.consecutiveFailures = 0;
        return response;
      },
      (error: any) => {
        this.consecutiveFailures++;
        console.error('HTTP request failed:', error.message);
        return Promise.reject(error);
      }
    );
  }

  public async testConnection(): Promise<ConnectionTest> {
    try {
      const startTime = Date.now();
      const baseUrl = this.configManager.getServerUrl();
      
      console.log('Testing connection to:', `${baseUrl}/api/companion/status`);
      
      const response: AxiosResponse = await this.httpClient.get(`${baseUrl}/api/companion/status`);
      const endTime = Date.now();

      console.log('Connection test successful:', response.data);

      return {
        success: true,
        latency: endTime - startTime,
        serverInfo: response.data
      };
    } catch (error) {
      console.error('Connection test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  public async uploadData(addonData: AddonData, filePath: string): Promise<UploadResponse> {
    // Add to queue
    this.uploadQueue.push({
      data: addonData,
      filePath,
      timestamp: Date.now()
    });

    // Process queue if not already processing
    if (!this.isUploading) {
      return this.processUploadQueue();
    }

    return { success: true, message: 'Added to upload queue' };
  }

  public async forceSyncAll(): Promise<UploadResponse> {
    try {
      // This triggers a manual sync request to the server
      const baseUrl = this.configManager.getServerUrl();
      const response: AxiosResponse = await this.httpClient.post(`${baseUrl}/api/companion/sync`, {
        deviceId: this.configManager.getDeviceId(),
        forceSync: true,
        timestamp: Date.now()
      });

      console.log('Force sync successful:', response.data);

      return {
        success: true,
        message: 'Force sync completed - manually triggered data synchronization',
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Force sync failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async processUploadQueue(): Promise<UploadResponse> {
    if (this.isUploading || this.uploadQueue.length === 0) {
      return { success: true };
    }

    this.isUploading = true;

    try {
      // Check if we should back off due to consecutive failures
      if (this.consecutiveFailures >= 3) {
        const backoffTime = Math.min(this.consecutiveFailures * 5000, 30000); // Max 30 seconds
        const timeSinceLastAttempt = Date.now() - this.lastUploadAttempt;
        
        if (timeSinceLastAttempt < backoffTime) {
          console.log(`Backing off uploads due to failures. Waiting ${backoffTime - timeSinceLastAttempt}ms`);
          return { success: false, error: 'Backing off due to consecutive failures' };
        }
      }

      // Process items in batches
      const batchSize = 5;
      const batch = this.uploadQueue.splice(0, batchSize);
      
      for (const item of batch) {
        try {
          await this.uploadSingleItem(item);
        } catch (error) {
          console.error(`Failed to upload item from ${item.filePath}:`, error);
          // Re-add to queue for retry (up to a limit)
          if (this.consecutiveFailures < 5) {
            this.uploadQueue.unshift(item);
          }
        }
      }

      this.lastUploadAttempt = Date.now();
      return { success: true, message: `Processed ${batch.length} items` };

    } finally {
      this.isUploading = false;
      
      // Continue processing if there are more items
      if (this.uploadQueue.length > 0) {
        setTimeout(() => this.processUploadQueue(), 1000);
      }
    }
  }

  private async uploadSingleItem(item: { data: AddonData; filePath: string; timestamp: number }): Promise<void> {
    const payload = {
      deviceId: this.configManager.getDeviceId(),
      filePath: item.filePath,
      timestamp: item.timestamp,
      addonData: item.data,
      characters: Object.values(item.data.characters).map(char => ({
        name: char.name,
        realm: char.realm,
        class: char.class, // Include WoW class information
        cards: char.cards,
        professions: char.professions,
        lastUpdate: char.lastUpdate
      }))
    };

    console.log(`Uploading data for ${Object.keys(item.data.characters).length} characters from ${item.filePath}`);

    const baseUrl = this.configManager.getServerUrl();
    const response: AxiosResponse = await this.httpClient.post(`${baseUrl}/api/companion/upload`, payload);

    if (response.status !== 200) {
      throw new Error(`Upload failed with status ${response.status}: ${response.statusText}`);
    }

    console.log('Upload successful:', response.data);

    // Update character sync timestamps
    for (const characterName of Object.keys(item.data.characters)) {
      const [name, realm] = characterName.split('-');
      this.configManager.updateCharacterSync(name, realm || 'Unknown', item.timestamp);
    }
  }

  public getQueueStatus(): { queueLength: number; isUploading: boolean; consecutiveFailures: number } {
    return {
      queueLength: this.uploadQueue.length,
      isUploading: this.isUploading,
      consecutiveFailures: this.consecutiveFailures
    };
  }

  public clearQueue(): void {
    this.uploadQueue = [];
    console.log('Upload queue cleared');
  }

  public retryFailedUploads(): void {
    this.consecutiveFailures = 0;
    if (this.uploadQueue.length > 0 && !this.isUploading) {
      this.processUploadQueue();
    }
  }
} 