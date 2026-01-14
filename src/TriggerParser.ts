/**
 * TriggerParser - Erkennt @claude und @gemini Trigger in Nachrichten
 *
 * Ermöglicht bidirektionale Delegation zwischen Claude und Gemini
 * durch einfache @-Mentions in der Nachricht.
 */

export type TriggerTarget = 'claude' | 'gemini' | null;

export interface ParsedTrigger {
  /** Erkanntes Ziel (@claude oder @gemini) */
  target: TriggerTarget;
  /** Bereinigter Nachrichtentext ohne Trigger */
  cleanedMessage: string;
  /** Original-Nachricht */
  originalMessage: string;
  /** War ein Trigger vorhanden? */
  hasTrigger: boolean;
}

/**
 * Regex-Patterns für Trigger-Erkennung
 * Unterstützt: @claude, @Claude, @CLAUDE, @gemini, @Gemini, @GEMINI
 * Am Anfang oder Ende der Nachricht, oder als eigenständiges Wort
 */
const CLAUDE_PATTERN = /(?:^|\s)@claude(?:\s|$|[.,!?:;])/i;
const GEMINI_PATTERN = /(?:^|\s)@gemini(?:\s|$|[.,!?:;])/i;

/**
 * Pattern zum Entfernen des Triggers aus der Nachricht
 */
const CLAUDE_REMOVE_PATTERN = /@claude\s*/gi;
const GEMINI_REMOVE_PATTERN = /@gemini\s*/gi;

/**
 * Parst eine Nachricht und erkennt @claude oder @gemini Trigger.
 *
 * @param message - Die zu parsende Nachricht
 * @returns ParsedTrigger mit Ziel und bereinigter Nachricht
 *
 * @example
 * parseTrigger("@claude bitte analysiere diesen Code")
 * // → { target: 'claude', cleanedMessage: 'bitte analysiere diesen Code', hasTrigger: true }
 *
 * @example
 * parseTrigger("@gemini was denkst du darüber?")
 * // → { target: 'gemini', cleanedMessage: 'was denkst du darüber?', hasTrigger: true }
 */
export function parseTrigger(message: string): ParsedTrigger {
  const trimmed = message.trim();

  // Prüfe auf @claude
  if (CLAUDE_PATTERN.test(trimmed)) {
    return {
      target: 'claude',
      cleanedMessage: trimmed.replace(CLAUDE_REMOVE_PATTERN, '').trim(),
      originalMessage: message,
      hasTrigger: true,
    };
  }

  // Prüfe auf @gemini
  if (GEMINI_PATTERN.test(trimmed)) {
    return {
      target: 'gemini',
      cleanedMessage: trimmed.replace(GEMINI_REMOVE_PATTERN, '').trim(),
      originalMessage: message,
      hasTrigger: true,
    };
  }

  // Kein Trigger gefunden
  return {
    target: null,
    cleanedMessage: trimmed,
    originalMessage: message,
    hasTrigger: false,
  };
}

/**
 * Prüft, ob eine Nachricht einen @claude Trigger enthält.
 */
export function hasClaudeTrigger(message: string): boolean {
  return CLAUDE_PATTERN.test(message);
}

/**
 * Prüft, ob eine Nachricht einen @gemini Trigger enthält.
 */
export function hasGeminiTrigger(message: string): boolean {
  return GEMINI_PATTERN.test(message);
}

/**
 * Entfernt alle Trigger aus einer Nachricht.
 */
export function removeTriggers(message: string): string {
  return message
    .replace(CLAUDE_REMOVE_PATTERN, '')
    .replace(GEMINI_REMOVE_PATTERN, '')
    .trim();
}

/**
 * Fügt einen Trigger zu einer Nachricht hinzu (am Anfang).
 */
export function addTrigger(message: string, target: 'claude' | 'gemini'): string {
  return `@${target} ${message}`;
}
