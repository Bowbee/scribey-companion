import { FSWatcher, watch } from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';
import { ConfigManager } from './config-manager';
import { DataUploader } from './data-uploader';
import * as luaparse from 'luaparse';

export interface FileWatchStatus {
  isWatching: boolean;
  filesWatched: string[];
  lastUpdate: number | null;
  lastError: string | null;
}

export interface AddonData {
  characters: { [key: string]: CharacterData };
  auctionData: {
    lastScan: number;
    scanCount: number;
    realm: string;
    itemCount: number;
    data: { [itemId: string]: any };
  };
  craftedCards: { [key: string]: any };
  settings: { [key: string]: any };
  timestamp: number;
  version: string;
}

export interface CharacterData {
  name: string;
  realm: string;
  cards: CardData[];
  professions: ProfessionData[];
  class: string;
  lastUpdate: number;
}

export interface CardData {
  itemId: number;
  itemName: string;
  deckName: string;
  cardNumber: number;
  quantity: number;
  timestamp: number;
}

export interface ProfessionData {
  name: string;
  skillLevel: number;
  maxSkill: number;
  recipes: number[];
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private isActive = false;
  private watchedFiles: string[] = [];
  private lastUpdate: number | null = null;
  private lastError: string | null = null;
  private lastFileContents: Map<string, string> = new Map();
  private lastUploadAttempt: Map<string, number> = new Map(); // Track last upload per file
  private readonly UPLOAD_COOLDOWN = 30000; // 30 seconds cooldown between uploads per file
  
  // Debug output settings
  private readonly DEBUG_ENABLED = false;
  private readonly DEBUG_DIR = path.join(process.cwd(), 'debug-output');

  constructor(
    private configManager: ConfigManager,
    private dataUploader: DataUploader
  ) {
    // Ensure debug directory exists
    if (this.DEBUG_ENABLED) {
      try {
        if (!fs.existsSync(this.DEBUG_DIR)) {
          fs.mkdirSync(this.DEBUG_DIR, { recursive: true });
        }
        
        // Create README for debug files
        const readmePath = path.join(this.DEBUG_DIR, 'README.txt');
        const readmeContent = `Scribey Companion App - Debug Output Files

This directory contains JSON debug files to help diagnose parsing and upload issues.

=== PARSING DEBUG FILES ===
- raw-lua-content.json: Raw Lua file content and basic statistics
- parsed-lua-ast.json: Full AST structure from luaparse with extraction info
- extracted-scribey-data.json: Complete ScribeyDB structure (characters, auctions, etc)
- character-parse-results.json: Detailed parsing results for each character
- parse-error.json: Lua parsing error details (if parsing fails)

=== UPLOAD DEBUG FILES ===
- upload-summary.json: Comprehensive summary of what's being uploaded
  * Character breakdown with professions
  * Auction data statistics  
  * Crafted cards count
  * Settings overview
- upload-data-full.json: Complete raw data being sent to API
- upload-result.json: Successful upload responses with summary
- upload-error.json: Upload error details with stack traces

=== KEY FILES TO CHECK ===
1. upload-summary.json - Quick overview of all data being uploaded
2. extracted-scribey-data.json - Verify all data was parsed correctly
3. character-parse-results.json - Check which characters succeeded/failed
4. upload-result.json - Confirm upload was processed successfully

Files are timestamped (YYYY-MM-DDTHH-MM-SS-sssZ) and generated automatically.
You can safely delete old files to save space.

Generated: ${new Date().toISOString()}
`;
        
        if (!fs.existsSync(readmePath)) {
          fs.writeFileSync(readmePath, readmeContent, 'utf8');
        }
      } catch (error) {
        console.warn('Failed to create debug directory:', error);
      }
    }
  }

