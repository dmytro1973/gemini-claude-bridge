/**
 * GeminiWrapper - Kommuniziert mit Gemini CLI über Dateien
 *
 * Workaround für Gemini CLI Headless-Bug:
 * Startet Gemini CLI mit --yolo und piped Input/Output über Dateien
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';

export interface GeminiExecutionResult {
  success: boolean;
  output: string;
  exitCode: number | null;
  duration: number;
}

export interface GeminiWrapperOptions {
  workingDirectory?: string;
  timeout?: number;
  model?: string;
  continueSession?: boolean;
}

interface GeminiSessionData {
  workingDirectory: string;
  lastUsed: string;
  taskCount: number;
}

export class GeminiWrapper {
  private readonly defaultTimeout = 120000;
  private readonly sessionDir: string;
  private readonly tempDir: string;

  constructor() {
    const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
    this.sessionDir = path.join(homeDir, '.claude', 'bridge-sessions');
    this.tempDir = path.join(homeDir, '.claude', 'gemini-temp');
    this.ensureDirs();
  }

  private ensureDirs(): void {
    for (const dir of [this.sessionDir, this.tempDir]) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch { /* ignore */ }
    }
  }

  private getDirectoryHash(dir: string): string {
    return crypto.createHash('md5').update(dir.toLowerCase()).digest('hex').slice(0, 12);
  }

  private loadSession(workingDirectory: string): GeminiSessionData | null {
    try {
      const hash = this.getDirectoryHash(workingDirectory);
      const sessionFile = path.join(this.sessionDir, `gemini-session-${hash}.json`);
      if (fs.existsSync(sessionFile)) {
        return JSON.parse(fs.readFileSync(sessionFile, 'utf-8')) as GeminiSessionData;
      }
    } catch { /* ignore */ }
    return null;
  }

  private saveSession(workingDirectory: string, taskCount: number): void {
    try {
      const hash = this.getDirectoryHash(workingDirectory);
      const sessionFile = path.join(this.sessionDir, `gemini-session-${hash}.json`);
      const data: GeminiSessionData = {
        workingDirectory,
        lastUsed: new Date().toISOString(),
        taskCount,
      };
      fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2));
    } catch { /* ignore */ }
  }

  clearSession(workingDirectory: string): boolean {
    try {
      const hash = this.getDirectoryHash(workingDirectory);
      const sessionFile = path.join(this.sessionDir, `gemini-session-${hash}.json`);
      if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  listSessions(): GeminiSessionData[] {
    try {
      const files = fs.readdirSync(this.sessionDir).filter(f => f.startsWith('gemini-session-'));
      return files.map(f => JSON.parse(fs.readFileSync(path.join(this.sessionDir, f), 'utf-8')) as GeminiSessionData);
    } catch {
      return [];
    }
  }

  /**
   * Führt Gemini CLI aus und wartet auf Antwort
   */
  async execute(
    instruction: string,
    options: GeminiWrapperOptions = {}
  ): Promise<GeminiExecutionResult> {
    const cwd = options.workingDirectory ?? process.cwd();

    // Session-Management
    const existingSession = this.loadSession(cwd);
    const taskCount = existingSession ? existingSession.taskCount + 1 : 1;

    // Logging
    const logDir = process.env.USERPROFILE || process.env.HOME || '.';
    const logFile = path.join(logDir, '.claude', 'orchestrator.log');
    const timestamp = new Date().toISOString();
    const sessionInfo = existingSession ? `[CONTINUE #${taskCount}]` : '[NEW SESSION]';
    try {
      fs.appendFileSync(logFile, `[${timestamp}] ${sessionInfo} CLAUDE -> GEMINI (CLI): ${instruction}\n\n`);
    } catch { /* ignore */ }

    const startTime = Date.now();
    const timeout = options.timeout ?? this.defaultTimeout;

    return new Promise((resolve) => {
      // Gemini CLI mit Prompt starten
      // Verwende -o text für Text-Output (kein UI)
      const args = [
        instruction,
        '--yolo',
        '-o', 'text',
      ];

      // Session-Fortsetzung
      if (existingSession && options.continueSession !== false) {
        args.push('--resume', 'latest');
      }

      const command = process.platform === 'win32' ? 'gemini.cmd' : 'gemini';

      const child = spawn(command, args, {
        cwd,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Force non-interactive
          CI: 'true',
          TERM: 'dumb',
          NO_COLOR: '1',
        },
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const finish = (success: boolean, output: string, exitCode: number | null) => {
        if (resolved) return;
        resolved = true;

        if (success) {
          this.saveSession(cwd, taskCount);
        }

        resolve({
          success,
          output,
          exitCode,
          duration: Date.now() - startTime,
        });
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // Timeout
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 3000);
        finish(false, `[TIMEOUT] Gemini antwortete nicht innerhalb von ${timeout/1000}s\n\nPartielle Ausgabe:\n${stdout || stderr || '(keine)'}`, null);
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        // Bereinige ANSI-Codes
        const cleanOutput = (stdout || stderr)
          .replace(/\x1b\[[0-9;]*m/g, '')
          .replace(/\r\n/g, '\n')
          .trim();

        if (code === 0 && cleanOutput) {
          finish(true, cleanOutput, code);
        } else {
          finish(false, cleanOutput || `[ERROR] Exit code: ${code}`, code);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        finish(false, `[SPAWN ERROR] ${err.message}`, null);
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    // Prüfe ob gemini CLI existiert
    return new Promise((resolve) => {
      const child = spawn(process.platform === 'win32' ? 'gemini.cmd' : 'gemini', ['--version'], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }
}

export const geminiWrapper = new GeminiWrapper();
