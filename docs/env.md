# Environment Variables

Create a local `.env` file at the repository root:

```text
intentops-harness/
  .env
  .env.example
  README.md
  app/
  docs/
  packages/
  scripts/
```

Required values:

```env
GEMINI_API_KEY=replace_with_your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

Notes:

- Do not commit `.env`.
- `.env.example` is safe to commit because it does not contain a real key.
- The API key must only be read by the Node server, never by browser-side JavaScript.
