# Copilot Instructions

## Commit Message Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/) for automatic versioning and changelog generation.

**Always format commit messages as:**

```
<type>: <description>
```

### Types

| Type | When to use | Version bump |
|------|-------------|--------------|
| `feat` | New feature or capability | Minor (0.X.0) |
| `fix` | Bug fix | Patch (0.0.X) |
| `docs` | Documentation only | Patch |
| `style` | Formatting, whitespace | Patch |
| `refactor` | Code restructure, no behavior change | Patch |
| `perf` | Performance improvement | Patch |
| `test` | Adding/updating tests | Patch |
| `build` | Build system, dependencies | Patch |
| `ci` | CI/CD configuration | Patch |
| `chore` | Maintenance, tooling | Patch |

### Breaking Changes

For breaking changes, add `BREAKING CHANGE:` in the commit body:

```
feat: redesign sync protocol

BREAKING CHANGE: New protocol is incompatible with previous versions.
```

This triggers a **major** version bump (X.0.0).

### Examples

- `feat: add VPN detection warning`
- `fix: resolve late joiner sync issue`
- `docs: update installation instructions`
- `refactor: extract GameStateManager class`
- `chore: update dependencies`
