## ADDED Requirements

### Requirement: README code blocks must be properly fenced

The README.md document SHALL have all code blocks properly enclosed with opening and closing fence markers (```) to ensure correct markdown rendering.

#### Scenario: ASCII art diagrams are properly formatted

- **WHEN** the README.md is rendered on GitHub or other markdown viewers
- **THEN** all ASCII art workflow diagrams SHALL display correctly within code blocks

#### Scenario: Code fence markers are balanced

- **WHEN** a code block is opened with ```
- **THEN** it SHALL have a corresponding closing ```
