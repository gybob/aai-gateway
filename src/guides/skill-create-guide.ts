/**
 * Skill Creation Guide Generator
 * 
 * Generates guidance for agents to create AAI Gateway compatible skills.
 */

const TEMPLATE_SKILL_CREATE_GUIDE = `# Skill Creation Guide

Use this tool to guide the creation of AAI Gateway compatible skills.

## When to Use

Call this tool when the user wants to:
- Package a workflow or process as a reusable skill
- Create a skill from a multi-turn conversation
- Define a new capability for AAI Gateway

## Skill Structure

A skill is a directory with at minimum:

\`\`\`
skill-name/
├── SKILL.md          # Required: Skill definition and instructions
└── scripts/          # Optional: Helper scripts
    └── helper.sh     # Optional: Supporting scripts
\`\`\`

## SKILL.md Format

\`\`\`markdown
# Skill Name

## Summary
One paragraph describing when to use this skill.

## Instructions
Detailed step-by-step instructions for executing the skill.

## Input
Description of required inputs or parameters.

## Output
Description of expected outputs or results.
\`\`\`

## Examples

### Example 1: Simple Instruction Skill

\`\`\`markdown
# Code Review

## Summary
Perform a comprehensive code review of a codebase, checking for bugs, performance issues, and best practice violations.

## Instructions
1. Read all source files in the given directory
2. Analyze code structure and identify potential issues
3. Provide a detailed report of findings
4. Suggest improvements for each issue found

## Input
- Directory path to review
- Optional: Focus areas (security, performance, style)

## Output
- Summary of findings
- List of issues with severity levels
- Recommendations for fixes
\`\`\`

### Example 2: Script-Based Skill

\`\`\`markdown
# Git Operations

## Summary
Execute common git operations with safety checks and best practices.

## Instructions
1. Parse the user's git request
2. Execute the git command via the scripts/git-operation.sh helper
3. Validate the result
4. Provide clear output to user

## Helper Scripts
- \`scripts/git-operation.sh\` - Safe git command wrapper
\`\`\`

## Best Practices

1. **Clear Summary** - Write a concise summary that helps agents decide when to use this skill
2. **Step-by-Step Instructions** - Break down complex tasks into clear numbered steps
3. **Define Inputs/Outputs** - Make it clear what the skill expects and produces
4. **Idempotent When Possible** - Skills should be safe to run multiple times
5. **Error Handling** - Include error handling guidance in instructions

## Next Steps

1. Create the skill directory structure
2. Write SKILL.md with clear instructions
3. Add any helper scripts if needed
4. Use \`skill:import\` to import the skill into AAI Gateway`;

export function generateSkillCreateGuide(): string {
  return TEMPLATE_SKILL_CREATE_GUIDE;
}
