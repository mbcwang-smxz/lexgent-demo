import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import fs from 'fs-extra';
import path from 'path';
import { FileSystem, findFileByFilename, upsertFile, getMaxRIndex, getMaxUIndex, getMaxXIndex } from './utils';

const resumeMode = process.argv.includes('--resume');
const fsUtils = new FileSystem(process.cwd(), resumeMode);

async function getBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body));
    });
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const decodedUrl = decodeURIComponent(req.url || '');
    console.log(`[${new Date().toISOString()}] ${req.method} ${decodedUrl}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Data-Root');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pathParts = url.pathname.split('/').filter(p => p); 

    try {
        // GET /health
        if (req.url === '/health' && req.method === 'GET') {
            res.writeHead(200);
            res.end('OK');
            return;
        }

        // POST /cases/init (Initialize Case Environment)
        if (pathParts[0] === 'cases' && pathParts[1] === 'init' && req.method === 'POST') {
            const body = await getBody(req);
            let caseNumber: string | undefined;
            let reset: boolean | undefined = undefined;
            try {
                const parsed = JSON.parse(body);
                caseNumber = parsed.caseNumber;
                reset = parsed.reset; 
            } catch (e) {
                // ignore parsing error
            }
            
            // Dynamic Case ID Logic
            let caseId: string;
            
            if (caseNumber) {
                // Safe Case ID from Case Number (replace unsafe chars with _)
                caseId = caseNumber.replace(/[\/\\?%*:|"<>]/g, '_');
                console.log(`[CaseServer] Using provided Case Number as ID: ${caseId}`);
                
                await fsUtils.initializeCase(caseId, { 
                    reset: !!reset, 
                    caseNumber
                });
            } else {
                // Fallback Legacy Logic (if caseNumber missing)
                if (reset) {
                    caseId = `case-${Date.now()}`;
                    console.log(`[CaseServer] Reset (New) requested. Generated ID: ${caseId}`);
                    await fsUtils.initializeCase(caseId, { 
                        reset: true, 
                        caseNumber
                    });
                } else {
                    const latestId = await fsUtils.findLatestCaseId();
                    if (latestId) {
                        caseId = latestId;
                        console.log(`[CaseServer] Resume requested. Found latest case: ${caseId}`);
                    } else {
                        caseId = 'case-101';
                        // ...
                    }
                    await fsUtils.initializeCase(caseId, { reset: false, caseNumber });
                }
            }
            
            const dataRoot = fsUtils.resolveCaseDir(caseId); // Resolving manually or using return from initializeCase
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'initialized', caseId, dataRoot }));
            return;
        }

        // GET /test/context — test_agent empty context (no scope key)
        if (pathParts[0] === 'test' && pathParts[1] === 'context' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ caseId: '', files: [], metadata: {} }));
            return;
        }

        // GET /cases/:caseId/context
        if (pathParts[0] === 'cases' && pathParts[2] === 'context' && req.method === 'GET') {
            const caseId = decodeURIComponent(pathParts[1]);
            const context = await fsUtils.getCaseContext(caseId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(context));
            return;
        }

        // PATCH /cases/:caseId/files/:filename/metadata (upsert - create or update)
        if (pathParts[0] === 'cases' && pathParts[2] === 'files' && pathParts[4] === 'metadata' && req.method === 'PATCH') {
            const caseId = decodeURIComponent(pathParts[1]);
            const filename = decodeURIComponent(pathParts[3]);
            const body = await getBody(req);
            const updates = JSON.parse(body);

            const context = await fsUtils.loadMetadata(caseId);
            let file = findFileByFilename(context.files, filename);

            if (file) {
                // Update existing entry
                Object.assign(file, updates);
            } else {
                // Create new entry (upsert)
                const id = updates.id || filename;
                const newFile = {
                    id,
                    filename,
                    type: updates.type || 'unknown',
                    path: updates.path || `${caseId}/${filename}`,
                    lastModified: updates.lastModified || new Date(),
                    ...updates
                };
                context.files = upsertFile(context.files, newFile);
            }

            await fsUtils.saveMetadata(caseId, context);
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'ok' }));
            return;
        }

        // GET /cases/:caseId/files/:filename
        if (pathParts[0] === 'cases' && pathParts[2] === 'files' && pathParts[3] && req.method === 'GET') {
            const caseId = decodeURIComponent(pathParts[1]);
            const filename = decodeURIComponent(pathParts[3]);
            const content = await fsUtils.readFile(caseId, filename);
            if (content === null) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'File not found' }));
            } else {
                res.writeHead(200);
                res.end(content);
            }
            return;
        }

        // DELETE /cases/:caseId/files?pattern=...
        if (pathParts[0] === 'cases' && pathParts[2] === 'files' && req.method === 'DELETE') {
            const caseId = decodeURIComponent(pathParts[1]);
            const pattern = url.searchParams.get('pattern');
            
            if (!pattern) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Missing pattern parameter' }));
                return;
            }

            const deleted = await fsUtils.deleteFiles(caseId, pattern);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ deleted }));
            return;
        }

        // POST /cases/:caseId/classification
        if (pathParts[0] === 'cases' && pathParts[2] === 'classification' && req.method === 'POST') {
            const caseId = decodeURIComponent(pathParts[1]);
            const body = await getBody(req);
            const { result } = JSON.parse(body);

            const classifications: Array<{ filename: string; type: string }> =
                result?.classifications || [];
            const conversions: Array<{ sourceFilename: string; targetFilename: string }> =
                result?.conversions || [];

            const context = await fsUtils.loadMetadata(caseId);
            let rIndex = getMaxRIndex(context.files) + 1;
            let xIndex = getMaxXIndex(context.files) + 1;
            let uIndex = getMaxUIndex(context.files) + 1;

            // Handle conversions: mark source P## as "无关文档" (X##), register converted file as U##
            for (const conv of conversions) {
                const { sourceFilename, targetFilename } = conv;
                const sourceFile = findFileByFilename(context.files, sourceFilename);
                if (sourceFile) {
                    const oldId = sourceFile.id;
                    sourceFile.type = '无关文档';
                    sourceFile.id = `X${String(xIndex++).padStart(2, '0')}`;
                    console.log(`[CaseServer] conversion: ${sourceFilename} → [${oldId}→${sourceFile.id}] 无关文档`);
                }
                // Register target only if not already in metadata (auto-scan may have added it)
                const existing = findFileByFilename(context.files, targetFilename);
                if (existing) {
                    // Already registered (e.g., by getCaseContext auto-scan); just ensure correct type
                    existing.type = '未分类文档';
                    existing.metadata = { ...(existing.metadata || {}), convertedFrom: sourceFilename };
                    console.log(`[CaseServer] updated existing: ${targetFilename} → [${existing.id}] 未分类文档`);
                } else {
                    const fileId = `U${String(uIndex++).padStart(2, '0')}`;
                    context.files = upsertFile(context.files, {
                        id: fileId,
                        filename: targetFilename,
                        type: '未分类文档',
                        path: `${caseId}/${targetFilename}`,
                        lastModified: new Date(),
                        metadata: { convertedFrom: sourceFilename }
                    });
                    console.log(`[CaseServer] registered: ${targetFilename} → [${fileId}] 未分类文档`);
                }
            }

            // Handle classifications: rename U## based on classification result
            for (const item of classifications) {
                const file = findFileByFilename(context.files, item.filename);
                if (!file) {
                    console.warn(`[CaseServer] classification: file not found: ${item.filename}`);
                    continue;
                }
                const oldId = file.id;
                file.type = item.type;

                // Rename U## IDs based on classification result
                if (file.id.startsWith('U')) {
                    if (item.type === '无关文档') {
                        file.id = `X${String(xIndex++).padStart(2, '0')}`;
                    } else if (item.type !== '未分类文档') {
                        // Known content type → promote to R##
                        file.id = `R${String(rIndex++).padStart(2, '0')}`;
                    }
                }
                console.log(`[CaseServer] classified: ${item.filename} → [${oldId}→${file.id}] ${item.type}`);
            }

            await fsUtils.saveMetadata(caseId, context);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', conversions: conversions.length, classified: classifications.length }));
            return;
        }

        // POST /cases/:caseId/files/:filename
        if (pathParts[0] === 'cases' && pathParts[2] === 'files' && pathParts[3] && req.method === 'POST') {
            const caseId = decodeURIComponent(pathParts[1]);
            const filename = decodeURIComponent(pathParts[3]);
            const body = await getBody(req);
            const { content } = JSON.parse(body);
            await fsUtils.writeFile(caseId, filename, content);
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'ok' }));
            return;
        }

        // POST /cases/:caseId/events
        if (pathParts[0] === 'cases' && pathParts[2] === 'events' && req.method === 'POST') {
            const caseId = decodeURIComponent(pathParts[1]);
            const body = await getBody(req);
            const event = await fsUtils.appendEvent(caseId, JSON.parse(body));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(event));
            return;
        }

        // GET /cases/:caseId/events
        if (pathParts[0] === 'cases' && pathParts[2] === 'events' && req.method === 'GET') {
            const caseId = decodeURIComponent(pathParts[1]);
            const after = parseInt(url.searchParams.get('after') || '0', 10);
            const events = await fsUtils.getEvents(caseId, after);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(events));
            return;
        }

        // POST /cases/:caseId/reply
        if (pathParts[0] === 'cases' && pathParts[2] === 'reply' && req.method === 'POST') {
            const caseId = decodeURIComponent(pathParts[1]);
            const body = await getBody(req);
            const reply = await fsUtils.appendReply(caseId, JSON.parse(body));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(reply));
            return;
        }

        // GET /cases/:caseId/reply
        if (pathParts[0] === 'cases' && pathParts[2] === 'reply' && req.method === 'GET') {
            const caseId = decodeURIComponent(pathParts[1]);
            const after = parseInt(url.searchParams.get('after') || '0', 10);
            const replies = await fsUtils.getReplies(caseId, after);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(replies));
            return;
        }

        // ========== Tool APIs (example/mock implementations) ==========

        // POST /cases/:caseId/file2md (Mock: uses case-102 .txt files as conversion fixtures)
        // sourceFilename: e.g. "1.pdf" → reads data/case-data/case-102/1.txt as converted content
        if (pathParts[0] === 'cases' && pathParts[2] === 'file2md' && req.method === 'POST') {
            const caseId = decodeURIComponent(pathParts[1]);
            const body = await getBody(req);
            const { sourceFilename } = JSON.parse(body);

            if (!sourceFilename) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing sourceFilename' }));
                return;
            }

            // Derive base name and target filename automatically: "1.pdf" → "1" → "1.md"
            const baseName = sourceFilename.replace(/\.[^.]+$/, '');
            const targetFilename = `${baseName}.md`;
            const mockFile = `${baseName}.txt`;

            // Read fixture from source data directory (not runtime .runs/)
            const fixturePath = path.join(process.cwd(), 'data', 'case-data', 'case-102', mockFile);
            if (!await fs.pathExists(fixturePath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Mock fixture not found: data/case-data/case-102/${mockFile}` }));
                return;
            }
            const content = await fs.readFile(fixturePath, 'utf-8');

            // Save converted content to target case's runtime directory
            await fsUtils.writeFile(caseId, targetFilename, content);

            console.log(`[file2md mock] ${sourceFilename} → ${targetFilename} (${content.length} chars)`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                sourceFilename,
                targetFilename,
                size: content.length,
                message: `成功将 ${sourceFilename} 转换为 ${targetFilename}`
            }));
            return;
        }

        // POST /api/tools/echo
        if (pathParts[0] === 'api' && pathParts[1] === 'tools' && pathParts[2] === 'echo' && req.method === 'POST') {
            const body = await getBody(req);
            const { message } = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                echo: message,
                timestamp: new Date().toISOString(),
                server: 'data_server',
            }));
            return;
        }

        // POST /api/tools/law_lookup
        if (pathParts[0] === 'api' && pathParts[1] === 'tools' && pathParts[2] === 'law_lookup' && req.method === 'POST') {
            const body = await getBody(req);
            const { law_name, article_number, keywords } = JSON.parse(body);

            // Pre-prepared mock data
            const lawDatabase: Record<string, Record<string, { content: string; chapter?: string }>> = {
                '中华人民共和国民法典': {
                    '第一百八十八条': {
                        chapter: '第九章 诉讼时效',
                        content: '向人民法院请求保护民事权利的诉讼时效期间为三年。法律另有规定的，依照其规定。\n诉讼时效期间自权利人知道或者应当知道权利受到损害以及义务人之日起计算。法律另有规定的，依照其规定。但是，自权利受到损害之日起超过二十年的，人民法院不予保护，有特殊情况的，人民法院可以根据权利人的申请决定延长。',
                    },
                    '第一千一百七十九条': {
                        chapter: '第四章 侵权责任',
                        content: '侵害他人造成人身损害的，应当赔偿医疗费、护理费、交通费、营养费、住院伙食补助费等为治疗和康复支出的合理费用，以及因误工减少的收入。造成残疾的，还应当赔偿辅助器具费和残疾赔偿金；造成死亡的，还应当赔偿丧葬费和死亡赔偿金。',
                    },
                    '第一千一百六十五条': {
                        chapter: '第四章 侵权责任',
                        content: '行为人因过错侵害他人民事权益造成损害的，应当承担侵权责任。\n依照法律规定推定行为人有过错，其不能证明自己没有过错的，应当承担侵权责任。',
                    },
                    '第五百七十七条': {
                        chapter: '第八章 违约责任',
                        content: '当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担继续履行、采取补救措施或者赔偿损失等违约责任。',
                    },
                    '第五百八十四条': {
                        chapter: '第八章 违约责任',
                        content: '当事人一方不履行合同义务或者履行合同义务不符合约定，造成对方损失的，损失赔偿额应当相当于因违约所造成的损失，包括合同履行后可以获得的利益；但是，不得超过违约一方订立合同时预见到或者应当预见到的因违约可能造成的损失。',
                    },
                },
                '中华人民共和国民事诉讼法': {
                    '第六十七条': {
                        chapter: '第五章 证据',
                        content: '当事人对自己提出的主张，有责任提供证据。\n当事人及其诉讼代理人因客观原因不能自行收集的证据，或者人民法院认为审理案件需要的证据，人民法院应当调查收集。\n人民法院应当按照法定程序，全面地、客观地审查核实证据。',
                    },
                    '第一百二十二条': {
                        chapter: '第十二章 第一审普通程序',
                        content: '起诉必须符合下列条件：（一）原告是与本案有直接利害关系的公民、法人和其他组织；（二）有明确的被告；（三）有具体的诉讼请求和事实、理由；（四）属于人民法院受理民事诉讼的范围和受诉人民法院管辖。',
                    },
                },
            };

            const results: Array<{ law_name: string; article: string; chapter?: string; content: string }> = [];

            if (law_name && lawDatabase[law_name]) {
                const lawEntries = lawDatabase[law_name];
                if (article_number && lawEntries[article_number]) {
                    // Exact article match
                    const entry = lawEntries[article_number];
                    results.push({ law_name, article: article_number, chapter: entry.chapter, content: entry.content });
                } else if (keywords) {
                    // Keyword search within the law
                    for (const [article, entry] of Object.entries(lawEntries)) {
                        if (entry.content.includes(keywords)) {
                            results.push({ law_name, article, chapter: entry.chapter, content: entry.content });
                        }
                    }
                } else {
                    // Return all articles for this law
                    for (const [article, entry] of Object.entries(lawEntries)) {
                        results.push({ law_name, article, chapter: entry.chapter, content: entry.content });
                    }
                }
            } else if (keywords) {
                // Search across all laws by keyword
                for (const [name, entries] of Object.entries(lawDatabase)) {
                    for (const [article, entry] of Object.entries(entries)) {
                        if (entry.content.includes(keywords)) {
                            results.push({ law_name: name, article, chapter: entry.chapter, content: entry.content });
                        }
                    }
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                query: { law_name, article_number, keywords },
                count: results.length,
                results,
            }));
            return;
        }

        res.writeHead(404);
        res.end('Not Found');
    } catch (e: any) {
        console.error("Server Error:", e);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
    }
}