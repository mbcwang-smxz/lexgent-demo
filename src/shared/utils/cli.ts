import readline from 'readline';

export const GlobalConfirmState = {
    preference: null as 'yes_all' | 'no_all' | null
};

/**
 * Prompts for a boolean confirmation with a live countdown.
 * Supports 'ya' (yes all) and 'na' (no all) to skip future prompts.
 * @param message The prompt message.
 * @param defaultValue Default value if input is empty or timed out.
 * @param timeoutMs Timeout in milliseconds (default 5000ms).
 */
export async function confirm(message: string, defaultValue: boolean = false, timeoutMs: number = 5000): Promise<boolean> {
    // Check global preference first
    if (GlobalConfirmState.preference === 'yes_all') {
        console.log(`${message} [自动确认: Yes All]`);
        return true;
    }
    if (GlobalConfirmState.preference === 'no_all') {
        console.log(`${message} [自动确认: No All]`);
        return false;
    }

    const suffix = defaultValue ? '[Y/n/ya/na]' : '[y/N/ya/na]';
    
    // If no timeout, use simple logic
    if (timeoutMs <= 0) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise(resolve => {
            rl.question(`${message} ${suffix} `, ans => {
                rl.close();
                const cleanAns = ans.trim().toLowerCase();
                if (cleanAns === 'ya' || cleanAns === 'yes all') {
                    GlobalConfirmState.preference = 'yes_all';
                    resolve(true);
                } else if (cleanAns === 'na' || cleanAns === 'no all') {
                    GlobalConfirmState.preference = 'no_all';
                    resolve(false);
                } else if (!ans) {
                    resolve(defaultValue);
                } else {
                    resolve(cleanAns === 'y' || cleanAns === 'yes');
                }
            });
        });
    }

    // With live countdown
    return new Promise(resolve => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });

        let remaining = Math.ceil(timeoutMs / 1000);
        let completed = false;

        const timer = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                if (!completed) {
                    completed = true;
                    clearInterval(timer);
                    // Clear the line and show timeout
                    readline.cursorTo(process.stdout, 0);
                    readline.clearLine(process.stdout, 0);
                    process.stdout.write(`${message} ${suffix} (超时, 使用默认值)\n`);
                    rl.close();
                    resolve(defaultValue);
                }
            } else {
                // Update countdown on the same line
                renderPrompt();
            }
        }, 1000);

        const renderPrompt = () => {
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`${message} ${suffix} (倒计时 ${remaining}s): `);
        };

        renderPrompt();

        rl.on('line', (line) => {
            if (!completed) {
                completed = true;
                clearInterval(timer);
                rl.close();
                const answer = line.trim().toLowerCase();
                
                if (answer === 'ya' || answer === 'yes all') {
                    GlobalConfirmState.preference = 'yes_all';
                    resolve(true);
                } else if (answer === 'na' || answer === 'no all') {
                    GlobalConfirmState.preference = 'no_all';
                    resolve(false);
                } else if (!answer) {
                    resolve(defaultValue);
                } else {
                    resolve(answer === 'y' || answer === 'yes');
                }
            }
        });

        // Handle Ctrl+C if needed, but rl usually handles it
    });
}

/**
 * Basic question prompt (without countdown, for backward compatibility or simple use)
 */
export async function askQuestion(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}
