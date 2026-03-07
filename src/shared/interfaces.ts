import { FileRegistryItem, CaseContextData } from '@/data_server/utils';

export interface IDataStore {
    // 1. Context
    getCaseContext(caseId: string): Promise<CaseContextData>;

    // 2. File Operations
    readCaseFile(caseId: string, filename: string): Promise<string>;
    writeCaseFile(caseId: string, filename: string, content: string): Promise<void>;
    appendCaseFile(caseId: string, filename: string, content: string): Promise<void>;
    updateFileMetadata(caseId: string, filename: string, updates: Partial<FileRegistryItem>): Promise<void>;
    deleteCaseFiles(caseId: string, pattern: string): Promise<string[]>;

    // 3. Events
    getEvents(caseId: string, after?: number): Promise<any[]>;
    postEvent(caseId: string, event: any): Promise<any>;

    // 4. Replies
    getReplies(caseId: string, after?: number): Promise<any[]>;
    postReply(caseId: string, reply: any): Promise<any>;
}

// ============================================================
// ICaseStore: Per-case data access interface (replaces IDataStore)
// ============================================================

export interface DocumentRef {
    id: string;
    type: string;
    filename: string;
    lastModified: Date;
}

export interface ICaseStore {
    readonly caseId: string;
    readonly baseUrl: string;

    // --- Basic file operations (caseId bound) ---
    readFile(filename: string): Promise<string>;
    writeFile(filename: string, content: string): Promise<void>;
    appendFile(filename: string, content: string): Promise<void>;
    updateFileMetadata(filename: string, updates: Partial<FileRegistryItem>): Promise<void>;
    deleteFiles(pattern: string): Promise<string[]>;

    // --- Domain-level operations ---
    saveDerived(doc: {
        id: string;
        type_ref?: string;
        filename: string;
        content: string;
        source?: string;
    }): Promise<{ filename: string }>;

    getDocumentsByType(type: string): Promise<DocumentRef[]>;
    getDocumentById(id: string): Promise<DocumentRef | null>;

    // --- Context ---
    getCaseContext(): Promise<CaseContextData>;

    // --- Events ---
    getEvents(after?: number): Promise<any[]>;
    postEvent(event: any): Promise<any>;

    // --- Replies ---
    getReplies(after?: number): Promise<any[]>;
    postReply(reply: any): Promise<any>;
}
