import http from 'http';
import { handleRequest } from './handler';

import { CONFIG } from '@/config/settings';

const PORT = CONFIG.system.dataServerPort;

console.log(`[DataServer] Starting with args: ${process.argv.join(' ')}`);
const server = http.createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Data Server running on http://0.0.0.0:${PORT}`);
});
