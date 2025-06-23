# Visual Loop TODO

- [x] Add `--visual-loop` CLI flag and related options for start command, URL, and iteration limit.
- [x] Implement screenshot capture utility using Puppeteer.
- [x] Implement OpenAI vision-based evaluation helper.
- [x] Integrate loop with Codex agent so screenshots are taken after each patch and evaluated automatically.
- [x] Document new feature and usage in README.
- [x] Add unit tests for screenshot capture and overall loop control.
- [x] Add integration test using real OpenAI model (requires OPENAI_API_KEY)
- [x] Expose `capture_screenshots` tool for autonomous visual checks.
- [x] Update system prompt describing when to call the new tool.
- [x] Provide CODEX_DISABLE_VISUAL_TOOL env to disable the feature.
- [x] Add tests for tool invocation and for non-visual tasks.
- [x] Compress screenshots before sending to reduce cost.
