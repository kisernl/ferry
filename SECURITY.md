# Security Policy

Ferry exists to protect secrets, so we take reports seriously.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** to the maintainer
(security contact listed in the repository profile) rather than opening a
public issue. Include:

- affected version / commit
- reproduction steps
- impact assessment

We aim to acknowledge within 3 business days.

## Scope notes

- Ferry holds no secrets at rest; the SQLite file contains no secret values by
  design. If you find a code path that persists or logs a value, that is a
  critical bug — please report it.
- Deployment-level issues (misconfigured IAM, open Security Groups) are out of
  scope but documentation gaps that mislead deployers are in scope.
