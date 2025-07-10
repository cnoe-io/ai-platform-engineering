# Security Policies and Procedures

This document outlines security procedures and general policies for the Cisco ETI Agent projects.

- [Security Policies and Procedures](#security-policies-and-procedures)
  - [Disclosing a security issue](#disclosing-a-security-issue)
  - [Vulnerability management](#vulnerability-management)
  - [Security best practices](#security-best-practices)
  - [Suggesting changes](#suggesting-changes)

## Disclosing a security issue

The Cisco ETI Agent maintainers take all security issues in our projects seriously. Thank you for improving the security of our projects. We appreciate your dedication to responsible disclosure and will make every effort to acknowledge your contributions.

Our projects leverage GitHub's private vulnerability reporting system.

To learn more about this feature and how to submit a vulnerability report,
review [GitHub's documentation on private reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability).

Here are some helpful details to include in your report:

- A detailed description of the issue
- The steps required to reproduce the issue
- Versions of the project that may be affected by the issue
- If known, any mitigations for the issue
- Impact assessment of the vulnerability
- Any relevant logs or error messages
- Your contact information for follow-up

A maintainer will acknowledge the report within 24 hours, and
will send a more detailed response within 48 hours indicating the next steps in handling your report.

If you've been unable to successfully draft a vulnerability report via GitHub or
have not received a response during the allotted response window, please reach out to the Maintainers
directly through the contact information provided in the MAINTAINERS.md file.

After the initial reply to your report, the maintainers will endeavor to keep
you informed of the progress towards a fix and full announcement, and may ask
for additional information or guidance.

## Vulnerability management

When the maintainers receive a disclosure report, they will assign it to a
primary handler. This person will coordinate the fix and release process, which involves the
following steps:

- Confirming the issue and its severity
- Determining affected versions of the project
- Auditing code to find any potential similar problems
- Preparing fixes for all releases under maintenance
- Coordinating with the security team for review
- Planning and executing the release of security patches
- Publishing security advisories when necessary

## Security best practices

To maintain the security of our projects, we follow these best practices:

1. Regular security audits of dependencies
2. Automated security scanning in CI/CD pipelines
3. Code review requirements for all changes
4. Secure coding guidelines for contributors
5. Regular updates of security-related dependencies
6. Implementation of security headers and best practices
7. Regular penetration testing for critical components

## Suggesting changes

If you have suggestions on how this process could be improved please submit an
issue or pull request. We welcome feedback on our security policies and procedures. 