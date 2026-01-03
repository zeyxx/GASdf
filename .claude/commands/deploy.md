# Deploy to Render

Run tests, commit, and trigger deploy.

```bash
# Pre-compute status
echo "=== Git Status ===" && git status --short
echo "=== Test Results ===" && npm test 2>&1 | tail -5
echo "=== Current Branch ===" && git branch --show-current
```

## Steps

1. Run `npm test` - ensure all tests pass
2. If changes exist, commit with descriptive message
3. Push to main branch
4. Render auto-deploys on push

## Verification

After deploy, check:
- https://gasdf-43r8.onrender.com/health
- https://status.asdfasdfa.tech
