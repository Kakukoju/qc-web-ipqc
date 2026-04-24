# Workflow

This repo uses a simple rule:

`No commit, not done.`

## Daily flow

1. Make the change.
2. Check what changed with `git status`.
3. Create a checkpoint commit:

```bash
scripts/checkpoint.sh "short summary of the work"
```

4. Push when you want the backup on GitHub:

```bash
scripts/checkpoint.sh "short summary of the work" --push
```

## Commit guidance

- Keep one task per commit when possible.
- Use short, clear messages that describe the outcome.
- Commit every meaningful work unit, even if it is a small cleanup.
- If a task is still experimental, either commit it on a branch or leave it uncommitted on purpose.

Examples:

```bash
scripts/checkpoint.sh "Add spec sync endpoint"
scripts/checkpoint.sh "Fix posts records lookup"
scripts/checkpoint.sh "Update weekly report notes" --push
```

## Optional shell alias

Add one of these to your shell profile if you want a shorter command.

For bash or zsh:

```bash
alias ck='./scripts/checkpoint.sh'
```

For PowerShell:

```powershell
function ck { bash ./scripts/checkpoint.sh $args }
```

Then you can run:

```bash
ck "Refine PPT summary flow"
ck "Update API routes" --push
```
