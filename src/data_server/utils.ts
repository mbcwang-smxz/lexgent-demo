import fs from 'fs-extra';
import path from 'path';

export interface FileRegistryItem {
    id: string;
    type: string;
    filename: string;
    path: string;
    caseId?: string; // Injected by ContextManager for API access
    lastModified: Date;
    /** Expiration timestamp (ms since epoch). If set, file is considered expired after this time. */
    expiresAt?: number;
    metadata?: Record<string, any>;
}

export interface CaseContextData {
    caseId: string;
    files: FileRegistryItem[];
    metadata: Record<string, any>;
}

// =============================================================================
// Helper Functions for FileRegistryItem[] operations
// =============================================================================

export function findFileById(files: FileRegistryItem[], id: string): FileRegistryItem | undefined {
    return files.find(f => f.id === id);
}

export function findFileByFilename(files: FileRegistryItem[], filename: string): FileRegistryItem | undefined {
    return files.find(f => f.filename === filename);
}

export function upsertFile(files: FileRegistryItem[], file: FileRegistryItem): FileRegistryItem[] {
    const index = files.findIndex(f => f.id === file.id);
    if (index >= 0) {
        const newFiles = [...files];
        newFiles[index] = file;
        return newFiles;
    }
    return [...files, file];
}

export function removeFileById(files: FileRegistryItem[], id: string): FileRegistryItem[] {
    return files.filter(f => f.id !== id);
}

export function getMaxRIndex(files: FileRegistryItem[]): number {
    let maxR = 0;
    for (const file of files) {
        if (file.id.startsWith('R')) {
            const num = parseInt(file.id.substring(1));
            if (!isNaN(num) && num > maxR) maxR = num;
        }
    }
    return maxR;
}

export function getMaxPIndex(files: FileRegistryItem[]): number {
    let maxP = 0;
    for (const file of files) {
        if (file.id.startsWith('P')) {
            const num = parseInt(file.id.substring(1));
            if (!isNaN(num) && num > maxP) maxP = num;
        }
    }
    return maxP;
}

export function getMaxUIndex(files: FileRegistryItem[]): number {
    let maxU = 0;
    for (const file of files) {
        if (file.id.startsWith('U')) {
            const num = parseInt(file.id.substring(1));
            if (!isNaN(num) && num > maxU) maxU = num;
        }
    }
    return maxU;
}

export function getMaxXIndex(files: FileRegistryItem[]): number {
    let maxX = 0;
    for (const file of files) {
        if (file.id.startsWith('X')) {
            const num = parseInt(file.id.substring(1));
            if (!isNaN(num) && num > maxX) maxX = num;
        }
    }
    return maxX;
}

/**
 * Migrate files from old dict format to new array format.
 * Used for backward compatibility when loading old metadata.json files.
 */
export function migrateFilesFromDict(files: Record<string, FileRegistryItem> | FileRegistryItem[]): FileRegistryItem[] {
    if (Array.isArray(files)) return files;
    return Object.values(files);
}

export interface AgentEvent {
    id: string;
    type: 'LOG' | 'CONFIRM_REQ' | 'TASK_COMPLETE' | 'ERROR';
    timestamp: number;
    payload: any;
}

export interface UserReply {
    id: string;
    timestamp: number;
    payload: any; // e.g. { confirmed: true } or { input: "..." }
}

export class FileSystem {
    private baseDir: string;
    private runsDir: string;
    private resumeMode: boolean;

    constructor(baseDir: string = process.cwd(), resumeMode: boolean = false) {
        this.baseDir = path.resolve(baseDir);
        this.runsDir = path.join(this.baseDir, '.runs');
        this.resumeMode = resumeMode;
        console.log(`[CaseServer] FileSystem initialized with resumeMode=${this.resumeMode}`);
    }

