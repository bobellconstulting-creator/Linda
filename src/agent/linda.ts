import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "langchain/tools";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import TelegramBot from "node-telegram-bot-api";
import { appendToSheet, readGoogleDoc } from "../utils/googleClient.js";

const systemPrompt = `You are Linda, an Elite Senior Developer Assistant and autonomous co-worker.
You analyze GitHub events, fix bugs, implement features, and can scaffold new AI agents.
If the user explicitly asks to "build an agent" or "generate a new agent", you must create a new agent codebase and push it to a new repository.`;

const openAiModel = new ChatOpenAI({
  model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  temperature: 0.2,
});

const searchInternet = new DynamicStructuredTool({
  name: "searchInternet",
  description: "Search the web for relevant documentation or examples.",
  schema: z.object({
    query: z.string().describe("Search query"),
  }),
  func: async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return "Missing TAVILY_API_KEY";
    }

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
      }),
    });

    if (!response.ok) {
      return `Search failed: ${response.status}`;
    }

    const data = (await response.json()) as { results?: { url: string; content: string }[] };
    return JSON.stringify(data.results ?? []);
  },
});

const writeToGoogleSheet = new DynamicStructuredTool({
  name: "writeToGoogleSheet",
  description: "Append a row to the configured Google Sheet log.",
  schema: z.object({
    spreadsheetId: z.string(),
    range: z.string(),
    values: z.array(z.string()),
  }),
  func: async ({ spreadsheetId, range, values }) => {
    await appendToSheet(spreadsheetId, range, [values]);
    return "Sheet updated";
  },
});

const readGoogleDocTool = new DynamicStructuredTool({
  name: "readGoogleDoc",
  description: "Read a Google Doc by ID and return its plain text contents.",
  schema: z.object({
    documentId: z.string(),
  }),
  func: async ({ documentId }) => {
    const text = await readGoogleDoc(documentId);
    return text.slice(0, 8000);
  },
});

const commitFileToGitHub = new DynamicStructuredTool({
  name: "commitFileToGitHub",
  description: "Commit a file to a GitHub repository using the GitHub API.",
  schema: z.object({
    owner: z.string(),
    repo: z.string(),
    path: z.string(),
    message: z.string(),
    content: z.string(),
    branch: z.string().default("main"),
  }),
  func: async ({ owner, repo, path, message, content, branch }) => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return "Missing GITHUB_TOKEN";
    }

    const octokit = new Octokit({ auth: token });
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });

    const { data: commit } = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: ref.object.sha,
    });

    const { data: blob } = await octokit.git.createBlob({
      owner,
      repo,
      content,
      encoding: "utf-8",
    });

    const { data: tree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: commit.tree.sha,
      tree: [
        {
          path,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        },
      ],
    });

    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: tree.sha,
      parents: [commit.sha],
    });

    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

    return `Committed to ${owner}/${repo}:${path}`;
  },
});

const sendTelegramNotification = new DynamicStructuredTool({
  name: "sendTelegramNotification",
  description: "Send a Telegram notification to the configured chat.",
  schema: z.object({
    message: z.string(),
  }),
  func: async ({ message }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      return "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID";
    }

    const bot = new TelegramBot(token, { polling: false });
    await bot.sendMessage(chatId, message);
    return "Telegram notification sent";
  },
});

export function createLindaAgent() {
  return {
    async handleWebhook({ event, payload }: { event: string; payload: Record<string, unknown> }) {
      const summary = summarizeEvent(event, payload);
      const action = decideAction(summary);

      await logToSheet({
        event,
        action,
        summary,
      });

      let result: string;
      if (action === "build-agent") {
        result = await buildNewAgentRepo(summary);
      } else {
        result = await runAgent(summary);
      }

      await sendTelegramNotification.func({
        message: `Linda update: ${action} completed. Summary: ${summary}. Result: ${result}`,
      });

      return result;
    },
  };
}

async function logToSheet({ event, action, summary }: { event: string; action: string; summary: string }) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE ?? "Logs!A:D";
  if (!spreadsheetId) {
    return;
  }

  await appendToSheet(spreadsheetId, range, [[new Date().toISOString(), event, action, summary]]);
}

function summarizeEvent(event: string, payload: Record<string, unknown>) {
  if (event === "push") {
    const repo = payload.repository as { full_name?: string } | undefined;
    const commits = payload.commits as { message?: string }[] | undefined;
    return `Push to ${repo?.full_name ?? "unknown"}: ${commits?.map((c) => c.message).join(" | ")}`;
  }

  if (event === "issues") {
    const issue = payload.issue as { title?: string; body?: string } | undefined;
    return `Issue: ${issue?.title ?? ""} ${issue?.body ?? ""}`.trim();
  }

  if (event === "issue_comment") {
    const comment = payload.comment as { body?: string } | undefined;
    return `Issue comment: ${comment?.body ?? ""}`.trim();
  }

  return `Unhandled event ${event}`;
}

function decideAction(summary: string) {
  const lowered = summary.toLowerCase();
  if (lowered.includes("build an agent") || lowered.includes("generate a new agent")) {
    return "build-agent";
  }
  return "fix-or-feature";
}

async function runAgent(summary: string) {
  const response = await openAiModel.invoke([
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: `Webhook summary: ${summary}\nDecide the next developer action.`,
    },
  ]);

  return response.content;
}

async function buildNewAgentRepo(summary: string) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return "Missing GITHUB_TOKEN";
  }

  const octokit = new Octokit({ auth: token });
  const owner = process.env.GITHUB_OWNER;
  if (!owner) {
    return "Missing GITHUB_OWNER";
  }

  const repoName = `agent-${Date.now()}`;
  await octokit.repos.createForAuthenticatedUser({
    name: repoName,
    description: "Generated agent scaffold from Linda",
    private: true,
  });

  const scaffold = `# ${repoName}\n\nGenerated by Linda. Summary: ${summary}\n`;

  await commitFileToGitHub.func({
    owner,
    repo: repoName,
    path: "README.md",
    message: "chore: initial agent scaffold",
    content: scaffold,
    branch: "main",
  });

  return `Created new agent repository: ${repoName}`;
}

export const lindaTools = {
  writeToGoogleSheet,
  readGoogleDoc: readGoogleDocTool,
  searchInternet,
  commitFileToGitHub,
  sendTelegramNotification,
};
