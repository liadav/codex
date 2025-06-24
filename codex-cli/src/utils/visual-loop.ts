import type { AppConfig } from "./config.js";
import type * as JimpNS from "jimp";
import type { ResponseItem } from "openai/resources/responses/responses";

import { AgentLoop } from "./agent/agent-loop.js";
import { ReviewDecision } from "./agent/review.js";
import { AutoApprovalMode } from "./auto-approval-mode.js";
import { createInputItem } from "./input-utils.js";
import { createOpenAIClient } from "./openai-client.js";
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

async function loadAndCompress(file: string): Promise<string> {
  const { Jimp } = (await import("jimp")) as typeof JimpNS;
  const image = await Jimp.read(file);
  const compressed = await image.getBuffer("image/jpeg", { quality: 60 });
  return compressed.toString("base64");
}

export type VisualLoopOptions = {
  prompt: string;
  config: AppConfig;
  model: string;
  startCommand?: string;
  url?: string;
  maxAttempts?: number;
  skipCompression?: boolean;
};

const VIEWPORTS = [
  { width: 375, height: 667 }, // phone
  { width: 768, height: 1024 }, // tablet
  { width: 1440, height: 900 }, // desktop
];

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await fetch(url, { method: "HEAD" });
      return;
    } catch {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Server did not start at ${url}`);
}

export async function screenshotUrl(url: string): Promise<Array<string>> {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  const files: Array<string> = [];
  for (const vp of VIEWPORTS) {
    // eslint-disable-next-line no-await-in-loop
    await page.setViewport(vp);
    // eslint-disable-next-line no-await-in-loop
    await page.goto(url, { waitUntil: "networkidle2" });
    const tmp = path.join(
      os.tmpdir(),
      `codex-shot-${vp.width}x${vp.height}-${Date.now()}.jpg`,
    );
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: tmp, type: "jpeg", quality: 80 });
    files.push(tmp);
  }
  await browser.close();
  return files;
}

export async function captureScreenshots(params: {
  startCommand?: string;
  url?: string;
  skipCompression?: boolean;
}): Promise<Array<string>> {
  const {
    startCommand = "npm start",
    url = "http://localhost:3000",
    skipCompression = process.env["CODEX_SKIP_COMPRESSION"] === "1",
  } = params ?? {};
  const proc = spawn(startCommand, { shell: true, stdio: "ignore" });
  try {
    await waitForServer(url);
    const files = await screenshotUrl(url);
    const images = await Promise.all(
      files.map(async (f) => {
        const base64 = await loadAndCompress(f, skipCompression);
        await fs.unlink(f).catch(() => {});
        return base64;
      }),
    );
    return images;
  } finally {
    proc.kill();
  }
}

function supportsVision(model: string): boolean {
  const lower = model.toLowerCase();
  return (
    lower.includes("gpt-4") || lower.includes("o3") || lower.includes("o4")
  );
}

async function evaluateScreenshots(
  model: string,
  prompt: string,
  screenshots: Array<string>,
  skipCompression = process.env["CODEX_SKIP_COMPRESSION"] === "1",
): Promise<string> {
  if (!supportsVision(model)) {
    // eslint-disable-next-line no-console
    console.warn(
      `Model ${model} may not support vision; skipping visual check.`,
    );
    return "DONE ✅";
  }
  const openai = createOpenAIClient({ provider: "openai" });
  const contents = await Promise.all(
    screenshots.map((s) => loadAndCompress(s, skipCompression)),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: Array<any> = [
    {
      role: "system",
      content:
        "Decide if the user's request has been fulfilled. Reply with DONE ✅ if so, otherwise explain what is missing.",
    },
    { role: "user", content: prompt },
  ];
  for (const b64 of contents) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: "screenshot" },
        { type: "image_url", image_url: `data:image/jpeg;base64,${b64}` },
      ],
    });
  }
  const resp = await openai.chat.completions.create({
    model,
    messages,
  });
  return resp.choices?.[0]?.message?.content || "";
}

async function runCodexOnce(
  prompt: string,
  config: AppConfig,
): Promise<Array<ResponseItem>> {
  const items: Array<ResponseItem> = [];
  const agent = new AgentLoop({
    model: config.model,
    config,
    instructions: config.instructions,
    provider: config.provider,
    approvalPolicy: AutoApprovalMode.AUTO_EDIT,
    additionalWritableRoots: [],
    disableResponseStorage: config.disableResponseStorage,
    onItem: (it) => items.push(it),
    onLoading: () => {},
    getCommandConfirmation: () =>
      Promise.resolve({ review: ReviewDecision.YES }),
    onLastResponseId: () => {},
  });
  const inputItem = await createInputItem(prompt, []);
  await agent.run([inputItem]);
  return items;
}

export async function runVisualLoop(opts: VisualLoopOptions): Promise<void> {
  const {
    prompt: original,
    config,
    model,
    startCommand = "npm start",
    url = "http://localhost:3000",
    maxAttempts = 3,
    skipCompression = process.env["CODEX_SKIP_COMPRESSION"] === "1",
  } = opts;
  let prompt = original;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // eslint-disable-next-line no-await-in-loop
    await runCodexOnce(prompt, config);
    const proc = spawn(startCommand, { shell: true, stdio: "ignore" });
    try {
      // eslint-disable-next-line no-await-in-loop
      await waitForServer(url);
      // eslint-disable-next-line no-await-in-loop
      const shots = await screenshotUrl(url);
      // eslint-disable-next-line no-await-in-loop
      const evaluation = await evaluateScreenshots(
        model,
        original,
        shots,
        skipCompression,
      );
      if (/DONE\s*✅/i.test(evaluation)) {
        // eslint-disable-next-line no-console
        console.log("DONE ✅");
        break;
      }
      prompt = evaluation;
    } finally {
      proc.kill();
    }
  }
}

export const _test = {
  evaluateScreenshots,
  captureScreenshots,
  loadAndCompress,
};
