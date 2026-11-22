# Privacy and children's data controls

This maps controls to the rules for the countries in the onboarding flow. It is an engineering record, not legal advice. Have it reviewed before launch.

## Control map

| Requirement | Rule | Control in this codebase |
|---|---|---|
| Data minimisation | UK GDPR Art 5(1)(c); Children's Code std 8; COPPA 312.7 | No child email, surname, date of birth, photo or voice; age stored as a band; Clerk names/usernames off |
| High privacy by default | Children's Code std 7 | Play works with no account; backup, boards, leagues and emails start off |
| Verifiable parental consent | COPPA 312.5 | Parent-only accounts with a verified email; leagues need re-verification. **Gap:** "email plus" needs a delayed confirmation email, or use card check for US families before public features are enabled there |
| Consent records | UK GDPR Art 7(1) | Append-only `consents` table with method, policy version and receipt hash; downloadable |
| Withdrawal as easy as giving | UK GDPR Art 7(3) | Same switch; withdrawing backup purges the queue; withdrawing leagues removes the child from published boards |
| No public disclosure of children's personal data | COPPA (disclosure); Children's Code std 9 | Public boards show only curated game names and avatars; free text never reaches a public surface |
| Nudge techniques | Children's Code std 13 | No timers by default, no streak loss, no demotion, no paid currency, daily points cap |
| Geolocation | Children's Code std 10 | Country chosen by the parent; Netlify geo only pre-selects it; no city or coordinates stored |
| Right of access and portability | UK GDPR Art 15, 20; NDPA s.34; COPPA 312.6 | `GET /api/export` |
| Right to erasure | UK GDPR Art 17; NDPA s.34; COPPA 312.6 | `DELETE /api/account` (reverified), Clerk `user.deleted` webhook, child delete; cascades and purges Blobs |
| Complaints procedure | UK Data (Use and Access) Act 2025 (from 19 June 2026) | `POST /api/complaints`, acknowledged within 30 days, ICO route shown |
| Written retention policy | COPPA amended rule 312.10 (compliance from 22 April 2026) | Below, enforced daily by `retention` |
| Security | UK GDPR Art 32; NDPA s.39; COPPA 312.8 | See ARCHITECTURE.md security layers |
| Child = under 18 | Nigeria NDPA s.31 | Same parent-consent model applies to all players |
| Licensing and DPO | Egypt PDPL | **Gap:** licensing from the Personal Data Protection Centre before processing Egyptian users' data |
| International transfers | UK GDPR Ch V | Database in London. Netlify functions run in the US (cmh) and Clerk is US-based: rely on their DPAs and the UK-US data bridge; record this in the DPIA |

## Retention policy (enforced by `netlify/functions/retention.mts`)

| Data | Kept for |
|---|---|
| Round details (each answer and time) | 12 months, then deleted; fact totals stay |
| Weekly points | 2 years |
| Leagues and published boards | 12 weeks |
| Unsynced rounds in the queue | 14 days |
| Audit log (no personal data) | 2 years |
| Resolved complaints | 3 years |
| Whole family after no activity | 2 years, then erased with the Clerk account |
| Erasure record | A hashed reference only |

## Before launch

1. Complete a DPIA (the Children's Code expects one for this service).
2. Clerk production instance on your own domain, with bot protection on and the legal consent links.
3. Decide the US consent method (email plus with delayed confirmation, or card check).
4. Egypt: PDPL licence, or keep Egypt in "play on device only" until licensed.
5. Name a contact for privacy complaints and add it to the privacy page.
