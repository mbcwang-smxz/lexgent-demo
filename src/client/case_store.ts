/**
 * CaseDataStore - Per-case data access via HTTP to Data Server
 */

export interface FileListItem {
    id: string;
    filename: string;
    type: string;
    size: number;
}

export interface ICaseDataStore {
    readonly caseId: string;
    readonly baseUrl: string;
    readFile(filename: string): Promise<string>;
    deleteFiles(pattern: string): Promise<string[]>;
    listFiles(): Promise<FileListItem[]>;
}

export class CaseDataStore implements ICaseDataStore {
    readonly caseId: string;
    readonly baseUrl: string;

    constructor(caseId: string, baseUrl: string) {
        this.caseId = caseId;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async readFile(filename: string): Promise<string> {
        const url = `${this.baseUrl}/cases/${this.caseId}/files/${encodeURIComponent(filename)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`CaseDataStore readFile failed: ${res.statusText}`);
        return await res.text();
    }

    async listFiles(): Promise<FileListItem[]> {
        const [metaRes, scanRes] = await Promise.all([
            fetch(`${this.baseUrl}/cases/${this.caseId}/metadata`),
            fetch(`${this.baseUrl}/cases/${this.caseId}/files/scan`),
        ]);
        if (!metaRes.ok) throw new Error(`CaseDataStore listFiles metadata failed: ${metaRes.statusText}`);
        if (!scanRes.ok) throw new Error(`CaseDataStore listFiles scan failed: ${scanRes.statusText}`);
        const meta = await metaRes.json() as { files: { id: string; type: string; filename: string }[] };
        const scan = await scanRes.json() as { files: { filename: string; size: number }[] };

        const sizeMap = new Map<string, number>();
        for (const f of scan.files) sizeMap.set(f.filename, f.size);

        return (meta.files || []).map((f: any) => ({
            id: f.id,
            filename: f.filename,
            type: f.type || '',
            size: sizeMap.get(f.filename) ?? 0,
        }));
    }

    async deleteFiles(pattern: string): Promise<string[]> {
        const url = `${this.baseUrl}/cases/${this.caseId}/files?pattern=${encodeURIComponent(pattern)}`;
        const res = await fetch(url, { method: 'DELETE' });
        if (!res.ok) throw new Error(`CaseDataStore deleteFiles failed: ${res.statusText}`);
        const json = await res.json() as { deleted: string[] };
        return json.deleted;
    }
}
