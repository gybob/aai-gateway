## Context

The README.md document contains ASCII art diagrams to illustrate the workflow of the AAI Gateway. Currently, these diagrams are missing the opening code fence (```), while having a closing fence on line 70. This causes the markdown to render incorrectly on GitHub and other viewers.

**Current State (lines 29-70):**

````markdown
## How It Works

┌─────────────────────────────────────────────────────────────────┐
│ Desktop App Workflow │
...
└─────────────────────────────────────────────────────────────────┘

```<-- Only closing fence exists

```
````

## Goals / Non-Goals

**Goals:**

- Fix code block syntax for all ASCII diagrams
- Ensure consistent markdown rendering across all viewers
- Maintain the visual structure and content of the diagrams

**Non-Goals:**

- Redesigning the diagrams or changing their content
- Adding new sections or modifying existing text content
- Changing any code functionality

## Decisions

1. **Add opening code fence before Desktop App Workflow diagram**
   - Rationale: The closing fence exists at line 70, so we need a matching opening fence
   - Alternative considered: Remove the closing fence and use no code blocks - rejected because code blocks improve readability and preserve ASCII art alignment

2. **Verify both workflow diagrams are properly fenced**
   - Desktop App Workflow (lines 31-52)
   - Web App Workflow (lines 54-69)
   - Both should be inside the same code block for context

## Risks / Trade-offs

**No significant risks** - This is a documentation-only change with no code impact.
