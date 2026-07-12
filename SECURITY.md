# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Email `serram1994@gmail.com` with:

- the affected Swift Sim version or commit;
- the component involved;
- steps to reproduce;
- the expected impact;
- any suggested mitigation.

Do not include live install links, pairing tokens, device identifiers, signing material, or other user secrets unless they are essential to the report. Redact them whenever possible.

## Supported Versions

Security fixes target the latest tagged release and `main`. Older Homebrew releases may not receive patches; users should run `swift-sim update` before reporting an issue already fixed upstream.

## Security Model

The detailed trust boundaries, token behavior, network exposure, signing flow, and current limitations are documented in [docs/SECURITY.md](docs/SECURITY.md).
