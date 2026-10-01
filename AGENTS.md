<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Verification

Before finishing a change, run:

```bash
npm run format && npm run lint && npm run typecheck && npm run test && npm run build
```

`npm run build` is required. Format, lint, typecheck, and unit tests do not exercise route-segment analysis or the production bundle.
