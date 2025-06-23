import { describe, it, expect, vi } from "vitest";

vi.mock("../src/utils/visual-loop", () => ({
  __esModule: true,
  captureScreenshots: vi.fn(async () => ["aGVsbG8="]),
}));

class StreamWithCall {
  public controller = { abort: vi.fn() };
  async *[Symbol.asyncIterator]() {
    yield {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: "call1",
        function: { name: "capture_screenshots", arguments: "{}" },
      },
    } as any;
    yield {
      type: "response.completed",
      response: {
        id: "r1",
        status: "completed",
        output: [
          {
            type: "function_call",
            id: "call1",
            function: { name: "capture_screenshots", arguments: "{}" },
          },
        ],
      },
    } as any;
  }
}

class EmptyStream {
  public controller = { abort: vi.fn() };
  async *[Symbol.asyncIterator]() {}
}

let capturedSecond: any = null;

vi.mock("openai", () => {
  let calls = 0;
  class FakeOpenAI {
    public responses = {
      create: async (_params: any) => {
        calls += 1;
        if (calls === 1) {
          return new StreamWithCall();
        }
        capturedSecond = _params;
        return new EmptyStream();
      },
    };
  }
  class APIConnectionTimeoutError extends Error {}
  return { __esModule: true, default: FakeOpenAI, APIConnectionTimeoutError, _test: { getSecond: () => capturedSecond } };
});

vi.mock("../src/approvals.js", () => ({
  __esModule: true,
  alwaysApprovedCommands: new Set<string>(),
  canAutoApprove: () => ({ type: "auto-approve", runInSandbox: false }) as any,
  isSafeCommand: () => null,
}));

vi.mock("../src/format-command.js", () => ({
  __esModule: true,
  formatCommandForDisplay: (c: Array<string>) => c.join(" "),
}));

vi.mock("../src/utils/agent/log.js", () => ({
  __esModule: true,
  log: () => {},
  isLoggingEnabled: () => false,
}));

import { AgentLoop } from "../src/utils/agent/agent-loop.js";

describe("capture_screenshots tool", () => {
  it("returns images to the assistant", async () => {
    const { captureScreenshots } = await import("../src/utils/visual-loop");
    const { _test } = (await import("openai")) as any;

    const agent = new AgentLoop({
      model: "gpt-4o",
      instructions: "",
      approvalPolicy: { mode: "auto" } as any,
      additionalWritableRoots: [],
      onItem: () => {},
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" }) as any,
      onLastResponseId: () => {},
    });

    await agent.run([
      { type: "message", role: "user", content: [{ type: "input_text", text: "ui" }] },
    ] as any);

    await new Promise((r) => setTimeout(r, 20));

    expect((captureScreenshots as any).mock.calls.length).toBe(1);
    const body = _test.getSecond();
    const outputItem = body.input.find((i: any) => i.type === "function_call_output");
    expect(outputItem.output).toContain("aGVsbG8=");
  });

  it("stays inactive for text-only tasks", async () => {
    capturedSecond = null;
    const visuals = await import("../src/utils/visual-loop");
    (visuals as any).captureScreenshots = vi.fn();

    class StreamNoCall {
      public controller = { abort: vi.fn() };
      async *[Symbol.asyncIterator]() {
        yield { type: "response.completed", response: { id: "r1", status: "completed", output: [] } } as any;
      }
    }

    vi.doMock("openai", () => {
      let used = false;
      class FakeOpenAI {
        public responses = {
          create: async (_p: any) => {
            if (used) {
              capturedSecond = _p;
              return new EmptyStream();
            }
            used = true;
            return new StreamNoCall();
          },
        };
      }
      class APIConnectionTimeoutError extends Error {}
      return { __esModule: true, default: FakeOpenAI, APIConnectionTimeoutError, _test: { getSecond: () => capturedSecond } };
    });

    const { AgentLoop: Loop } = await import("../src/utils/agent/agent-loop.js");
    const loop = new Loop({
      model: "gpt-4o",
      instructions: "",
      approvalPolicy: { mode: "auto" } as any,
      additionalWritableRoots: [],
      onItem: () => {},
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" }) as any,
      onLastResponseId: () => {},
    });

    await loop.run([
      { type: "message", role: "user", content: [{ type: "input_text", text: "docs" }] },
    ] as any);

    await new Promise((r) => setTimeout(r, 20));

    expect(capturedSecond).not.toBeNull();
    const { captureScreenshots: spy } = await import("../src/utils/visual-loop");
    expect((spy as any).mock.calls.length).toBe(0);
  });
});
