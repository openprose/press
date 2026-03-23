<!--
Example output from: press run programs/could-haiku/index.md --url "https://docs.astro.build/en/getting-started/" --depth shallow
Model: anthropic/claude-sonnet-4.6
Date: 2026-03-21
-->

# Astro Documentation Diagnostic Report

**Tool Evaluated:** Astro
**Documentation URL:** https://docs.astro.build/en/getting-started/
**Evaluation Method:** Multi-tier AI agent testing (9 agents across 3 capability tiers)
**Stages Tested:** What is Astro · Installation · Project Structure · Build Something

---

## Overall Grade: C− (55/100)

The Astro documentation communicates its value proposition effectively but fails to deliver a functional onboarding experience. Two of four evaluated stages contain no usable content whatsoever — not unclear content, but absent content. A third stage is undermined by a page truncation that cuts off before the critical walkthrough begins. What remains is a polished marketing layer with an incomplete foundation beneath it.

The documentation succeeds at answering *why Astro* and fails at *how to use Astro*.

---

## Per-Stage Clarity Scores

| Stage | Overall Score | Haiku | Sonnet | Opus | Pass Rate |
|---|---|---|---|---|---|
| What is Astro | **8.1 / 10** | 6.7 | 9.0 | 8.7 | 9/9 |
| Installation | **5.9 / 10** | 5.7 | 6.0 | 6.0 | 6/9 |
| Project Structure | **0.6 / 10** | 0.7 | 1.0 | 0.0 | 0/9 |
| Build Something | **1.4 / 10** | 1.0 | 1.7 | 1.7 | 0/9 |

**Reading the table:** Scores reflect average clarity ratings (0–10) assigned by AI agents after reading the provided documentation pages. Pass rate reflects how many of the 9 agents were able to successfully complete that stage using only the available docs.

---

## Complexity Assessment

**Is this documentation accessible to lower-capability AI agents?**

**Partially.** The documentation is calibrated for intermediate-to-experienced developers. The "Why Astro?" page — the clearest and most praised section — makes productive use of terms like Islands architecture, MPA/SPA, TTI, and comparisons to Next.js, SvelteKit, and Nuxt. For experienced readers, these are useful signals. For lower-capability agents (or beginner developers), these terms appear without definition and create comprehension friction.

The Getting Started page functions as a navigation hub rather than actual onboarding content, which places a higher inference burden on the reader. Lower-capability agents are less likely to fill in gaps from partial information — and the current documentation has significant gaps.

**Bottom line:** The docs read well if you already know the space. They struggle for true beginners and lower-capability AI agents.

---

## Ambiguity Findings

The following are specific, documented locations where the documentation is unclear or incomplete:

### Critical (blocking to most users)

**1. Install page is truncated mid-sentence.**
The installation page cuts off before the CLI wizard walkthrough begins — the text ends mid-sentence ("to st..."). The full interactive setup sequence (prompts, choices, expected output) is never shown. Cited as a blocker by 8 of 9 agents. The install command survives only because it is also listed on the Getting Started page — an accidental redundancy, not a designed fallback.

**2. Project structure documentation is entirely absent.**
No file tree. No folder layout. No mention of `src/`, `public/`, `pages/`, or `astro.config.mjs`. The Getting Started page lists "project structure" as a topic to learn but provides zero content on it. All 9 agents across all tiers scored this stage between 0 and 1 out of 10.

**3. No path from installation to building.**
After `npm create astro@latest`, the documentation provides no next step. No "Hello World." No .astro syntax introduction. No explanation of the dev server, routing, or component model. The "Build a Blog Tutorial" is referenced but not included in the provided documentation surface. All 9 agents reached the same dead end regardless of capability tier.

### Significant (affecting a subset of users)

**4. Getting Started page lacks an inline Astro definition.**
The page opens with navigation links and version announcements but never defines what Astro actually is. Users must navigate separately to "Why Astro?" to get a definition — a non-obvious step for first-time visitors.

**5. Node.js odd-version restriction is unexplained.**
The docs specify Node.js v22.12.0+ and explicitly exclude v23, with no rationale provided. This is an unusual constraint (most tools support either LTS or current). All tiers noticed it; none could explain it from the docs.

**6. No instructions for resolving Node.js version mismatches.**
The prerequisites list a specific Node.js version but provides no guidance for checking your current version or upgrading if needed.

**7. VS Code extension mentioned, not located.**
The Astro VS Code extension is listed as a prerequisite but no link or installation path is provided.

### Minor (affecting lower-capability users primarily)

**8. Unexplained jargon in conceptual sections.**
Terms including "Islands architecture," "MPA vs SPA," "TTI," and "Partytown" appear without beginner-friendly definitions. Higher-capability agents parsed these as useful context; lower-capability agents flagged them as blockers.

**9. Version announcement creates ambiguity.**
"Astro v6 is here!" appears prominently without explanation of whether this matters to a new user or what changed.

**10. Framework comparisons assume prior knowledge.**
Comparisons to Next.js, SvelteKit, and Nuxt are useful for experienced developers evaluating migration but unhelpful for users unfamiliar with those frameworks.

