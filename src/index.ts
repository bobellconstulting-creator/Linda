import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "http";
import { Webhooks } from "@octokit/webhooks";
import { createLindaAgent } from "./agent/linda.js";

const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

const webhooks = new Webhooks({
  secret: webhookSecret ?? "",
});

const linda = createLindaAgent();

async function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { message: "Method Not Allowed" });
  }

  if (!webhookSecret) {
    return jsonResponse(res, 500, { message: "Missing GITHUB_WEBHOOK_SECRET" });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const event = req.headers["x-github-event"] as string | undefined;

  if (!signature || !event) {
    return jsonResponse(res, 400, { message: "Missing GitHub webhook headers" });
  }

  const isValid = await webhooks.verify(rawBody, signature);
  if (!isValid) {
    return jsonResponse(res, 401, { message: "Invalid signature" });
  }

  const payload = JSON.parse(rawBody);

  const result = await linda.handleWebhook({
    event,
    payload,
  });

  return jsonResponse(res, 200, { status: "ok", result });
}
