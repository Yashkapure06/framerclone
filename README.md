# SiteForge

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Open Source](https://img.shields.io/badge/open%20source-yes-brightgreen)](https://github.com/Yashkapure06/website-extractor)

SiteForge is an open source app for analyzing public websites and exporting them into production-ready output formats. It crawls, validates, previews, and rebuilds sites as clean HTML/CSS/JS, React, or Next.js.

## What It Does

- Extracts public websites into structured output
- Detects and rebuilds site sections and dependencies
- Provides previews, validation, and downloadable exports
- Supports AI-assisted cleanup and framework generation
- Focuses on website-to-code workflows for builders, agencies, and developers

## Supported Outputs

- Plain HTML, CSS, and JavaScript
- React
- Next.js

## Quick Start

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Environment Setup

1. Copy `.env.example` to `.env.local`
2. Add one or more AI provider keys
3. Set `AI_PROVIDER_ORDER` to choose the fallback chain

## AI Routes

- `GET /api/ai/providers`
- `POST /api/ai/generate`
- `POST /api/ai/framework-build`
- `POST /api/ai/framework-files`

Example request body:

```json
{
  "system": "You clean extracted HTML into production-ready React.",
  "prompt": "Convert this landing page into reusable React components.",
  "provider": "openrouter"
}
```

If the selected provider fails, the server falls back to the next configured provider in `AI_PROVIDER_ORDER`.

## Core API

- `POST /api/scan`
- `POST /api/extract`
- `GET /api/jobs/:id`
- `GET /api/preview/:id`
- `GET /api/validate/:id`
- `GET /api/download/:id`

## Repository Structure

- `src/pages` application routes and API handlers
- `src/lib` extraction, conversion, and AI helpers
- `src/components` UI and layout components
- `public` static assets

## Open Source Files

- [LICENSE](LICENSE)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md)

## Contributing

This project is meant to be built in the open. If you want to help, start by running the app locally, testing a workflow end to end, and sharing what you found. Based on those outcomes, open an issue or raise a pull request so we can improve it together as a community.

Suggested contribution flow:

1. Pick an issue or an area you want to improve.
2. Run the project locally and test the relevant path.
3. Share the result, including what worked and what still needs attention.
4. Open a pull request with the fix, improvement, or documentation update.

Please also read [CONTRIBUTING.md](CONTRIBUTING.md) before sending changes.

## Security

If you find a vulnerability, follow the process in [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

MIT. See [LICENSE](LICENSE).