  private writeDebugFile(filename: string, data: any): void {
    if (!this.DEBUG_ENABLED) return;
    
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const debugFile = path.join(this.DEBUG_DIR, `${timestamp}-${filename}`);
      
      const debugData = {
        timestamp: new Date().toISOString(),
        filename,
        data
      };
      
      fs.writeFileSync(debugFile, JSON.stringify(debugData, null, 2), 'utf8');
      console.log(`Debug data written to: ${debugFile}`);
    } catch (error) {
      console.warn('Failed to write debug file:', error);
    }
  }

  private luaAstToJson(ast: any): any {
    // literals
    if (ast.type === 'StringLiteral') {
      // Handle case where luaparse returns null value but has raw string
      if (ast.value !== null) {
        return ast.value;
      } else if (ast.raw) {
        // Remove quotes from raw string
        return ast.raw.slice(1, -1);
      }
      return '';
    }
    if (['NilLiteral', 'BooleanLiteral', 'NumericLiteral'].includes(ast.type)) {
      return ast.value;
    }
    // basic expressions
    if (ast.type === 'UnaryExpression' && ast.operator === '-') {
      return -this.luaAstToJson(ast.argument);
    }
    if (ast.type === 'Identifier') {
      return ast.name;
    }
    // tables
    if (['TableKey', 'TableKeyString'].includes(ast.type)) {
      return { __internal_table_key: true, key: this.luaAstToJson(ast.key), value: this.luaAstToJson(ast.value) };
    }
    if (ast.type === 'TableValue') {
      return this.luaAstToJson(ast.value);
    }
    if (ast.type === 'TableConstructorExpression') {
      if (ast.fields[0] && ast.fields[0].key) {
        const pairs: Array<[string, any]> = ast.fields.map((field: any) => {
          const { key, value } = this.luaAstToJson(field);
          return [key, value];
        });
        const object = Object.fromEntries(pairs);
        return Object.keys(object).length === 0 ? [] : object;
      }
      return ast.fields.map((field: any) => {
        const value = this.luaAstToJson(field);
        return value.__internal_table_key ? [value.key, value.value] : value;
      });
    }
    // top-level statements
    if (ast.type === 'LocalStatement') {
      const values = ast.init.map((node: any) => this.luaAstToJson(node));
      return values.length === 1 ? values[0] : values;
    }
    if (ast.type === 'ReturnStatement') {
      const values = ast.arguments.map((node: any) => this.luaAstToJson(node));
      return values.length === 1 ? values[0] : values;
    }
    if (ast.type === 'Chunk') {
      return this.luaAstToJson(ast.body[0]);
    }
    
    // Handle assignment statements (our specific case)
    if (ast.type === 'AssignmentStatement') {
      const result: any = {};
      for (let i = 0; i < ast.variables.length; i++) {
        const variable = ast.variables[i];
        if (variable.type === 'Identifier') {
          const variableName = variable.name;
          const initValue = ast.init[i];
          if (initValue) {
            result[variableName] = this.luaAstToJson(initValue);
          }
        }
      }
      return result;
    }
    
    throw new Error(`Can't parse AST node type: ${ast.type}`);
  }

  private extractScribeyDBFromAST(ast: any): any {
    try {
      console.log('Using enhanced AST-to-JSON converter');
      
      // Look for ScribeyDB assignment in the AST
      for (const statement of ast.body) {
        if (statement.type === 'AssignmentStatement') {
          for (let i = 0; i < statement.variables.length; i++) {
            const variable = statement.variables[i];
            if (variable.type === 'Identifier' && variable.name === 'ScribeyDB') {
              console.log('Found ScribeyDB assignment, converting with enhanced converter...');
              const init = statement.init[i];
              if (init) {
                const scribeyDB = this.luaAstToJson(init);
                console.log('ScribeyDB conversion complete. Keys found:', Object.keys(scribeyDB || {}));
                return scribeyDB;
              }
            }
          }
        }
      }
      
      console.warn('No ScribeyDB assignment statement found in AST');
      return null;
    } catch (error) {
      console.error('Error extracting ScribeyDB from AST:', error);
      return null;
    }
  }

  public async start(): Promise<void> {
    if (this.isActive) {
      this.stop();
    }

    const wowPath = this.configManager.getWowPath();
    if (!wowPath) {
      throw new Error('WoW installation path not configured');
    }

    if (!this.validateWowPath(wowPath)) {
      throw new Error('Invalid WoW installation path');
    }

    try {
      // Find all Scribey.lua files in SavedVariables
      const savedVarsPattern = this.configManager.getAddonSavedVariablesPath();
      const luaFiles = await this.findScribeyFiles(wowPath);
      
      if (luaFiles.length === 0) {
        throw new Error('No Scribey.lua files found. Make sure the addon is installed and you have logged in with at least one character.');
      }

      console.log(`Found ${luaFiles.length} Scribey.lua files to watch:`, luaFiles);

      // Start watching the files
      this.watcher = watch(luaFiles, {
        persistent: true,
        ignoreInitial: false,
        usePolling: true, // Use polling for better compatibility across platforms
        interval: 1000, // Check every second
      });

      this.watcher.on('change', (filePath: string) => {
        this.handleFileChange(filePath);
      });

      this.watcher.on('add', (filePath: string) => {
        console.log(`New Scribey.lua file detected: ${filePath}`);
        this.handleFileChange(filePath);
      });

      this.watcher.on('error', (error: Error) => {
        console.error('File watcher error:', error);
        this.lastError = error.message;
      });

      this.watchedFiles = luaFiles;
      this.isActive = true;
      this.lastError = null;

      console.log('File watcher started successfully');
      if (this.DEBUG_ENABLED) {
        console.log(`📁 Debug output enabled: ${this.DEBUG_DIR}`);
      }

      // Initial read of all files
      for (const file of luaFiles) {
        if (fs.existsSync(file)) {
          this.handleFileChange(file);
        }
      }

    } catch (error) {
      this.lastError = (error as Error).message;
      throw error;
    }
  }

  public stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    
    this.isActive = false;
    this.watchedFiles = [];
    this.lastFileContents.clear();
    this.lastUploadAttempt.clear();
    console.log('File watcher stopped');
  }

  public isWatching(): boolean {
    return this.isActive;
  }

  public getLastUpdate(): number | null {
    return this.lastUpdate;
  }

  public getWatchedFiles(): string[] {
    return [...this.watchedFiles];
  }

  public getStatus(): FileWatchStatus {
    return {
      isWatching: this.isActive,
      filesWatched: this.getWatchedFiles(),
      lastUpdate: this.lastUpdate,
      lastError: this.lastError
    };
  }

  public validateWowPath(wowPath: string): boolean {
    return this.configManager.validateWowPath(wowPath);
  }

  private async findScribeyFiles(wowPath: string): Promise<string[]> {
    const wtfPath = path.join(wowPath, '_classic_', 'WTF');
    
    if (!fs.existsSync(wtfPath)) {
      throw new Error('WTF directory not found. Make sure you have WoW Classic installed and have logged in at least once.');
    }

    // Use glob to find all Scribey.lua files in SavedVariables
    const pattern = path.join(wtfPath, 'Account', '*', 'SavedVariables', 'Scribey.lua').replace(/\\/g, '/');
    
    try {
      const files = await glob(pattern);
      return files;
    } catch (error) {
      throw new Error(`Failed to find Scribey.lua files: ${error}`);
    }
  }

  private async handleFileChange(filePath: string): Promise<void> {
    try {
      console.log(`File changed: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        console.warn(`File no longer exists: ${filePath}`);
        return;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const lastContent = this.lastFileContents.get(filePath);

      // Check if content actually changed
      if (content === lastContent) {
        return; // No actual change
      }

      this.lastFileContents.set(filePath, content);
      this.lastUpdate = Date.now();

      // Check rate limiting for uploads
      const lastUpload = this.lastUploadAttempt.get(filePath) || 0;
      const now = Date.now();
      const timeSinceLastUpload = now - lastUpload;

      if (timeSinceLastUpload < this.UPLOAD_COOLDOWN) {
        console.log(`Upload rate limited for ${filePath}. Cooldown: ${Math.ceil((this.UPLOAD_COOLDOWN - timeSinceLastUpload) / 1000)}s remaining`);
        return;
      }

      // Parse the Lua data
      const addonData = this.parseLuaData(content, filePath);
      
      if (addonData) {
        const characterCount = Object.keys(addonData.characters).length;
        console.log(`✓ Parsed ${characterCount} characters from ${path.basename(filePath)}`);
        if (this.DEBUG_ENABLED) {
          console.log(`📁 Debug files written to: ${this.DEBUG_DIR}`);
        }

        // Upload the data if auto-upload is enabled
        if (this.configManager.isAutoUploadEnabled()) {
          this.lastUploadAttempt.set(filePath, now);
          try {
            // Prepare detailed upload summary
            const uploadSummary = {
              filePath,
              uploadTimestamp: now,
              summary: {
                totalCharacters: Object.keys(addonData.characters).length,
                charactersWithProfessions: Object.values(addonData.characters).filter(char => char.professions.length > 0).length,
                totalProfessions: Object.values(addonData.characters).reduce((sum, char) => sum + char.professions.length, 0),
                auctionItemCount: addonData.auctionData.itemCount,
                auctionLastScan: new Date(addonData.auctionData.lastScan * 1000).toISOString(),
                auctionScanCount: addonData.auctionData.scanCount,
                auctionRealm: addonData.auctionData.realm,
                craftedCardsCount: Object.keys(addonData.craftedCards).length,
                settingsKeys: Object.keys(addonData.settings)
              },
              characterBreakdown: Object.entries(addonData.characters).map(([fullName, char]) => ({
                fullName,
                name: char.name,
                realm: char.realm,
                class: char.class,
                professionCount: char.professions.length,
                professions: char.professions.map(prof => `${prof.name} (${prof.skillLevel}/${prof.maxSkill})`),
                cardsCount: char.cards.length
              })),
              auctionSample: Object.entries(addonData.auctionData.data).slice(0, 5).map(([itemId, data]) => ({
                itemId,
                ...data
              }))
            };
            
            // Write comprehensive upload data for debugging
            this.writeDebugFile('upload-summary.json', uploadSummary);
            
            this.writeDebugFile('upload-data-full.json', {
              filePath,
              uploadTimestamp: now,
              fullAddonData: addonData
            });
            
            const uploadResult = await this.dataUploader.uploadData(addonData, filePath);
            console.log(`✓ Upload successful: ${uploadSummary.summary.totalCharacters} chars, ${uploadSummary.summary.totalProfessions} prof, ${uploadSummary.summary.auctionItemCount} items`);
            
            // Write upload result for debugging
            this.writeDebugFile('upload-result.json', {
              filePath,
              uploadResult,
              uploadSummary,
              success: true
            });
          } catch (uploadError) {
            console.error(`✗ Upload failed for ${path.basename(filePath)}:`, uploadError);
            this.lastError = `Upload failed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`;
            
            // Write upload error for debugging
            this.writeDebugFile('upload-error.json', {
              filePath,
              error: uploadError instanceof Error ? {
                message: uploadError.message,
                stack: uploadError.stack,
                name: uploadError.name
              } : uploadError
            });
          }
        }
      }

    } catch (error) {
      console.error(`Error processing file change for ${filePath}:`, error);
      this.lastError = (error as Error).message;
    }
  }

  private parseLuaData(content: string, filePath: string): AddonData | null {
    try {
      console.log('Parsing Lua file with luaparse:', path.basename(filePath));
      
      // Write raw file content for debugging
      this.writeDebugFile('raw-lua-content.json', {
        filePath,
        contentLength: content.length,
        firstChars: content.substring(0, 500),
        lastChars: content.substring(content.length - 500)
      });
      
      // Use luaparse to parse the Lua content into an AST
      const ast = luaparse.parse(content);
      
      // Extract ScribeyDB from the AST
      const scribeyDB = this.extractScribeyDBFromAST(ast);
      
      // Write parsed Lua data for debugging
      this.writeDebugFile('parsed-lua-ast.json', {
        filePath,
        astType: ast.type,
        astBody: ast.body.length,
        scribeyDBExists: !!scribeyDB,
        scribeyDBKeys: scribeyDB ? Object.keys(scribeyDB) : null,
        fullAST: ast,
        extractedScribeyDB: scribeyDB
      });
      
      if (!scribeyDB) {
        console.warn('No ScribeyDB table found in parsed Lua AST');
        return null;
      }
      
      if (!scribeyDB.character_data) {
        console.warn('No character_data section found in ScribeyDB');
        return null;
      }
      
      const characters: { [key: string]: CharacterData } = {};
      const characterData = scribeyDB.character_data || {};
      const characterNames = Object.keys(characterData);
      
      console.log(`Found ${characterNames.length} characters: ${characterNames.join(', ')}`);
      
      // Extract auction data
      const auctionData = scribeyDB.auction_prices || {};
      const auctionItemCount = auctionData.data ? Object.keys(auctionData.data).length : 0;
      console.log(`Found auction data: ${auctionItemCount} items, last scan: ${auctionData.last_scan || 'never'}`);
      
      // Write comprehensive extracted data for debugging
      this.writeDebugFile('extracted-scribey-data.json', {
        filePath,
        scribeyDBKeys: Object.keys(scribeyDB),
        characterCount: characterNames.length,
        characterNames,
        auctionItemCount,
        auctionLastScan: auctionData.last_scan,
        auctionScanCount: auctionData.scan_count,
        fullScribeyDB: scribeyDB
      });
      
      const parseResults: any[] = [];
      
      // Parse each character
      for (const [fullCharacterName, charData] of Object.entries(characterData)) {
        const parseResult: any = {
          fullCharacterName,
          rawCharData: charData,
          parseSuccess: false,
          parsedCharacter: null,
          error: null
        };
        
        try {
          const character = this.parseScribeyCharacterFromJson(fullCharacterName, charData as any);
          if (character) {
            characters[fullCharacterName] = character;
            parseResult.parseSuccess = true;
            parseResult.parsedCharacter = character;
            console.log(`✓ ${fullCharacterName}: ${character.name}@${character.realm} (${character.professions.length} prof)`);
          } else {
            parseResult.error = 'parseScribeyCharacterFromJson returned null';
            console.log(`✗ Failed to parse ${fullCharacterName}`);
          }
        } catch (error) {
          parseResult.error = error instanceof Error ? error.message : 'Unknown error';
          console.log(`✗ Error parsing ${fullCharacterName}:`, error);
        }
        
        parseResults.push(parseResult);
      }

      // Write detailed parsing results
      this.writeDebugFile('character-parse-results.json', {
        filePath,
        totalCharacters: characterNames.length,
        successfullyParsed: Object.keys(characters).length,
        parseResults,
        finalCharacters: characters
      });

      // Prepare comprehensive upload data
      const result = {
        characters,
        auctionData: {
          lastScan: auctionData.last_scan || 0,
          scanCount: auctionData.scan_count || 0,
          realm: auctionData.realm || 'Unknown',
          itemCount: auctionItemCount,
          data: auctionData.data || {}
        },
        craftedCards: scribeyDB.crafted_cards || {},
        settings: scribeyDB.settings || {},
        timestamp: Date.now(),
        version: this.extractVersion(content) || '1.0.0'
      };

      console.log(`Successfully parsed ${Object.keys(characters).length}/${characterNames.length} characters + ${auctionItemCount} auction items`);
      return result;

    } catch (error) {
      console.error('Error parsing Lua data:', error);
      
      // Write error details for debugging
      this.writeDebugFile('parse-error.json', {
        filePath,
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        contentLength: content.length
      });
      
      return null;
    }
  }

  private parseScribeyCharacterFromJson(fullName: string, charData: any): CharacterData | null {
    try {
      // Parse character data from already-parsed JSON object
      const characterName = charData.character_name || fullName.split('-')[0];
      const realmName = charData.realm_name || fullName.split('-')[1] || 'Unknown';
      const wowClass = charData.class || 'WARRIOR';
      
      // Parse professions from JSON data
      const professions: ProfessionData[] = [];
      if (charData.professions && Array.isArray(charData.professions)) {
        for (const prof of charData.professions) {
          if (prof.name) {
            professions.push({
              name: prof.name,
              skillLevel: prof.skill_level || 0,
              maxSkill: prof.max_skill_level || 525,
              recipes: [] // ScribeyDB doesn't track individual recipes
            });
          }
        }
      }
      
      return {
        name: characterName,
        realm: realmName,
        cards: [], // ScribeyDB doesn't have cards data - this is professions/auction data
        professions: professions,
        class: wowClass,
        lastUpdate: Date.now()
      };
    } catch (error) {
      return null;
    }
  }

  private extractVersion(content: string): string | null {
    const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
    return versionMatch ? versionMatch[1] : null;
  }
} 