    /**
     * Initializes the case directory.
     * If resumeMode is false (default), it resets the directory (delete & copy).
     * If resumeMode is true, it keeps existing data if present.
     */
    async findLatestCaseId(): Promise<string | null> {
        if (!await fs.pathExists(this.runsDir)) return null;
        const dirs = await fs.readdir(this.runsDir);
        let latest: { id: string, mtime: number } | null = null;
        
        for (const dir of dirs) {
            const fullPath = path.join(this.runsDir, dir);
            const stat = await fs.stat(fullPath);
            if (stat.isDirectory() && dir.startsWith('case-')) {
                // Check if valid case dir
                if (stat.mtimeMs > (latest?.mtime || 0)) {
                    latest = { id: dir, mtime: stat.mtimeMs };
                }
            }
        }
        return latest?.id || null;
    }

    /**
     * Initializes the case directory.
     * @param caseId The target case ID to initialize (e.g. 'case-101' or 'case-123456')
     * @param options.reset If true, deletes existing directory.
     * @param options.caseNumber Optional metadata.
     * @param options.sourceTemplateId The source data directory to copy from (e.g. 'case-101'). Defaults to caseId.
     */
    async initializeCase(caseId: string, options?: { reset?: boolean, caseNumber?: string }): Promise<string> {
        const caseDir = this.resolveCaseDir(caseId);
        
        // Determine whether to reset
        const shouldReset = options?.reset !== undefined ? options.reset : !this.resumeMode;

        // 1. Try to Resume
        if (!shouldReset && await fs.pathExists(caseDir)) {
            console.log(`[CaseServer] Resuming existing case directory: ${caseDir}`);
            if (options?.caseNumber) {
                 const ctx = await this.loadMetadata(caseId);
                 ctx.metadata.caseNumber = options.caseNumber;
                 await this.saveMetadata(caseId, ctx);
            }
            return caseDir;
        }

        // 2. Prepare for Creation/Reset
        // Logic: Must find source in 'data/case-data/<caseId>'
        const sourceDir = path.join(this.baseDir, 'data', 'case-data', caseId);
        
        if (!await fs.pathExists(sourceDir)) {
             console.warn(`[CaseServer] Template not found: ${sourceDir}. Creating empty case.`);
             // Create empty dir
             await fs.remove(caseDir);
             await fs.ensureDir(caseDir);
             // Create initial metadata
             await this.saveMetadata(caseId, {
                 caseId,
                 files: [],
                 metadata: {
                     caseNumber: options?.caseNumber || caseId,
                     created: new Date().toISOString()
                 }
             });
             return caseDir;
        }

        console.log(`[CaseServer] Resetting/Creating case directory: ${caseDir} from ${sourceDir}`);

        // Preserve cache if resetting same dir (optional, but good UX)
        const cachePath = path.join(caseDir, 'llm_cache.json');
        let cacheContent: any = null;
        if (await fs.pathExists(cachePath)) {
             try { cacheContent = await fs.readJson(cachePath); } catch {}
        }

        await fs.remove(caseDir);
        await fs.ensureDir(caseDir);

        if (cacheContent) {
            await fs.writeJson(path.join(caseDir, 'llm_cache.json'), cacheContent, { spaces: 2 });
        }

        // 3. Copy Data
        console.log(`[CaseServer] Copying data from ${sourceDir} to ${caseDir}`);
        const files = await fs.readdir(sourceDir);
        for (const file of files) {
            if (file.endsWith('.json') && file !== 'metadata.json') continue; // Skip cache/events if any in source? Usually source has raw files.
            // Copy everything including metadata.json if present
            await fs.copy(path.join(sourceDir, file), path.join(caseDir, file));
        }

        // 4. Scan files and build metadata (registers P##/U##/D## from physical files)
        const ctx = await this.getCaseContext(caseId);
        if (options?.caseNumber) {
            ctx.metadata.caseNumber = options.caseNumber;
            await this.saveMetadata(caseId, ctx);
        }

        return caseDir;
    }

