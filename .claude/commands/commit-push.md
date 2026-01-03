# Commit and Push

Quick commit and push workflow.

```bash
echo "=== Status ===" && git status --short
echo -e "\n=== Diff Stats ===" && git diff --stat HEAD
echo -e "\n=== Recent Commits ===" && git log --oneline -3
echo -e "\n=== Branch ===" && git branch -vv | grep '\*'
```

## Workflow

1. Review changes above
2. Stage relevant files with `git add`
3. Commit with descriptive message following conventions:
   - `feat:` new feature
   - `fix:` bug fix
   - `test:` adding tests
   - `docs:` documentation
   - `refactor:` code restructuring
4. Push to origin

## Commit Footer

Always include:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```
