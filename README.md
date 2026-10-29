# BuildLens

An early engineering workspace prototype for exploring building concepts in a navigable 3D viewport, organizing project documents, and discussing engineering information with Meta Model API.

## Project structure

```text
Build-Lens/
├── api/
│   └── ai.js
├── src/
│   ├── components/
│   │   ├── Viewport.jsx
│   │   ├── ModelControls.jsx
│   │   ├── EngineeringPanel.jsx
│   │   └── AssumptionPanel.jsx
│   ├── services/
│   │   └── ai.js
│   ├── three/
│   │   ├── BuildingModel.js
│   │   └── ModelViews.js
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── vercel.json
└── README.md
```

## Current prototype

- React + Vite, plain JavaScript.
- Procedural Three.js sample building with Building, Structure, Foundation and Reinforcement views.
- Responsive dark workspace for desktop and mobile.
- Local workspace metadata/chat persistence and JSON export.
- Server-side API proxy using `MODEL_API_KEY`.
- Explicit labels distinguishing sample geometry and assumptions from verified engineering information.

## Not implemented yet

This is a scaffold, not a validated engineering tool. File selection currently stores file names and metadata in browser storage; it does **not** parse PDFs, read CAD geometry, extract drawing dimensions, or send document contents to the model. The displayed building is illustrative demo geometry and is not derived from submitted drawings. Structural calculations and code checks are not implemented. The UI and API proxy need testing before relying on them.

## Run locally

Requires Node.js 20 or a compatible recent Node.js release.

```bash
npm install
npm run dev
```

The AI endpoint is a Vercel serverless function in `api/ai.js`. Vite's development server does not automatically run Vercel functions; use Vercel's local development tooling to test `/api/ai` locally, or deploy a preview.

## Meta Model API key

1. Create a Model API key in Meta's developer dashboard.
2. In Vercel, open the BuildLens project → Settings → Environment Variables.
3. Add `MODEL_API_KEY` with your secret key for the environments you need.
4. Redeploy after changing environment variables.

Never put the key in React code or a variable prefixed with `VITE_`. Never commit a real key to GitHub. The `.env.example` file is only a placeholder.

The server proxy uses Meta's OpenAI-compatible Chat Completions endpoint and `muse-spark-1.3`. Confirm the current account's API access, quotas and billing before use. Basic input checks are present, but durable rate limiting and abuse prevention are not yet implemented.

## Engineering safety

BuildLens must keep source-supported facts, inferred information, assumptions and unverified results distinct. A language model's opinion is not a structural calculation. Any real structural assessment needs adequate inputs, applicable design codes, validated calculation logic, and review by a qualified engineer. This prototype does not determine whether a building is safe.

## Stack

- React
- Vite
- Three.js
- Lucide React
- Vercel Functions
- Meta Model API

## Official Meta API documentation

- [Meta Model API overview](https://dev.meta.ai/docs/overview)
- [Chat Completions quickstart](https://dev.meta.ai/docs/cookbook/quickstart-chat-completions)
- [Chat Completions API reference](https://dev.meta.ai/docs/protocols/chat-completions)