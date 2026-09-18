export const THREAD_REFERENCE_PROVIDER = "thread-reference";
export const THREAD_REFERENCE_MIME = "application/x-bb-thread-reference";
export const THREAD_REFERENCE_PLUGIN_ID = "thread-reference";

const MAX_THREAD_ID_LENGTH = 256;
const MAX_LABEL_LENGTH = 120;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f]/g;

export interface ThreadReferencePayload {
  threadId: string;
  label: string;
}

export function isValidThreadReferenceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_THREAD_ID_LENGTH &&
    !CONTROL_CHARACTERS.test(value)
  );
}

export function normalizeThreadReferenceLabel(value: string): string {
  const normalized = value
    .replace(CONTROL_CHARACTERS_GLOBAL, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "Untitled thread").slice(0, MAX_LABEL_LENGTH);
}

export function serializeThreadReferencePayload(
  payload: ThreadReferencePayload,
): string {
  return JSON.stringify({
    threadId: payload.threadId,
    label: normalizeThreadReferenceLabel(payload.label),
  });
}

export function parseThreadReferencePayload(
  raw: string,
): ThreadReferencePayload | null {
  if (raw.length === 0 || raw.length > 4_096) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as { threadId?: unknown; label?: unknown };
    if (!isValidThreadReferenceId(candidate.threadId)) return null;
    return {
      threadId: candidate.threadId,
      label:
        typeof candidate.label === "string"
          ? normalizeThreadReferenceLabel(candidate.label)
          : "Untitled thread",
    };
  } catch {
    return null;
  }
}

export function parseThreadReferenceMentionResource(
  raw: string,
): ThreadReferencePayload | null {
  if (raw.length === 0 || raw.length > 8_192) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as {
      kind?: unknown;
      pluginId?: unknown;
      itemId?: unknown;
      label?: unknown;
    };
    if (
      candidate.kind !== "plugin" ||
      candidate.pluginId !== THREAD_REFERENCE_PLUGIN_ID ||
      typeof candidate.itemId !== "string"
    ) {
      return null;
    }

    const prefix = `${THREAD_REFERENCE_PROVIDER}:`;
    if (!candidate.itemId.startsWith(prefix)) return null;
    const threadId = candidate.itemId.slice(prefix.length);
    if (!isValidThreadReferenceId(threadId)) return null;

    return {
      threadId,
      label:
        typeof candidate.label === "string"
          ? normalizeThreadReferenceLabel(candidate.label)
          : "Untitled thread",
    };
  } catch {
    return null;
  }
}
