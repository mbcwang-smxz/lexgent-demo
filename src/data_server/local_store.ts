import { FileSystem, CaseContextData, FileRegistryItem, findFileByFilename, upsertFile } from './utils';

export interface IDataStore {
    getCaseContext(caseId: string): Promise<CaseContextData>;
    readCaseFile(caseId: string, filename: string): Promise<string>;
    writeCaseFile(caseId: string, filename: string, content: string): Promise<void>;
    appendCaseFile(caseId: string, filename: string, content: string): Promise<void>;
    updateFileMetadata(caseId: string, filename: string, updates: Partial<FileRegistryItem>): Promise<void>;
    deleteCaseFiles(caseId: string, pattern: string): Promise<string[]>;
    getEvents(caseId: string, after?: number): Promise<any[]>;
    postEvent(caseId: string, event: any): Promise<any>;
    getReplies(caseId: string, after?: number): Promise<any[]>;
    postReply(caseId: string, reply: any): Promise<any>;
}

/**
 * LocalDataStore - Local filesystem implementation of IDataStore
 *
 * Used only within data_server internals and for testing.
 * All production code should use CaseDataStore (HTTP) instead.
 */
export class LocalDataStore implements IDataStore {
    private fs: FileSystem;

    constructor(cwd?: string) {
        this.fs = new FileSystem(cwd);
    }

    async getCaseContext(caseId: string): Promise<CaseContextData> {
        return this.fs.getCaseContext(caseId);
    }

    async readCaseFile(caseId: string, filename: string): Promise<string> {
        const content = await this.fs.readFile(caseId, filename);
        if (content === null) throw new Error(`File not found: ${filename}`);
        return content;
    }

    async writeCaseFile(caseId: string, filename: string, content: string): Promise<void> {
        await this.fs.writeFile(caseId, filename, content);
    }

    async appendCaseFile(caseId: string, filename: string, content: string): Promise<void> {
        await this.fs.appendFile(caseId, filename, content);
    }

    async updateFileMetadata(caseId: string, filename: string, updates: Partial<FileRegistryItem>): Promise<void> {
        const context = await this.fs.loadMetadata(caseId);
        const file = findFileByFilename(context.files, filename);
        if (file) {
            Object.assign(file, updates);
        } else {
            const newFile: FileRegistryItem = {
                id: updates.id || filename,
                filename,
                type: updates.type || 'unknown',
                path: updates.path || `/remote/${caseId}/${filename}`,
                lastModified: updates.lastModified ? new Date(updates.lastModified) : new Date(),
                ...updates,
            } as FileRegistryItem;
            context.files = upsertFile(context.files, newFile);
        }
        await this.fs.saveMetadata(caseId, context);
    }

    async deleteCaseFiles(caseId: string, pattern: string): Promise<string[]> {
        return this.fs.deleteFiles(caseId, pattern);
    }

    async getEvents(caseId: string, after: number = 0): Promise<any[]> {
        return this.fs.getEvents(caseId, after);
    }

    async postEvent(caseId: string, event: any): Promise<any> {
        return this.fs.appendEvent(caseId, event);
    }

    async getReplies(caseId: string, after: number = 0): Promise<any[]> {
        return this.fs.getReplies(caseId, after);
    }

    async postReply(caseId: string, reply: any): Promise<any> {
        return this.fs.appendReply(caseId, reply);
    }
}
