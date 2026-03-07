// Global fetch is available in Node 18+

export async function checkServerConnection(url: string, serverName: string): Promise<boolean> {
    try {
        // We use a simple GET request to the root or a known endpoint to check connectivity
        // For Case Server, we can check /cases/health or just root if it returns 404 but connects.
        // Or better, check an endpoint we know exists or just expect connection.
        // Actually, just fetching the root or any valid URL is enough to check connection refused.
        
        // Use a short timeout to fail fast
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        try {
            await fetch(url, { 
                method: 'GET',
                signal: controller.signal 
            });
            clearTimeout(timeoutId);
            return true;
        } catch (e: any) {
            clearTimeout(timeoutId);
            throw e;
        }
    } catch (e: any) {
        if (e.cause?.code === 'ECONNREFUSED' || e.message.includes('ECONNREFUSED')) {
            console.error(`\n❌ 无法连接到 ${serverName} (${url})`);
            console.error(`   请确保服务已启动。您可以运行以下命令启动服务：`);
            if (serverName === 'Data Server') {
                console.error(`   ./scripts/run_data_server.sh`);
            } else if (serverName === 'Agent Server') {
                console.error(`   ./scripts/run_agent_server.sh`);
            }
            console.error(``);
            return false;
        }
        // Handle other errors (like timeout)
        console.error(`\n⚠️  连接 ${serverName} (${url}) 时发生错误: ${e.message}`);
        return false;
    }
}
