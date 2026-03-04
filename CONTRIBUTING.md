# Contributing to devstash

Thanks for your interest in contributing!

## Adding a New Tool

1. Create a directory under `src/tools/<your-tool>/`
2. Export from an `index.ts` barrel file
3. Wire it into `src/cli.ts` as a new subcommand
4. Add a section to the README

## Development

```bash
pnpm install
pnpm dev       # watch mode
pnpm build     # production build
pnpm test      # run tests
pnpm typecheck # type checking
```

## Guidelines

- Keep tools self-contained and independently useful
- Cross-platform support (Windows + macOS + Linux) is required
- TypeScript strict mode, no `any`
- Test behavior, not implementation
- Small, focused PRs

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(history): add fish shell support
fix(history): handle empty history files
docs: update roadmap
```