    resolveCaseDir(caseId: string): string {
        return path.join(this.runsDir, caseId);
    }

    resolveFilePath(caseId: string, filename: string): string {
        return path.join(this.resolveCaseDir(caseId), filename);
    }
    
    async loadMetadata(caseId: string): Promise<CaseContextData> {
        const metaPath = this.resolveFilePath(caseId, 'metadata.json');
        if (await fs.pathExists(metaPath)) {
            const data = await fs.readJson(metaPath);
            // Handle null/undefined data
            if (!data) {
                return { caseId, files: [], metadata: {} };
            }
            // Migrate from old dict format if needed
            if (data.files && !Array.isArray(data.files)) {
                data.files = migrateFilesFromDict(data.files);
            }
            // Ensure files is an array
            if (!data.files) {
                data.files = [];
            }
            return data;
        }
        return { caseId, files: [], metadata: {} };
    }

    async saveMetadata(caseId: string, data: CaseContextData): Promise<void> {
        const metaPath = this.resolveFilePath(caseId, 'metadata.json');
        await fs.ensureDir(path.dirname(metaPath));
        await fs.writeJson(metaPath, data, { spaces: 2 });
    }

    // --- Event & Reply Handling ---

    async appendEvent(caseId: string, event: Omit<AgentEvent, 'timestamp'>): Promise<AgentEvent> {
        const fullEvent: AgentEvent = {
            ...event,
            timestamp: Date.now()
        };
        const filePath = this.resolveFilePath(caseId, 'events.jsonl');
        await fs.ensureDir(path.dirname(filePath));
        await fs.appendFile(filePath, JSON.stringify(fullEvent) + '\n', 'utf8');
        return fullEvent;
    }

    async getEvents(caseId: string, afterTimestamp: number = 0): Promise<AgentEvent[]> {
        const filePath = this.resolveFilePath(caseId, 'events.jsonl');
        if (!await fs.pathExists(filePath)) return [];
        
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        const events = lines.map(line => JSON.parse(line) as AgentEvent);
        
        return events.filter(e => e.timestamp > afterTimestamp);
    }

    async appendReply(caseId: string, reply: any): Promise<UserReply> {
        const fullReply: UserReply = {
            id: `reply-${Date.now()}`,
            timestamp: Date.now(),
            payload: reply
        };
        const filePath = this.resolveFilePath(caseId, 'replies.jsonl');
        await fs.ensureDir(path.dirname(filePath));
        await fs.appendFile(filePath, JSON.stringify(fullReply) + '\n', 'utf8');
        return fullReply;
    }

    async getReplies(caseId: string, afterTimestamp: number = 0): Promise<UserReply[]> {
        const filePath = this.resolveFilePath(caseId, 'replies.jsonl');
        if (!await fs.pathExists(filePath)) return [];
        
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        const replies = lines.map(line => JSON.parse(line) as UserReply);
        
        return replies.filter(r => r.timestamp > afterTimestamp);
    }

