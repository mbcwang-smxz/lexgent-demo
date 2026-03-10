/**
 * CaseStore - Per-case data access via HTTP to Data Server
 */

export interface ICaseStore {
    readonly caseId: string;
    readonly baseUrl: string;
    readFile(filename: string): Promise<string>;
    deleteFiles(pattern: string): Promise<string[]>;
}

export class CaseStore implements ICaseStore {
    readonly caseId: string;
    readonly baseUrl: string;

    constructor(caseId: string, baseUrl: string) {
        this.caseId = caseId;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async readFile(filename: string): Promise<string> {
        const url = `${this.baseUrl}/cases/${this.caseId}/files/${encodeURIComponent(filename)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`CaseStore readFile failed: ${res.statusText}`);
        return await res.text();
    }

    async deleteFiles(pattern: string): Promise<string[]> {
        const url = `${this.baseUrl}/cases/${this.caseId}/files?pattern=${encodeURIComponent(pattern)}`;
        const res = await fetch(url, { method: 'DELETE' });
        if (!res.ok) throw new Error(`CaseStore deleteFiles failed: ${res.statusText}`);
        const json = await res.json() as { deleted: string[] };
        return json.deleted;
    }
}
