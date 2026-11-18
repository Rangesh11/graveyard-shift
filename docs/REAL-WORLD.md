# Real-world scans

On November 18, 2026, Graveyard Shift scanned the committed `package-lock.json` and `package.json` of three public projects, using the paste-lockfile mode with no source scan.

| Project | Packages (deduplicated) | Zombies | Share | Direct zombies | Scan time |
| --- | ---: | ---: | ---: | ---: | ---: |
| mozilla/pdf.js | 822 | 232 | 28% | 6 | 17 s cold, 3 s cached |
| jitsi/jitsi-meet | 1,700 | 593 | 35% | 60 | 32 s cold |
| bitwarden/clients | 2,640 | 755 | 29% | 39 | 44 s cold |

A zombie here is a package that its author deprecated, or that has had no release for two years or more. That two-year line matches the dormancy study cited in the brief.

## What the numbers do and do not say

- **GitHub checks were skipped.** The anonymous GitHub API limit (60 calls an hour) was used up, so every repository state is "unknown". Archived repos that still publish occasionally are therefore not counted, and the archived share is a lower bound. Set `GITHUB_TOKEN` for a full run.
- **Most zombies are transitive.** For those, the Coroner points at the direct dependency that pulls them in rather than patching them in place.
- **A zombie is not always dangerous.** Many dormant packages are tiny and finished. The risk score ranks them so a team starts with the ones that matter: direct, widely imported, with known advisories.
- **Deprecated is not always dead.** Some direct zombies in bitwarden/clients are framework packages that their authors deprecated in favour of a successor, for example `@angular/animations` and `@angular-devkit/build-angular`. These are deprecated but still maintained by their owners, so the right fix is a migration, which the Coroner escalates.

## A false positive these scans found, now fixed

The first pdf.js scan flagged `glob@11.1.0` and `glob@10.5.0` as zombies, because npm marks those versions deprecated. glob itself is actively maintained, so a normal upgrade fixes them. Graveyard Shift now separates the two cases:

- If the whole package is dead, it is a zombie.
- If only the installed version is deprecated and a maintained release exists, it is marked "upgrade" and left to version bots.

The rule is covered by a property test in `test/score.test.ts`.

## Reproduce

```bash
curl -sfLO https://raw.githubusercontent.com/mozilla/pdf.js/HEAD/package-lock.json
```

```bash
curl -sfLO https://raw.githubusercontent.com/mozilla/pdf.js/HEAD/package.json
```

```bash
node bin/graveyard.mjs scan .
```

Or paste both files into **Paste lockfile** in the UI. Numbers drift as the projects and the registry change.
