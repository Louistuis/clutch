# Changelog

## 1.0.0

First public release.

- `/auto`: Jev 1.14 scores each prompt and picks the model and the effort for that turn.
- `/auto-effort`: Jev picks only the effort; your model and its prompt cache stay as they are.
- `/auto off` stops either mode. The mode is remembered across sessions.
- The status line shows each pick, for example `/auto → sonnet · medium · 1.2/4`.
- Reads the end of Claude's previous reply as well as your prompt, so "yes, do it" after a big plan counts as the plan's size.
- Falls back to the session's own settings if Jev does not answer within 2.5 s.
- Your OpenRouter key comes from `$OPENROUTER_API_KEY` or `~/.config/openrouter.key`.
- Benchmark script and results for 73 hand-labelled prompts in `bench/`.
