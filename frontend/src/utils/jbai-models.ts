import { JbaiClient } from 'shared/types';

const JBAI_MODELS: Record<JbaiClient, string[]> = {
  [JbaiClient.CLAUDE]: [
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-1-20250805',
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-haiku-20241022',
  ],
  [JbaiClient.CODEX]: [
    'gpt-5.2-2025-12-11',
    'gpt-5.2',
    'gpt-5.1-2025-11-13',
    'gpt-5-2025-08-07',
    'gpt-5-mini-2025-08-07',
    'gpt-5-nano-2025-08-07',
    'gpt-4.1-2025-04-14',
    'gpt-4.1-mini-2025-04-14',
    'gpt-4.1-nano-2025-04-14',
    'gpt-4o-2024-11-20',
    'gpt-4o-mini-2024-07-18',
    'gpt-4-turbo-2024-04-09',
    'gpt-4-0613',
    'gpt-3.5-turbo-0125',
    'o4-mini-2025-04-16',
    'o3-2025-04-16',
    'o3-mini-2025-01-31',
    'o1-2024-12-17',
  ],
  [JbaiClient.GEMINI]: [
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite-001',
  ],
  [JbaiClient.OPENCODE]: [
    'gpt-5.2-2025-12-11',
    'gpt-5.2',
    'gpt-5.1-2025-11-13',
    'gpt-5-2025-08-07',
    'gpt-5-mini-2025-08-07',
    'gpt-5-nano-2025-08-07',
    'gpt-4.1-2025-04-14',
    'gpt-4.1-mini-2025-04-14',
    'gpt-4.1-nano-2025-04-14',
    'gpt-4o-2024-11-20',
    'gpt-4o-mini-2024-07-18',
    'gpt-4-turbo-2024-04-09',
    'gpt-4-0613',
    'gpt-3.5-turbo-0125',
    'o4-mini-2025-04-16',
    'o3-2025-04-16',
    'o3-mini-2025-01-31',
    'o1-2024-12-17',
  ],
};

export function getJbaiModelOptions(
  client?: JbaiClient | string | null
): string[] {
  if (!client) {
    return [];
  }

  return JBAI_MODELS[client as JbaiClient] ?? [];
}
