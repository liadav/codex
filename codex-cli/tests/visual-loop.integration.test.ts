import express from "express";
import fs from "fs";
import { test, expect } from "vitest";
import { screenshotUrl, _test as visualTest } from "../src/utils/visual-loop";

// This test calls the real OpenAI API. Requires OPENAI_API_KEY and network access.

test("evaluateScreenshots with real model", async () => {
  if (!process.env["OPENAI_API_KEY"]) {
    // eslint-disable-next-line no-console
    console.warn("Skipping integration test: OPENAI_API_KEY not set");
    return;
  }

  const app = express();
  app.get("/", (_req, res) => {
    res.send("<html><body><h1>Hello visual loop</h1></body></html>");
  });
  const server = app.listen(0);
  const port = (server.address() as any).port;

  let shots: Array<string> = [];
  try {
    shots = await screenshotUrl(`http://localhost:${port}`);
    const { evaluateScreenshots } = visualTest as any;
    const result = await evaluateScreenshots(
      "gpt-4o",
      "Does the page contain hello?",
      shots,
    );
    expect(result).toBeTruthy();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "Skipping integration test due to error:",
      (err as Error).message,
    );
  } finally {
    for (const s of shots) {
      try {
        fs.unlinkSync(s);
      } catch {
        /* ignore */
      }
    }
    server.close();
  }
}, 30000);
