# BuildLens

An early engineering workspace prototype for exploring building concepts in a navigable 3D viewport, organizing project documents, and discussing supplied material with Meta Model API.

## Current functionality
- React + Vite, plain JavaScript; Three.js illustrative building model.
- Building, Structure, Foundation and Reinforcement views. Reinforcement view displays illustrative slab mesh and column bars; this is not a design detail.
- Pointer orbit, mouse-wheel zoom and two-finger pinch zoom.
- PDF selectable-text extraction, DOCX text extraction, TXT/MD/CSV/JSON/XML text, and JPG/PNG/WEBP image attachments to the assistant.
- New chat control; project files remain available when a new conversation is started.
- Local workspace metadata/chat persistence and JSON export.
- Server-side Meta Model API proxy using `META_API_KEY`.

## File support limitations
PDF text is extracted in the browser (up to 35 pages); scanned/image-only PDFs need OCR or page images. DOCX is text-extracted. Images are sent as image inputs. CAD/DWG/DXF, XLSX and legacy DOC files are not parsed yet. Attachments are sent when the user presses Send; files are not uploaded to permanent cloud storage. The sample 3D building is not generated from uploaded plans.

## Meta API key setup
In Vercel Project Settings → Environment Variables, set `META_API_KEY` for Production and Preview, then redeploy. Keep it server-side; never add a `VITE_` prefix or commit the real key. `.env.example` contains only a placeholder.

The proxy calls Meta's OpenAI-compatible Chat Completions endpoint with `muse-spark-1.3`. Confirm API access and multimodal support for the selected model/account.

## Run locally
Requires a recent Node.js release.

```bash
npm install
npm run dev
```

The Vercel serverless endpoint requires Vercel local development tooling or a deployed preview.

## Engineering safety
The model and reinforcement are illustrative only. Uploaded drawings are not converted into a verified structural model. AI output is not a structural calculation or safety certification. Engineering conclusions require adequate inputs, applicable code checks, validated calculations and qualified engineering review.
