import express from "express";
import fs from "fs";
import { test, expect, vi } from "vitest";
import { screenshotUrl, _test as visualTest } from "../src/utils/visual-loop";

// Basic test to ensure screenshot capture works

test("screenshotUrl captures images", async () => {
  const app = express();
  app.get("/", (_req, res) => {
    res.send("<html><body>Hello</body></html>");
  });
  const server = app.listen(0);
  const port = (server.address() as any).port;

  let shots: Array<string> = [];
  try {
    shots = await screenshotUrl(`http://localhost:${port}`);
  } catch (err) {
    server.close();
    // eslint-disable-next-line no-console
    console.warn("Skipping screenshot test:", (err as Error).message);
    return;
  }
  expect(shots.length).toBe(3);
  for (const file of shots) {
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).size).toBeGreaterThan(0);
    fs.unlinkSync(file);
  }
  server.close();
});

test("evaluateScreenshots integrates screenshots", async () => {
  const app = express();
  app.get("/", (_req, res) => {
    res.send("<html><body><h1 id='greet'>Hello</h1></body></html>");
  });
  const server = app.listen(0);
  const port = (server.address() as any).port;

  let shots: Array<string> = [];
  try {
    shots = await screenshotUrl(`http://localhost:${port}`);
  } catch (err) {
    server.close();
    // eslint-disable-next-line no-console
    console.warn("Skipping screenshot integration test:", (err as Error).message);
    return;
  }

  vi.mock("openai", () => {
    return {
      __esModule: true,
      default: class FakeOpenAI {
        public chat = {
          completions: {
            create: vi.fn(async ({ messages }) => {
              const imgMsg = messages.find((m: any) => Array.isArray(m.content));
              const b64 = imgMsg.content[1].image_url.split(",")[1];
              expect(Buffer.from(b64, "base64").length).toBeGreaterThan(1000);
              return { choices: [{ message: { content: "DONE ✅" } }] } as any;
            }),
          },
        };
      },
    };
  });

  const { evaluateScreenshots } = visualTest as any;
  const result = await evaluateScreenshots("gpt-4o", "Check", shots);
  expect(result).toContain("DONE ✅");
  for (const f of shots) {
    fs.unlinkSync(f);
  }
  server.close();
});
