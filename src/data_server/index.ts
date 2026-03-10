import http from 'http';
import { handleRequest } from './handler';

import { CONFIG } from '@/config/settings';

const PORT = CONFIG.system.dataServerPort;

console.log(`[DataServer] Starting with args: ${process.argv.join(' ')}`);
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
    console.log(`Data Server running on port ${PORT}`);
});
