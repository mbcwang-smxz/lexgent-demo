/// <reference path="../types/modules.d.ts" />
import readline from 'readline';
import { CONFIG } from '@/config/settings';
import { CaseDataStore } from './case_store';
import { parseArgs } from './args';
import { TaskRunner, IActionHandler } from './runner';

const AGENT_SERVER_URL = CONFIG.system.agentServerUrl;
const DATA_SERVER_URL = CONFIG.system.dataServerUrl;
const YAML_SERVER_URL = CONFIG.system.yamlServerUrl;

async function checkServerConnection(url: string, serverName: string): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        await fetch(url, { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);
        return true;
    } catch (e: any) {
        const cause = e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : '';
        console.error(`\n❌ 无法连接到 ${serverName} (${url}): ${e.message}${cause}`);
        return false;
    }
}

// --- CLI Helper functions for Interactive Mode ---

async function askLocal(query: string, rl: readline.Interface): Promise<string | null> {
    return new Promise(resolve => {
        rl.question(query, ans => {
            resolve(ans);
        });
    });
}

async function fetchSkillMap(agentId: string): Promise<Record<string, { query: string, desc: string, alias?: string, params?: string }>> {
    const url = `${AGENT_SERVER_URL}/agent/${agentId}/skills?yamlServerUrl=${encodeURIComponent(YAML_SERVER_URL)}`;
    try {
        console.log(`[debug] fetchSkillMap: GET ${url}`);
        const res = await fetch(url);
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`${res.status} ${res.statusText} - ${body}`);
        }
        const data = await res.json() as any;
        console.log(`[debug] fetchSkillMap: got ${Object.keys(data).length} skills`);
        return data;
    } catch (e: any) {
        throw new Error(`无法连接到 Agent Server (${AGENT_SERVER_URL}): ${e.message}`);
    }
}

async function fetchFunctionMap(agentId: string): Promise<Record<string, { desc: string; alias?: string; params?: string }>> {
    const url = `${AGENT_SERVER_URL}/agent/${agentId}/functions?yamlServerUrl=${encodeURIComponent(YAML_SERVER_URL)}`;
    try {
        console.log(`[debug] fetchFunctionMap: GET ${url}`);
        const res = await fetch(url);
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`${res.status} ${res.statusText} - ${body}`);
        }
        const data = await res.json() as any;
        console.log(`[debug] fetchFunctionMap: got ${Object.keys(data).length} functions`);
        return data;
    } catch (e: any) {
        throw new Error(`无法连接到 Agent Server (${AGENT_SERVER_URL}): ${e.message}`);
    }
}

async function fetchTaskMap(agentId: string): Promise<Record<string, { desc: string; alias?: string; params?: string }>> {
    const url = `${AGENT_SERVER_URL}/agent/${agentId}/tasks?yamlServerUrl=${encodeURIComponent(YAML_SERVER_URL)}`;
    try {
        console.log(`[debug] fetchTaskMap: GET ${url}`);
        const res = await fetch(url);
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`${res.status} ${res.statusText} - ${body}`);
        }
        const data = await res.json() as any;
        console.log(`[debug] fetchTaskMap: got ${Object.keys(data).length} tasks`);
        return data;
    } catch (e: any) {
        throw new Error(`无法连接到 Agent Server (${AGENT_SERVER_URL}): ${e.message}`);
    }
}

/**
 * Initialize case via Data Server
 */
