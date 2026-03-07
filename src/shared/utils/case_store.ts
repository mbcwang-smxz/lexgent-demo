import { ICaseStore, DocumentRef } from '@/shared/interfaces';
import { FileRegistryItem, CaseContextData } from '@/data_server/utils';

/**
 * CaseStore - Per-case data access via HTTP to Data Server
 *
 * Replaces RemoteDataStore + IOToolsWrapper with a caseId-bound interface.
 * All operations are scoped to the bound caseId.
 */
export class CaseStore implements ICaseStore {
    readonly caseId: string;
    readonly baseUrl: string;
    private readonly contextPath: string;

    constructor(caseId: string, baseUrl: string, contextPath?: string) {
        this.caseId = caseId;
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.contextPath = contextPath || `/cases/${caseId}/context`;
    }

    // --- Basic file operations ---

    async readFile(filename: string): Promise<string> {
        const url = `${this.baseUrl}/cases/${this.caseId}/files/${encodeURIComponent(filename)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`CaseStore readFile failed: ${res.statusText}`);
        return await res.text();
    }

    async writeFile(filename: string, content: string): Promise<void> {
        const url = `${this.baseUrl}/cases/${this.caseId}/files/${encodeURIComponent(filename)}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        if (!res.ok) throw new Error(`CaseStore writeFile failed: ${res.statusText}`);
    }

    async appendFile(filename: string, content: string): Promise<void> {
        const url = `${this.baseUrl}/cases/${this.caseId}/files/${encodeURIComponent(filename)}/append`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        if (!res.ok) throw new Error(`CaseStore appendFile failed: ${res.statusText}`);
    }

    async updateFileMetadata(filename: string, updates: Partial<FileRegistryItem>): Promise<void> {
        const url = `${this.baseUrl}/cases/${this.caseId}/files/${encodeURIComponent(filename)}/metadata`;
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error(`CaseStore updateFileMetadata failed: ${res.statusText}`);
    }

    async deleteFiles(pattern: string): Promise<string[]> {
        const url = `${this.baseUrl}/cases/${this.caseId}/files?pattern=${encodeURIComponent(pattern)}`;
        const res = await fetch(url, { method: 'DELETE' });
        if (!res.ok) throw new Error(`CaseStore deleteFiles failed: ${res.statusText}`);
        const json = await res.json() as { deleted: string[] };
        return json.deleted;
    }

    // --- Domain-level operations ---

    async saveDerived(doc: {
        id: string;
        type_ref?: string;
        filename: string;
        content: string;
        source?: string;
    }): Promise<{ filename: string }> {
        await this.writeFile(doc.filename, doc.content);

        const pseudo_path = `/remote/${this.caseId}/${doc.filename}`;
        await this.updateFileMetadata(doc.filename, {
            id: doc.id,
            type: doc.type_ref || doc.id,
            filename: doc.filename,
            path: pseudo_path,
            lastModified: new Date(),
        });

        return { filename: doc.filename };
    }

    async getDocumentsByType(type: string): Promise<DocumentRef[]> {
        const ctx = await this.getCaseContext();
        return ctx.files
            .filter(f => f.type === type)
            .map(f => ({
                id: f.id,
                type: f.type,
                filename: f.filename,
                lastModified: new Date(f.lastModified),
            }));
    }

    async getDocumentById(id: string): Promise<DocumentRef | null> {
        const ctx = await this.getCaseContext();
        const f = ctx.files.find(file => file.id === id);
        if (!f) return null;
        return {
            id: f.id,
            type: f.type,
            filename: f.filename,
            lastModified: new Date(f.lastModified),
        };
    }

    // --- Context ---

    async getCaseContext(): Promise<CaseContextData> {
        const url = `${this.baseUrl}${this.contextPath}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`CaseStore getCaseContext failed: ${res.statusText}`);
        return await res.json() as CaseContextData;
    }

    // --- Events ---

    async getEvents(after: number = 0): Promise<any[]> {
        const url = `${this.baseUrl}/cases/${this.caseId}/events?after=${after}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`CaseStore getEvents failed: ${res.statusText}`);
        return await res.json();
    }

    async postEvent(event: any): Promise<any> {
        const url = `${this.baseUrl}/cases/${this.caseId}/events`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event),
        });
        if (!res.ok) throw new Error(`CaseStore postEvent failed: ${res.statusText}`);
        return await res.json();
    }

    // --- Replies ---

    async getReplies(after: number = 0): Promise<any[]> {
        const url = `${this.baseUrl}/cases/${this.caseId}/reply?after=${after}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`CaseStore getReplies failed: ${res.statusText}`);
        return await res.json();
    }

    async postReply(reply: any): Promise<any> {
        const url = `${this.baseUrl}/cases/${this.caseId}/reply`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reply),
        });
        if (!res.ok) throw new Error(`CaseStore postReply failed: ${res.statusText}`);
        return await res.json();
    }
}
