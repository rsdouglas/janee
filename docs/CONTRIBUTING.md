# Contributing to Janee

## Pull Request Workflow

When you're ready to contribute changes:

1. Commit your changes to a feature branch
2. Push the branch to GitHub
3. Open a pull request against the `main` branch
4. Review the PR Checklist below to ensure your PR is ready
5. Wait for review and address any feedback

## PR Checklist

Before submitting a PR, review this checklist. Not everything applies to every PR — use judgment.

### Always

- [ ] **Tests** — New features need tests. Bug fixes need regression tests.
- [ ] **CHANGELOG.md** — Update `docs/CHANGELOG.md` for user-facing changes.

### When Applicable

- [ ] **README.md** — Update if adding new features, CLI commands, or config options.
- [ ] **SKILL.md** — Update if agents need to know about the change (new tools, new auth types, new capabilities).
- [ ] **docs/** — Add or update documentation for significant features.
- [ ] **RFC status** — If implementing an RFC, update its status from Draft → Implemented.
- [ ] **Types** — Ensure TypeScript types are updated and exported if needed.
- [ ] **Security review** — For auth/crypto changes, note any security considerations in the PR description.

### Before Merge

- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] PR description explains *what* and *why*
- [ ] Breaking changes are clearly noted

## Commit Messages

Keep them short and descriptive:
- `feat: Add service account authentication`
- `fix: Handle 401 retry in token refresh`
- `docs: Update changelog for v0.2.0`
- `test: Add caching tests for service accounts`

## RFC Process

For significant features:

1. Create RFC in `docs/rfcs/NNNN-feature-name.md`
2. Get feedback before implementing
3. Reference RFC in PR
4. Update RFC status when merged

## Security

Janee is a security product. Extra care required:

- Never log credentials, tokens, or private keys
- Encrypt secrets at rest
- Validate all inputs
- Document security implications in PRs
- When in doubt, ask for a security review
