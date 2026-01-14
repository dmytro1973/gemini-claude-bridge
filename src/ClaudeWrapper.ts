/**
 * ClaudeWrapper - Executes Claude Code CLI as a subprocess
 *
 * Diese Klasse kapselt die Interaktion mit dem lokal installierten Claude CLI.
 * KEINE API-Calls - nutzt das bestehende Abo via `claude login`.
 *
 * SESSION-PERSISTENZ:
 * - Sessions werden pro Working Directory gespeichert
 * - Ermöglicht Kontext-Erhaltung über mehrere Aufrufe
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ClaudeExecutionResult {
  success: boolean;
  output: string;
  exitCode: number | null;
  duration: number;
  sessionId?: string;
}

export interface ClaudeWrapperOptions {
  /** Arbeitsverzeichnis für Claude (default: process.cwd()) */
  workingDirectory?: string;
  /** Timeout in Millisekunden (default: 600000 = 10 Min) */
  timeout?: number;
  /** Zusätzliche Environment-Variablen */
  additionalEnv?: Record<string, string>;
  /** Session-ID für Kontext-Erhaltung (optional) */
  sessionId?: string;
  /** Automatisch letzte Session fortsetzen (default: true) */
  continueSession?: boolean;
}

interface SessionData {
  sessionId: string;
  workingDirectory: string;
  lastUsed: string;
  taskCount: number;
}

export class ClaudeWrapper {
  private readonly defaultTimeout = 600000; // 10 Minuten
  private readonly sessionDir: string;

  constructor() {
    const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
    this.sessionDir = path.join(homeDir, '.claude', 'bridge-sessions');
    this.ensureSessionDir();
  }