async function initCase(caseNumber: string, reset: boolean): Promise<{ caseId: string, warning?: string }> {
    const res = await fetch(`${DATA_SERVER_URL}/cases/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseNumber, reset })
    });

    if (!res.ok) {
        throw new Error(`Failed to initialize case: ${res.statusText}`);
    }

    const data = await res.json();
    return { caseId: data.caseId, warning: data.warning };
}

/**
 * Display skill list
 */
function displaySkillList(skillMap: Record<string, { query: string, desc: string, alias?: string, params?: string }>) {
    console.log("\n可用技能列表:");
    console.log("─".repeat(60));
    for (const [id, info] of Object.entries(skillMap)) {
        const alias = info.alias || '';
        const params = info.params ? ` (${info.params})` : '';
        console.log(`  ${alias ? `/${alias}` : ''.padEnd(4)} ${info.desc}${params}`);
    }
    console.log("─".repeat(60));
    console.log("用法: /alias [args]  例如: /s01 或 /Skill_当事人提取\n");
}

/**
 * Display function list
 */
function displayFunctionList(funcMap: Record<string, { desc: string; alias?: string; params?: string }>) {
    console.log("\n可用函数(Function)列表:");
    console.log("─".repeat(60));
    for (const [id, info] of Object.entries(funcMap)) {
        const alias = info.alias ? `/${info.alias}` : '';
        const params = info.params ? ` (${info.params})` : '';
        console.log(`  ${alias.padEnd(6)} ${info.desc}${params}`);
    }
    console.log("─".repeat(60));
    console.log("用法: /alias(val1,val2) 或 /alias{key=val}  例如: /f91(1,2)\n");
}

/**
 * Display task list
 */
function displayTaskList(taskMap: Record<string, { desc: string; alias?: string; params?: string }>) {
    console.log("\n可用任务(Task)列表:");
    console.log("─".repeat(60));
    for (const [id, info] of Object.entries(taskMap)) {
        const alias = info.alias ? `/${info.alias}` : '';
        const params = info.params ? ` (${info.params})` : '';
        console.log(`  ${alias.padEnd(6)} ${info.desc}${params}`);
    }
    console.log("─".repeat(60));
    console.log("用法: /alias{key=val}  例如: /t01{query=诉讼时效}\n");
}

/**
 * Parse a slash command into targetId and args.
 * Supports: /f_sum(1, 2)  /f92{a=111, b=222}  /f_sum free text
 */
function parseSlashCommand(input: string): { targetId: string; args: string } {
    const raw = input.trim().substring(1); // remove leading /
    const bracketIdx = raw.search(/[({]/);
    if (bracketIdx !== -1 && (raw.endsWith(')') || raw.endsWith('}'))) {
        return { targetId: raw.substring(0, bracketIdx), args: raw.substring(bracketIdx) };
    }
    const spaceIdx = raw.indexOf(' ');
    if (spaceIdx === -1) return { targetId: raw, args: '' };
    return { targetId: raw.substring(0, spaceIdx), args: raw.substring(spaceIdx + 1) };
}

async function main() {
    const config = parseArgs(process.argv.slice(2));

    if (config.help) {
        const cmd = 'ts-node src/client/index.ts';
        console.log(`
LexGent 客户端工具使用说明:
  基本用法:
    ${cmd} -skill 01        # 运行 Skill_当事人提取
    ${cmd} -all             # 运行全流程
    ${cmd} "你的指令"         # 运行自定义指令
    ${cmd}                  # 进入交互模式 (默认)

  选项:
    -c, --case-number <No.>  指定案号 (默认: 默认案号111)
    -ts, --test-skill <ID>   运行指定技能 (测试模式)
    -ta, --test-all          运行全流程 (测试模式)
    -a, --agent <ID>         指定 Agent (默认: law_agent)
    --reset-case             强制重置环境 (不使用现有数据的 Sandbox)
    -l, --list               列出所有可用技能
    -i, --interactive        进入交互模式
    -v, --verbose            显示详细日志
    -h, --help               显示此帮助信息

  环境变量:
    LLM_CACHE_ENABLED=false  禁用 LLM 缓存
`);
        return;
    }

    // Check Servers
    const agentServerOk = await checkServerConnection(AGENT_SERVER_URL, 'Agent Server');
    const dataServerOk = await checkServerConnection(DATA_SERVER_URL, 'Data Server');

    if (!agentServerOk || !dataServerOk) {
        process.exit(1);
    }

    const agentId = config.agentId;

    let SKILL_MAP: Record<string, { query: string, desc: string, alias?: string, params?: string }> = {};
    try {
        SKILL_MAP = await fetchSkillMap(agentId);
    } catch (e: any) {
        console.error(`\n❌ 初始化失败: ${e.message}`);
        process.exit(1);
    }

    if (config.action === 'list') {
        displaySkillList(SKILL_MAP);
        return;
    }

    console.log(`\n🚀 LexGent Client Starting...`);
    console.log(`案件号: ${config.caseNumber}`);
    console.log(`Agent Engine: ${AGENT_SERVER_URL}`);
    console.log(`Data Server:  ${DATA_SERVER_URL}`);
    console.log(`YAML Server:  ${YAML_SERVER_URL}`);
    console.log(`模式: ${!config.isInteractive ? 'One-shot Task' : 'Interactive Mode'}`);
    console.log(`----------------------------------------`);

    // Initialize case via Data Server
    let caseId: string;
    try {
        const initResult = await initCase(config.caseNumber, !config.reuseSandbox);
        caseId = initResult.caseId;
        console.log(`[System] Case initialized: ${caseId}`);
        if (initResult.warning) {
            console.log(`⚠️  ${initResult.warning}`);
        }
    } catch (e: any) {
        console.error(`\n❌ Case initialization failed: ${e.message}`);
        process.exit(1);
    }

    // Create readline interface
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // Action Handler
    const cliHandler: IActionHandler = {
        log: (text) => console.log(text),
        error: (text) => console.error(text),
        ask: async (q) => {
            return (await askLocal(q + ' ', rl)) ?? '';
        },
        displayContent: (content, title) => {
            console.log(`\n${'='.repeat(3)} ${title || '内容'} ${'='.repeat(3)}`);
            console.log(content);
            console.log(`${'='.repeat((title?.length || 4) + 8)}\n`);
        }
    };

    // Create CaseDataStore for data access
    const caseDataStore = new CaseDataStore(caseId, DATA_SERVER_URL);

    const runner = new TaskRunner(AGENT_SERVER_URL, cliHandler, { dataServerUrl: DATA_SERVER_URL, yamlServerUrl: YAML_SERVER_URL });
    runner.setCaseDataStore(caseDataStore);
    const runOptions = {
        verbose: config.verbose,
        reuseSandbox: config.reuseSandbox,
        agentId,
        configId: config.configId,
    };

    // Non-interactive mode
    if (!config.isInteractive) {
        let query = config.query || '';
        if (config.skillId) {
            const info = SKILL_MAP[config.skillId];
            if (!info) {
                console.error(`Error: 未知技能 ID '${config.skillId}'`);
                rl.close();
                return;
            }
            query = info.query;
        }

        if (query) {
            if (query.startsWith('/')) {
                // Slash command → direct execution (no LLM analysis)
                const sessRes = await fetch(`${AGENT_SERVER_URL}/session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ caseNumber: config.caseNumber, caseId, agentId, configId: config.configId, dataServerUrl: DATA_SERVER_URL, yamlServerUrl: YAML_SERVER_URL })
                });
                const sess = await sessRes.json();

                const { targetId, args } = parseSlashCommand(query);

                const res = await fetch(`${AGENT_SERVER_URL}/agent/${agentId}/execute_command`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: sess.sessionId, targetId, args })
                });

                if (!res.ok) {
                    const errData = await res.json().catch(() => ({ error: res.statusText }));
                    console.error(`[Command] Error: ${errData.error || res.statusText}`);
                } else {
                    // Wait briefly for SSE completion
                    const { EventSource } = await import('eventsource');
                    await new Promise<void>((resolve) => {
                        // @ts-ignore
                        const sse = new EventSource(`${AGENT_SERVER_URL}/session/${sess.sessionId}/events`);
                        sse.addEventListener('log', (event: any) => {
                            try { const d = JSON.parse(event.data); console.log(d.text || d.message); } catch {}
                        });
                        sse.addEventListener('error', (event: any) => {
                            try { const d = JSON.parse(event.data); console.error(`Error: ${d.text || d.message}`); } catch {}
                        });
                        sse.addEventListener('complete', () => { sse.close(); resolve(); });
                    });
                }
            } else {
                await runner.runTask(config.caseNumber, caseId, query, runOptions);
            }
        }
        rl.close();
        process.exit(0);
    }

    // === Interactive Mode ===
    if (!process.stdin.isTTY) {
        console.error("Interactive mode requires TTY");
        process.exit(1);
    }

    console.log("进入交互模式。");
    console.log("  /skill_id     - 执行技能 (例: /s01, /Skill_当事人提取)");
    console.log("  /func_id      - 执行函数 (例: /f_赔偿计算, /Func_赔偿计算)");
    console.log("  / 或 /s       - 显示技能列表");
    console.log("  /f            - 显示工具(Function)列表");
    console.log("  /t            - 显示任务(Task)列表");
    console.log("  !clear-cache  - 清除LLM缓存");
    console.log("  !reset-context - 重置上下文（删除生成的文件）");
    console.log("  exit          - 退出");
    console.log("");

    // Initialize Session
    let currentSessionId: string = '';
    try {
        const res = await fetch(`${AGENT_SERVER_URL}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caseNumber: config.caseNumber, caseId, agentId, configId: config.configId, dataServerUrl: DATA_SERVER_URL, yamlServerUrl: YAML_SERVER_URL, verbose: config.verbose, reuseSandbox: config.reuseSandbox })
        });
        const sess = await res.json();
        currentSessionId = sess.sessionId;
    } catch (e) {
        console.error("Failed to init session:", e);
        process.exit(1);
    }

    // Completion promise for waiting on skill execution
    let commandCompleteResolve: (() => void) | null = null;

    let inProgressLine = false;

    // Setup SSE listener with sequential event queue
    // EventSource fires callbacks synchronously — async handlers can overlap.
    // A queue ensures each handler finishes before the next starts (critical for
    // action → complete ordering: display content must finish before prompt returns).
    const sseQueue: Array<() => Promise<void>> = [];
    let sseProcessing = false;
    const enqueueSse = (handler: () => Promise<void>) => {
        sseQueue.push(handler);
        if (!sseProcessing) {
            sseProcessing = true;
            (async () => {
                while (sseQueue.length > 0) {
                    const fn = sseQueue.shift()!;
                    await fn();
                }
                sseProcessing = false;
            })();
        }
    };

    const { EventSource } = await import('eventsource');
    // @ts-ignore
    const sse = new EventSource(`${AGENT_SERVER_URL}/session/${currentSessionId}/events`);

    sse.addEventListener('log', (event: any) => {
        enqueueSse(async () => {
            try {
                const data = JSON.parse(event.data);
                if (data.skillId && data.skillTitle) {
                    process.stdout.write(`\r⚙ ${data.skillTitle}...  `);
                    inProgressLine = true;
                } else {
                    if (inProgressLine) { process.stdout.write('\n'); inProgressLine = false; }
                    cliHandler.log(data.text || data.message);
                }
            } catch (e) { /* ignore */ }
        });
    });

    sse.addEventListener('error', (event: any) => {
        enqueueSse(async () => {
            try {
                const data = JSON.parse(event.data);
                cliHandler.error(`❌ ${data.text || data.message}`);
            } catch (e) { /* ignore */ }
        });
    });

    sse.addEventListener('action', (event: any) => {
        enqueueSse(async () => {
            try {
                const data = JSON.parse(event.data);
                if (data.action === 'display_content' || data.action === 'display_document') {
                    const inputs = data.inputs as { filename: string; type?: string }[] | undefined;
                    if (inputs && inputs.length > 0) {
                        for (const file of inputs) {
                            try {
                                const content = (file as any).metadata?._content ?? await caseDataStore.readFile(file.filename);
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
                    } else if (data.instruction?.trim()) {
                        console.log(`\n${'='.repeat(60)}`);
                        console.log(`  Agent 响应`);
                        console.log(`${'='.repeat(60)}`);
                        console.log(data.instruction);
                        console.log(`${'='.repeat(60)}\n`);
                    }
                }
            } catch (e) { /* ignore */ }
        });
    });

    sse.addEventListener('complete', (event: any) => {
        enqueueSse(async () => {
            try {
                const data = JSON.parse(event.data);
                if (inProgressLine) { process.stdout.write('\n'); inProgressLine = false; }
                cliHandler.log(`\n✅ Task ${data.status === 'success' ? 'completed' : 'failed'}`);
                if (commandCompleteResolve) {
                    commandCompleteResolve();
                }
            } catch (e) { /* ignore */ }
        });
    });

    sse.addEventListener('ask', (event: any) => {
        enqueueSse(async () => {
            try {
                const data = JSON.parse(event.data);
                const { askId, question, default: defaultValue } = data;

                const answer = await askLocal(question + ' ', rl);
                const finalAnswer = answer?.trim() || (defaultValue ? 'y' : 'n');

                await fetch(`${AGENT_SERVER_URL}/session/${currentSessionId}/reply`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ askId, input: finalAnswer })
                });
            } catch (e) {
                console.error('[Ask] Error:', e);
            }
        });
    });

    // Command handler
    const handleCommand = async (input: string) => {
        const { targetId, args } = parseSlashCommand(input);

        if (!targetId) {
            console.log("Error: 未指定目标 ID");
            return;
        }

        // Create promise to wait for completion
        const completionPromise = new Promise<void>(resolve => {
            commandCompleteResolve = resolve;
        });

        try {
            console.log(`\n[Command] Executing: ${targetId}`);
            if (args) console.log(`[Command] Args: ${args}`);

            const res = await fetch(`${AGENT_SERVER_URL}/agent/${agentId}/execute_command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: currentSessionId,
                    command: 'skill',
                    targetId,
                    args
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({ error: res.statusText }));
                console.error(`[Command] Error: ${errData.error || res.statusText}`);
                commandCompleteResolve = null;
                return;
            }

            // Wait for skill to complete
            await completionPromise;
        } catch (e: any) {
            console.error("[Command] Error:", e.message);
        } finally {
            commandCompleteResolve = null;
        }
    };

    // Main loop
    const prompt = () => {
        rl.question('LexGent>', async (input) => {
            input = input.trim();

            // Exit commands
            if (input === 'exit' || input === 'quit') {
                console.log('Goodbye!');
                sse.close();
                rl.close();
                process.exit(0);
            }

            // Empty input
            if (!input) {
                prompt();
                return;
            }

            // Exclamation commands (!command)
            if (input.startsWith('!')) {
                const cmd = input.substring(1).toLowerCase().trim();

                if (cmd === 'clear-cache') {
                    try {
                        const res = await fetch(`${AGENT_SERVER_URL}/agent/${agentId}/clear-cache`, { method: 'POST' });
                        const data = await res.json() as { message?: string; status?: string };
                        console.log(`[Cache] ${data.message || data.status}`);
                    } catch (e: any) {
                        console.error(`[Cache] Error: ${e.message}`);
                    }
                    prompt();
                    return;
                }

                if (cmd === 'reset-context') {
                    try {
                        const deleted = await caseDataStore.deleteFiles('D*');
                        console.log(`[Context] Reset complete. Deleted: ${deleted.length} files`);
                        if (deleted.length > 0) {
                            console.log(`  Files: ${deleted.join(', ')}`);
                        }
                    } catch (e: any) {
                        console.error(`[Context] Error: ${e.message}`);
                    }
                    prompt();
                    return;
                }

                console.log(`Unknown command: ${input}`);
                console.log(`Available: !clear-cache, !reset-context`);
                prompt();
                return;
            }

            // Slash commands
            if (input.startsWith('/')) {
                // List commands
                if (input === '/' || input === '/list') {
                    displaySkillList(SKILL_MAP);
                    try {
                        const funcMap = await fetchFunctionMap(agentId);
                        displayFunctionList(funcMap);
                    } catch (e: any) { console.error(`[debug] fetchFunctionMap error: ${e.message}`); }
                    try {
                        const taskMap = await fetchTaskMap(agentId);
                        displayTaskList(taskMap);
                    } catch (e: any) { console.error(`[debug] fetchTaskMap error: ${e.message}`); }
                    prompt();
                    return;
                }
                if (input === '/s') {
                    displaySkillList(SKILL_MAP);
                    prompt();
                    return;
                }
                if (input === '/f') {
                    try {
                        const funcMap = await fetchFunctionMap(agentId);
                        displayFunctionList(funcMap);
                    } catch (e: any) {
                        console.error(`Error: ${e.message}`);
                    }
                    prompt();
                    return;
                }
                if (input === '/t') {
                    try {
                        const taskMap = await fetchTaskMap(agentId);
                        displayTaskList(taskMap);
                    } catch (e: any) {
                        console.error(`Error: ${e.message}`);
                    }
                    prompt();
                    return;
                }

                // Execute skill or tool
                await handleCommand(input);
                prompt();
                return;
            }

            // Regular text - send to Analyser via TaskRunner
            await runner.runTask(config.caseNumber, caseId, input, runOptions);
            prompt();
        });
    };

    // Handle Ctrl-D
    rl.on('close', () => {
        console.log('\nGoodbye!');
        sse.close();
        process.exit(0);
    });

    prompt();
}

// Handle Ctrl-C
process.on('SIGINT', () => {
    console.log('\nGoodbye!');
    process.exit(0);
});

main().catch(console.error);
