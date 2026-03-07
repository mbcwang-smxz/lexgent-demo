
import readline from 'readline';
import { ICaseStore } from '@/shared/interfaces';

export interface IActionHandler {
    log(text: string): void;
    error(text: string): void;
    ask(question: string, timeoutMs?: number, defaultValue?: boolean): Promise<string>;
    /** Handle display_content action from server */
    displayContent?(content: string, title?: string): void;
}

export class TaskRunner {
    private caseStore: ICaseStore | null = null;

    constructor(
        private agentServerUrl: string,
        private handler: IActionHandler
    ) {}

    setCaseStore(caseStore: ICaseStore) {
        this.caseStore = caseStore;
    }

    async runTask(
        caseNumber: string,
        caseId: string,
        query: string,
        options: { verbose: boolean, reuseSandbox: boolean, agentId?: string, configId?: string }
    ) {
        this.handler.log(`[System] Initializing session via Agent Server...`);

        // 1. Create Session (Agent Server now handles session management)
        let sessionData;
        try {
            const res = await fetch(`${this.agentServerUrl}/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    caseNumber,
                    caseId,
                    agentId: options.agentId,
                    ...options
                })
            });
            if (!res.ok) throw new Error(`Failed to create session: ${res.statusText}`);
            sessionData = await res.json() as any;
        } catch (e: any) {
            this.handler.error(`[Error] Connection failed: ${e.message}`);
            return;
        }

        const sessionId = sessionData.sessionId;

        // 2. Connect SSE (Start Listening)
        const completionPromise = this.listenToEvents(sessionId);

        // 3. Submit Task
        await new Promise(r => setTimeout(r, 100));

        try {
            const res = await fetch(`${this.agentServerUrl}/session/${sessionId}/task`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });
            if (!res.ok) throw new Error(`Failed to submit task: ${res.statusText}`);
            this.handler.log(`[System] Task submitted. Waiting for Agent...`);
        } catch (e: any) {
            this.handler.error(`[Error] Task submission failed: ${e.message}`);
            return;
        }

        // Wait for task to finish
        await completionPromise;
    }

    private async listenToEvents(sessionId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = `${this.agentServerUrl}/session/${sessionId}/events`;
            const http = require('http');

            // Event queue to ensure sequential processing
            const eventQueue: Array<{ type: string; data: any }> = [];
            let processing = false;
            let completed = false;

            const processQueue = async () => {
                if (processing || eventQueue.length === 0) return;
                processing = true;

                while (eventQueue.length > 0) {
                    const evt = eventQueue.shift()!;
                    await this.processEvent(sessionId, evt, () => { completed = true; });
                    if (completed) {
                        resolve();
                        return;
                    }
                }

                processing = false;
            };

            const req = http.request(url, (res: any) => {
                if (res.statusCode !== 200) {
                    this.handler.error(`SSE Connect Failed: ${res.statusCode}`);
                    resolve();
                    return;
                }

                res.setEncoding('utf8');
                let buffer = '';
                let currentType = 'message';

                res.on('data', (chunk: string) => {
                    buffer += chunk;

                    // Process complete lines
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed === '') continue;

                        if (line.startsWith('event: ')) {
                            currentType = line.slice(7).trim();
                        } else if (line.startsWith('data: ')) {
                            const dataStr = line.slice(6);
                            try {
                                const payload = JSON.parse(dataStr);
                                // If payload has sessionId (initial msg), ignore
                                if (payload.sessionId) continue;

                                // Add to queue and process
                                eventQueue.push({ type: currentType, data: payload });
                                processQueue();
                            } catch (e) {
                                // Ignore parse errors
                            }
                        }
                    }
                });

                res.on('end', () => {
                    // Wait for queue to finish before resolving
                    const checkQueue = () => {
                        if (eventQueue.length === 0 && !processing) {
                            resolve();
                        } else {
                            setTimeout(checkQueue, 50);
                        }
                    };
                    checkQueue();
                });
            });

            req.on('error', (e: any) => {
                this.handler.error(`SSE Connection error: ${e.message}`);
                resolve();
            });

            req.end();
        });
    }

    private async processEvent(sessionId: string, evt: any, resolve: () => void) {
        if (evt.type === 'log') {
            process.stdout.write(evt.data.text + '\n');
        } else if (evt.type === 'error') {
            this.handler.error(`\n❌ AGENT ERROR: ${evt.data.text}`);
            if (evt.data.error) this.handler.error(evt.data.error);
        } else if (evt.type === 'ask') {
            const { askId, question, timeout, default: def } = evt.data;
            this.handler.log(`\n❓ INTERACTION REQUIRED:`);
            const answer = await this.handler.ask(`${question} `, timeout, def);

            // Send Reply to Agent Server
            try {
                await fetch(`${this.agentServerUrl}/session/${sessionId}/reply`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ askId, input: answer })
                });
                this.handler.log(`[System] Reply sent.\n`);
            } catch (e: any) {
                this.handler.error(`[System] Failed to send reply: ${e.message}`);
            }

        } else if (evt.type === 'action') {
            await this.handleAction(evt.data);
        } else if (evt.type === 'complete') {
            this.handler.log(`\n🏁 TASK COMPLETE (${evt.data.status}).`);
            if (evt.data.summary) this.handler.log(evt.data.summary);
            resolve();
        }
    }

    /**
     * Handle action events from server (display_content, etc.)
     */
    private async handleAction(data: { action: string; inputs?: any[]; instruction?: string; case_id: string }) {
        const { action, inputs, instruction } = data;

        if (action === 'display_content' || action === 'display_document') {
            // Mode 1: Display document content
            if (inputs && inputs.length > 0 && this.caseStore) {
                for (const file of inputs) {
                    try {
                        const content = (file as any).metadata?._content ?? await this.caseStore.readFile(file.filename);
                        const title = `${file.filename} (${file.type || 'unknown'})`;

                        console.log(`\n${'='.repeat(60)}`);
                        console.log(`  ${title}`);
                        console.log(`${'='.repeat(60)}`);
                        console.log(content);
                        console.log(`${'='.repeat(60)}\n`);
                    } catch (e: any) {
                        console.error(`Failed to display ${file.filename}: ${e.message}`);
                    }
                }
            }
            // Mode 2: Display text from instruction
            else if (instruction && instruction.trim()) {
                console.log(`\n${'='.repeat(60)}`);
                console.log(`  Agent 响应`);
                console.log(`${'='.repeat(60)}`);
                console.log(instruction);
                console.log(`${'='.repeat(60)}\n`);
            }
        } else {
            this.handler.log(`[Action] Unhandled action: ${action}`);
        }
    }
}