  /**
   * Stellt sicher, dass das Session-Verzeichnis existiert.
   */
  private ensureSessionDir(): void {
    try {
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }
    } catch {
      // Ignorieren - Sessions funktionieren dann nicht
    }
  }

  /**
   * Generiert einen Hash für ein Working Directory (für Dateinamen).
   */
  private getDirectoryHash(dir: string): string {
    return crypto.createHash('md5').update(dir.toLowerCase()).digest('hex').slice(0, 12);
  }

  /**
   * Lädt Session-Daten für ein Working Directory.
   */
  private loadSession(workingDirectory: string): SessionData | null {
    try {
      const hash = this.getDirectoryHash(workingDirectory);
      const sessionFile = path.join(this.sessionDir, `session-${hash}.json`);

      if (fs.existsSync(sessionFile)) {
        const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
        return data as SessionData;
      }
    } catch {
      // Session nicht ladbar
    }
    return null;
  }

  /**
   * Speichert Session-Daten für ein Working Directory.
   */
  private saveSession(workingDirectory: string, sessionId: string, taskCount: number): void {
    try {
      const hash = this.getDirectoryHash(workingDirectory);
      const sessionFile = path.join(this.sessionDir, `session-${hash}.json`);

      const data: SessionData = {
        sessionId,
        workingDirectory,
        lastUsed: new Date().toISOString(),
        taskCount,
      };

      fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2));
    } catch {
      // Speichern fehlgeschlagen - nicht kritisch
    }
  }

  /**
   * Generiert eine neue UUID für Sessions.
   */
  private generateSessionId(): string {
    return crypto.randomUUID();
  }

  /**
   * Löscht eine Session für ein Working Directory.
   */
  clearSession(workingDirectory: string): boolean {
    try {
      const hash = this.getDirectoryHash(workingDirectory);
      const sessionFile = path.join(this.sessionDir, `session-${hash}.json`);

      if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
        return true;
      }
    } catch {
      // Löschen fehlgeschlagen
    }
    return false;
  }

  /**
   * Listet alle aktiven Sessions.
   */
  listSessions(): SessionData[] {
    try {
      const files = fs.readdirSync(this.sessionDir).filter(f => f.startsWith('session-'));
      return files.map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(this.sessionDir, f), 'utf-8'));
        return data as SessionData;
      });
    } catch {
      return [];
    }
  }

  /**
   * Führt eine Aufgabe mit Claude Code CLI aus.
   *
   * @param instruction - Die Aufgabenbeschreibung für Claude
   * @param options - Optionale Konfiguration
   * @returns Ergebnis der Ausführung
   */
  async execute(
    instruction: string,
    options: ClaudeWrapperOptions = {}
  ): Promise<ClaudeExecutionResult> {
    const cwd = options.workingDirectory ?? process.cwd();
    const continueSession = options.continueSession ?? true;

    // Session-Management
    let sessionId = options.sessionId;
    let existingSession = this.loadSession(cwd);
    let taskCount = 1;

    if (!sessionId && continueSession && existingSession) {
      // Existierende Session fortsetzen
      sessionId = existingSession.sessionId;
      taskCount = existingSession.taskCount + 1;
    } else if (!sessionId) {
      // Neue Session erstellen
      sessionId = this.generateSessionId();
      taskCount = 1;
    }

    // LOGGING: Schreibt jeden Auftrag in eine feste Datei
    const logDir = process.env.USERPROFILE || process.env.HOME || '.';
    const logFile = path.join(logDir, '.claude', 'orchestrator.log');
    const timestamp = new Date().toISOString();
    const sessionInfo = existingSession ? `[CONTINUE #${taskCount}]` : '[NEW SESSION]';
    try {
      fs.appendFileSync(logFile, `[${timestamp}] ${sessionInfo} GEMINI -> CLAUDE: ${instruction}\nSession: ${sessionId}\n\n`);
    } catch {
      // Logging-Fehler nicht propagieren - non-critical
    }

    const startTime = Date.now();
    const timeout = options.timeout ?? this.defaultTimeout;

    return new Promise((resolve) => {
      // Claude CLI Argumente
      // -p: Print mode - non-interactive, Ausgabe direkt auf stdout
      // --dangerously-skip-permissions: Keine Permission-Prompts
      const args = [
        "-p", instruction,
        "--dangerously-skip-permissions",
      ];

      // Session-Handling:
      // - Neue Session: --session-id <uuid>
      // - Fortsetzung: --resume <uuid> (OHNE --session-id)
      if (existingSession && continueSession) {
        // Existierende Session fortsetzen
        args.push("--resume", sessionId);
      } else {
        // Neue Session mit spezifischer ID
        args.push("--session-id", sessionId);
      }

      // Auf Windows: claude.cmd verwenden
      const command = process.platform === "win32" ? "claude.cmd" : "claude";

      // Environment: Host-Env weitergeben (wichtig für Auth-Tokens in HOME/.claude)
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...options.additionalEnv,
        // Sicherstellen, dass HOME/USERPROFILE gesetzt sind
        HOME: process.env.HOME ?? process.env.USERPROFILE,
        USERPROFILE: process.env.USERPROFILE ?? process.env.HOME,
      };

      let child: ChildProcess;

      try {
        child = spawn(command, args, {
          cwd,
          env,
          shell: process.platform === "win32",
          stdio: ["pipe", "pipe", "pipe"],
          // Windows-spezifisch: Verberge Konsolenfenster
          windowsHide: true,
        });
      } catch (spawnError) {
        const errorMsg =
          spawnError instanceof Error ? spawnError.message : String(spawnError);
        resolve({
          success: false,
          output: `[SPAWN ERROR] Claude CLI konnte nicht gestartet werden: ${errorMsg}\n\nPrüfe:\n1. Ist Claude CLI installiert? → npm install -g @anthropic-ai/claude-code\n2. Bist du eingeloggt? → claude login`,
          exitCode: null,
          duration: Date.now() - startTime,
        });
        return;
      }

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // Timeout-Handler
      const timeoutId = setTimeout(() => {
        child.kill("SIGTERM");
        // Grace period, dann SIGKILL
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 5000);
      }, timeout);

      child.on("close", (code) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        // Erfolg wenn Exit-Code 0 ODER wenn stdout Output hat
        const hasOutput = stdout.trim().length > 0;
        const isSuccess = code === 0 || hasOutput;

        if (isSuccess) {
          // Session speichern bei Erfolg
          this.saveSession(cwd, sessionId!, taskCount);

          resolve({
            success: true,
            output: stdout.trim() || "[Claude lieferte keine Ausgabe]",
            exitCode: code,
            duration,
            sessionId,
          });
        } else {
          // Fehler: Kombiniere stderr und stdout für Diagnose
          const errorOutput =
            stderr.trim() || stdout.trim() || `Exit-Code: ${code}`;
          resolve({
            success: false,
            output: `[CLAUDE CLI ERROR]\n${errorOutput}`,
            exitCode: code,
            duration,
            sessionId,
          });
        }
      });

      child.on("error", (error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          output: `[PROCESS ERROR] ${error.message}`,
          exitCode: null,
          duration: Date.now() - startTime,
          sessionId,
        });
      });
    });
  }

  /**
   * Prüft, ob Claude CLI verfügbar ist.
   */
  async isAvailable(): Promise<boolean> {
    const result = await this.execute("echo test", { timeout: 10000 });
    return result.success;
  }
}

// Singleton-Export für einfache Nutzung
export const claudeWrapper = new ClaudeWrapper();