# Reverse Engineer GitHub Repository

Analyze and reverse engineer any GitHub repository to understand its structure, dependencies, architecture, and purpose.

## Usage

```
/reverse-engineer <github-url>
```

## What it does

- 📁 Analyzes repository structure and file organization
- 📦 Detects dependencies (npm, Python, Go, etc.)
- 🔤 Identifies programming languages used
- 📖 Extracts README and documentation
- 🔍 Generates insights about the project
- 📊 Creates a detailed JSON report

## Examples

```
/reverse-engineer https://github.com/vercel/next.js
/reverse-engineer https://github.com/torvalds/linux
/reverse-engineer https://github.com/facebook/react
```

## Output

Generates `{repo-name}-analysis.json` with:
- Project structure
- Dependencies breakdown
- Language statistics
- CI/CD detection
- Testing framework detection
- Docker support detection
- Monorepo detection

## Features

✅ One-line cloning and analysis
✅ Detects project type (monorepo, microservices, etc.)
✅ Extracts all dependencies
✅ Identifies tech stack
✅ Finds configuration files
✅ Comprehensive JSON report
