#!/usr/bin/env node
/**
 * gemini-claude-bridge - MCP Server
 *
 * Brücke zwischen Gemini CLI (Orchestrator) und Claude Code CLI (Worker).
 * Gemini kann autonom Coding-Tasks an Claude delegieren.
 *
 * ARCHITEKTUR:
 * - KEINE API-Calls → nutzt lokale Claude CLI
 * - Auth via bestehendes Abo (claude login)
 * - Gemini agiert als "Lead Architect", Claude als "Hands-on Developer"
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { claudeWrapper } from "./ClaudeWrapper.js";

// ============================================================================
// Zod Schemas für Tool-Inputs
// ============================================================================

const DelegateTaskSchema = z.object({
  instruction: z
    .string()
    .min(1, "Instruction darf nicht leer sein")
    .describe(
      "Die Aufgabenbeschreibung für Claude. Sei präzise und spezifisch."
    ),
  workingDirectory: z
    .string()
    .optional()
    .describe("Arbeitsverzeichnis für die Task-Ausführung"),
  timeout: z
    .number()
    .min(10000)
    .max(3600000)
    .optional()
    .describe("Timeout in ms (10s - 1h, default: 10min)"),
  sessionId: z
    .string()
    .uuid()
    .optional()
    .describe("Session-ID für explizite Session-Wiederaufnahme"),
  continueSession: z
    .boolean()
    .optional()
    .describe("Session automatisch fortsetzen (default: true). Auf false setzen für neue Session."),
});

type DelegateTaskInput = z.infer<typeof DelegateTaskSchema>;

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new Server(
  {
    name: "gemini-claude-bridge",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============================================================================
// Tool: delegate_coding_task
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "delegate_coding_task",
        description: `Delegiert eine Coding-Aufgabe an Claude Code CLI.

VERWENDUNG:
- Code schreiben, analysieren, debuggen, refactoren
- Dateien lesen, erstellen, bearbeiten
- Git-Operationen durchführen
- Tests schreiben und ausführen
- Projektstrukturen erstellen

SESSION-PERSISTENZ:
- Sessions werden automatisch pro Arbeitsverzeichnis gespeichert
- Claude behält den Kontext zwischen Aufrufen
- Setze continueSession=false für eine frische Session

Claude hat VOLLSTÄNDIGEN Zugriff auf das Dateisystem und kann autonom arbeiten.
Nutze dieses Tool SOFORT wenn Code-Arbeit erforderlich ist.

HINWEIS: Nutzt das lokal authentifizierte Claude-Abo (keine API-Credits).`,
        inputSchema: {
          type: "object" as const,
          properties: {
            instruction: {
              type: "string",
              description:
                "Präzise Aufgabenbeschreibung. Je spezifischer, desto besser das Ergebnis.",
            },
            workingDirectory: {
              type: "string",
              description:
                "Optionales Arbeitsverzeichnis. Default: aktuelles Verzeichnis.",
            },
            timeout: {
              type: "number",
              description:
                "Optionales Timeout in ms. Default: 600000 (10 Minuten).",
              minimum: 10000,
              maximum: 3600000,
            },
            sessionId: {
              type: "string",
              format: "uuid",
              description:
                "Optionale Session-ID für explizite Wiederaufnahme einer bestimmten Session.",
            },
            continueSession: {
              type: "boolean",
              description:
                "Session automatisch fortsetzen (default: true). Auf false setzen für neue Session.",
              default: true,
            },
          },
          required: ["instruction"],
        },
      },
      {
        name: "clear_session",
        description: `Löscht die gespeicherte Session für ein Arbeitsverzeichnis.
Verwende dies um eine frische Session zu starten ohne alten Kontext.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            workingDirectory: {
              type: "string",
              description: "Arbeitsverzeichnis dessen Session gelöscht werden soll.",
            },
          },
          required: ["workingDirectory"],
        },
      },
      {
        name: "list_sessions",
        description: `Listet alle aktiven Sessions mit ihren Arbeitsverzeichnissen und Task-Zählern.`,
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ============================================================================
  // Tool: delegate_coding_task
  // ============================================================================
  if (name === "delegate_coding_task") {
    const parseResult = DelegateTaskSchema.safeParse(args);

    if (!parseResult.success) {
      const errorMessages = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");

      throw new McpError(ErrorCode.InvalidParams, `Validation failed: ${errorMessages}`);
    }

    const input: DelegateTaskInput = parseResult.data;

    // Claude ausführen mit Session-Support
    const result = await claudeWrapper.execute(input.instruction, {
      workingDirectory: input.workingDirectory,
      timeout: input.timeout,
      sessionId: input.sessionId,
      continueSession: input.continueSession,
    });

    // Ergebnis formatieren
    const statusPrefix = result.success ? "✓ SUCCESS" : "✗ FAILED";
    const durationSec = (result.duration / 1000).toFixed(1);
    const sessionInfo = result.sessionId ? `\n[Session: ${result.sessionId}]` : "";

    const formattedOutput = `[${statusPrefix}] (${durationSec}s)${sessionInfo}

${result.output}`;

    return {
      content: [
        {
          type: "text",
          text: formattedOutput,
        },
      ],
      isError: !result.success,
    };
  }

  // ============================================================================
  // Tool: clear_session
  // ============================================================================
  if (name === "clear_session") {
    const workingDirectory = (args as { workingDirectory?: string })?.workingDirectory;

    if (!workingDirectory) {
      throw new McpError(ErrorCode.InvalidParams, "workingDirectory ist erforderlich");
    }

    const cleared = claudeWrapper.clearSession(workingDirectory);

    return {
      content: [
        {
          type: "text",
          text: cleared
            ? `✓ Session für ${workingDirectory} gelöscht.`
            : `⚠ Keine Session für ${workingDirectory} gefunden.`,
        },
      ],
      isError: false,
    };
  }

  // ============================================================================
  // Tool: list_sessions
  // ============================================================================
  if (name === "list_sessions") {
    const sessions = claudeWrapper.listSessions();

    if (sessions.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Keine aktiven Sessions gefunden.",
          },
        ],
        isError: false,
      };
    }

    const sessionList = sessions
      .map((s) => `• ${s.workingDirectory}\n  Session: ${s.sessionId}\n  Tasks: ${s.taskCount} | Letzte Nutzung: ${s.lastUsed}`)
      .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `Aktive Sessions (${sessions.length}):\n\n${sessionList}`,
        },
      ],
      isError: false,
    };
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

// ============================================================================
// Server Startup
// ============================================================================

async function main(): Promise<void> {
  const transport = new StdioServerTransport();

  // Graceful Shutdown
  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
}

main().catch((error) => {
  console.error("[FATAL]", error);
  process.exit(1);
});
