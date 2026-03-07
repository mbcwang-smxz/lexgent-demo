export interface AnalyserPlan {
    status: 'PLAN' | 'NEED_INFO' | 'REPLY' | 'COMPLETE';
    plan?: {
        title: string;
        skill_id: string;
        inputs: string[]; // Logical IDs like "R01"
        instruction: string;
        force?: boolean; // Intent to overwrite
        /** Loop execution: framework decides batch vs per-file based on skill config */
        loop?: boolean;
        reference_materials?: any[];
        /** Extracted parameters from user query (non-file inputs) */
        params?: Record<string, any>;
    }[];
    content?: string; // For status: REPLY
    missing_info?: string[];
    reason?: string;
}