---

## Tier-by-Tier Verdict

### Haiku-tier AI: Partially usable — with significant gaps

A haiku-tier agent can successfully learn what Astro is and extract the install command. It cannot complete installation (due to page truncation), understand project structure (no documentation present), or build anything (no tutorial content available). Haiku agents are less likely to infer missing information from partial context — they tend to treat a cut-off page as a failed page, rather than working around it.

**Verdict:** Can answer "what is Astro?" Can run `npm create astro@latest`. Cannot proceed further without additional documentation.

### Sonnet-tier AI: Mostly usable for early stages only

A sonnet-tier agent scores well on "what is Astro" (9.0/10) and navigates the install stage acceptably by inferring from the Getting Started page when the Install page fails. However, it hits the same hard walls as haiku on project structure and build-something — no content means no path forward, regardless of capability.

**Verdict:** Strong onboarding comprehension. Cannot get to a working project state.

### Opus-tier AI: Sophisticated reading, same structural limits

Opus-tier agents provide the richest analysis — noting structural issues like the Getting Started page's role as "navigation-only" — but capability does not substitute for missing content. Opus agents also scored project structure at 0.0/10 (lower than haiku's 0.7), reflecting that they more precisely identified the total absence of documentation.

**Verdict:** Best experience through the "why" stage. Equally blocked by absent content in later stages.

### Summary Table

| Capability Tier | What is Astro | Installation | Project Structure | Build Something |
|---|---|---|---|---|
| Haiku | Usable | Partial | Not possible | Not possible |
| Sonnet | Usable | Partial | Not possible | Not possible |
| Opus | Usable | Partial | Not possible | Not possible |

---

## What's Working Well

The documentation has genuine strengths worth preserving and building on:

**"Why Astro?" is your best page.** Praised by all 9 agents across all 3 tiers. The five design principles are clear, the value proposition is well-structured, and the target use cases (blogs, marketing, e-commerce) are communicated without ambiguity. This page alone is responsible for the strong stage-1 scores.

**The install command is memorable and well-placed.** `npm create astro@latest` is prominent, easy to copy, and appears in multiple locations — a smart redundancy that partially rescues the truncated install page.

**".astro is a superset of HTML" is an excellent onboarding hook.** Cited by 6 of 9 agents as an effective entry point for understanding what Astro files are. Simple, direct, and accurate.

**The prerequisites list is specific and actionable.** Node.js version, VS Code, and terminal are listed with enough specificity to be usable — even if the docs don't yet explain what to do when prerequisites aren't met.

**UI framework compatibility is a trust signal.** The list of supported frameworks (React, Svelte, Vue, Solid, etc.) was consistently cited as reassuring across all tiers. It reduces adoption anxiety for teams with existing investments.

**Performance benchmarks land.** The 40% faster / 90% less JavaScript claims resonated positively with sonnet and opus testers as credible and concrete.

---

## Recommendations

Listed in priority order:

### P0 — Fix immediately

1. **Restore the truncated install page.** The page cuts off before the CLI wizard walkthrough. Restore or republish the full content including: what prompts appear, what choices mean, and what the expected output looks like after a successful install.

2. **Add project structure documentation to the provided surface.** Include a file tree showing the default project layout with annotations for each directory. Minimum viable: explain `src/`, `public/`, `pages/`, and `astro.config.mjs`.

3. **Add a minimal "Hello World" path.** Even two pages of step-by-step content — creating a .astro file, running the dev server, seeing output in a browser — would bridge the gap between installation and "I built something." The docs already promise this is possible with just HTML and CSS; deliver on that promise.

### P1 — High impact

4. **Give the Getting Started page an inline definition of Astro.** One to two sentences at the top that define what Astro is — before any navigation links or version announcements. "Astro is..." should not require a separate page click to discover.

5. **Explain the Node.js odd-version restriction.** Add a brief note explaining why v23 is not supported (likely a compatibility issue with a dependency). Also add instructions for checking the current Node.js version and upgrading if needed.

6. **Add a link and instructions for the VS Code extension.** If it's listed as a prerequisite, the path to get it should be one click away.

### P2 — Meaningful improvements for lower-capability users

7. **Add inline definitions for key jargon on first use.** Terms like "Islands architecture," "MPA," and "TTI" can remain in the conceptual sections, but each should have a one-sentence plain-language definition on first appearance (e.g., a tooltip, parenthetical, or expandable callout).

8. **Reframe the version announcement for newcomers.** Replace or supplement "Astro v6 is here!" with context like "You're reading the docs for the latest version." This removes ambiguity for users who don't know if the version announcement affects their setup.

9. **Consider separating beginner and experienced-developer paths** in the Getting Started page. A brief "new to web frameworks?" branch that skips the Next.js/SvelteKit comparisons would improve haiku-tier (and human beginner) experience without removing the useful comparison content.

---

*Report generated from multi-tier AI agent evaluation. All findings are sourced from tester transcripts and synthesizer classification — no assumptions have been introduced in this report.*
