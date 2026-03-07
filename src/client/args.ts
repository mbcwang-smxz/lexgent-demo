
export interface ClientConfig {
    caseId: string;
    caseNumber: string;
    agentId: string;
    configId?: string;
    action: 'list' | 'run';
    query?: string;
    skillId?: string;
    isInteractive: boolean;
    verbose: boolean;
    noCache: boolean;
    reuseSandbox: boolean;
    help: boolean;
}

export function parseArgs(args: string[]): ClientConfig {
    const config: ClientConfig = {
        caseId: '', // Will be resolved via init
        caseNumber: 'case-101',
        agentId: process.env.DEFAULT_AGENT || 'law_agent',
        action: 'run',
        isInteractive: false,
        verbose: false,
        noCache: false,
        reuseSandbox: true,
        help: false
    };

    if (args.length === 0) {
        config.isInteractive = true;
    }

    if (args.includes('-h') || args.includes('--help')) {
        config.help = true;
        return config;
    }

    if (args.includes('--list') || args.includes('-l')) {
        config.action = 'list';
        return config;
    }

    // --case-number / -c
    const cIndex = Math.max(args.indexOf('--case-number'), args.indexOf('-c'));
    if (cIndex !== -1 && args[cIndex + 1]) {
        config.caseNumber = args[cIndex + 1];
    }

    // --agent / -a / -ag
    const agIndex = Math.max(args.indexOf('--agent'), args.indexOf('-a'), args.indexOf('-ag'));
    if (agIndex !== -1 && args[agIndex + 1]) {
        config.agentId = args[agIndex + 1];
    }

    // --config
    const cfgIndex = args.indexOf('--config');
    if (cfgIndex !== -1 && args[cfgIndex + 1]) {
        config.configId = args[cfgIndex + 1];
    }

    config.verbose = args.includes('-v') || args.includes('--verbose');
    config.noCache = args.includes('--no-cache') || args.includes('--no_cache'); // keep old alias just in case or STRICT? Plan said standardized. Let's support standard primarily.
    config.reuseSandbox = !(args.includes('--reset-case') || args.includes('--new') || args.includes('-n') || args.includes('--new_sandbox'));
    config.isInteractive = args.includes('-i') || args.includes('--interactive') || config.isInteractive;

    const sIndex = Math.max(args.indexOf('--test-skill'), args.indexOf('-ts'));
    const allIndex = Math.max(args.indexOf('--test-all'), args.indexOf('-ta'));

    if (allIndex !== -1) {
        config.query = "请完成全案分析并生成裁判文书";
    } else if (sIndex !== -1 && args[sIndex + 1]) {
        config.skillId = args[sIndex + 1];
    } else if (!config.isInteractive) {
        // Trailing args as custom query
        // exclude flags and their values
        const isFlag = (s: string) => s.startsWith('-');
        const otherArgs = [];
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (isFlag(arg)) {
                // Skip next arg if it's a value-taking flag
                if (['-c', '--case-number', '-ts', '--test-skill', '-a', '-ag', '--agent', '--caseNumber', '--config'].includes(arg)) {
                    i++; 
                }
                continue;
            }
            // Check if previous was a value flag (handled by i++ above)
            otherArgs.push(arg);
        }
        
        if (otherArgs.length > 0) {
            config.query = otherArgs.join(' ');
        }
    }

    // Default to interactive if no explicit task is provided
    if (!config.skillId && !config.query && config.action === 'run') {
        config.isInteractive = true;
    }

    return config;
}