    async getCaseContext(caseId: string): Promise<CaseContextData> {
        const caseDir = this.resolveCaseDir(caseId);
        if (!await fs.pathExists(caseDir)) {
            return { caseId, files: [], metadata: {} };
        }

        const context = await this.loadMetadata(caseId);
        const physicalFiles = await fs.readdir(caseDir);
        const now = Date.now();

        // Find max indices for new file ID assignment
        let pIndex = getMaxPIndex(context.files) + 1;
        let uIndex = getMaxUIndex(context.files) + 1;

        // Sync physical files to registry
        const currentFilenames = new Set(physicalFiles);

        // 1. Remove deleted files and expired files from registry
        const filesToKeep: FileRegistryItem[] = [];
        for (const file of context.files) {
            // Remove if file no longer exists on disk
            if (!currentFilenames.has(file.filename)) {
                continue;
            }
            // Remove and delete expired temporary files
            if (file.expiresAt && file.expiresAt < now) {
                console.log(`[CaseServer] Removing expired file: ${file.filename}`);
                await fs.remove(path.join(caseDir, file.filename));
                continue;
            }
            filesToKeep.push(file);
        }
        context.files = filesToKeep;

        // 2. Add new files to registry
        const SYSTEM_FILES = new Set(['metadata.json', 'llm_cache.json', 'case_file_list_metadata.txt', 'system_skills_metadata.txt']);
        for (const filename of physicalFiles) {
            if (SYSTEM_FILES.has(filename) || filename.endsWith('.jsonl') || filename.startsWith('sys_')) continue;

            const isRegistered = context.files.some(f => f.filename === filename);
            if (!isRegistered) {
                const isPdfOrOffice = /\.(pdf|docx|doc)$/i.test(filename);
                // D## for derived (AI-generated), P## for PDF/office, U## for unclassified text
                let id: string;
                let type: string;
                if (filename.startsWith('D')) {
                    // D## ID from filename prefix: "D01_当事人信息.json" → id="D01", type="当事人信息"
                    const parts = filename.split('_');
                    id = parts[0];
                    const nameWithExt = parts.slice(1).join('_');
                    type = nameWithExt.replace(/\.[^.]+$/, '') || '衍生文档';
                } else if (isPdfOrOffice) {
                    id = `P${String(pIndex++).padStart(2, '0')}`;
                    type = '待转换文档';
                } else {
                    id = `U${String(uIndex++).padStart(2, '0')}`;
                    type = '未分类文档';
                }
                context.files.push({
                    id,
                    type,
                    filename,
                    path: `${caseId}/${filename}`,
                    lastModified: (await fs.stat(this.resolveFilePath(caseId, filename))).mtime
                });
            }
        }

        // Save updated context to ensure metadata.json exists and is up-to-date
        await this.saveMetadata(caseId, context);

        return context;
    }

    async listFiles(caseId: string): Promise<string[]> {
        const dir = this.resolveCaseDir(caseId);
        if (!await fs.pathExists(dir)) return [];
        return fs.readdir(dir);
    }

    async readFile(caseId: string, filename: string): Promise<string | null> {
        const filePath = this.resolveFilePath(caseId, filename);
        if (!await fs.pathExists(filePath)) return null;
        return fs.readFile(filePath, 'utf-8');
    }

    async writeFile(caseId: string, filename: string, content: string): Promise<void> {
        const filePath = this.resolveFilePath(caseId, filename);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, content, 'utf-8');
    }

    async appendFile(caseId: string, filename: string, content: string): Promise<void> {
        const filePath = this.resolveFilePath(caseId, filename);
        await fs.ensureDir(path.dirname(filePath));
        await fs.appendFile(filePath, content, 'utf-8');
    }

    async deleteFiles(caseId: string, pattern: string): Promise<string[]> {
        const caseDir = this.resolveCaseDir(caseId);
        if (!await fs.pathExists(caseDir)) return [];

        const files = await fs.readdir(caseDir);
        const deleted: string[] = [];

        for (const file of files) {
             // Safety Checks - Critical!
             if (file === 'metadata.json' || file === 'llm_cache.json' || file.startsWith('events') || file.startsWith('replies')) continue;
             if (file.startsWith('R')) continue; // Protect Raw Evidence

             // Simple Pattern Match
             let match = false;
             if (pattern === '*' || pattern === 'all') match = true; // Still subject to Safety Checks
             else if (pattern.endsWith('*')) match = file.startsWith(pattern.slice(0, -1));
             else if (pattern.startsWith('*')) match = file.endsWith(pattern.slice(1));
             else match = file === pattern;

             if (match) {
                 await fs.remove(path.join(caseDir, file));
                 deleted.push(file);
             }
        }
        
        // Force refresh metadata to reflect deletions
        await this.getCaseContext(caseId);
        
        return deleted;
    }
}