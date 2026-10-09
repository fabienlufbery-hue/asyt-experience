# ASYT Experience

A separate, bilingual B2B voice experience for ASYT, using Google's **Gemini 3.8 Live** API.

## Setup

1. Run `npm install` with Node 22+.
2. Add `GEMINI_API_KEY` to a local `.env` file (never commit secrets).
3. Run `npm run dev` and open http://localhost:3000.
4. Run `npm run check` for typechecking and frontend build.
5. Deploy as a **single web service** on Render; `npm run build` then `npm start`.
6. Add `GEMINI_API_KEY` to the Render environment, as a secret. The web voice is disabled until a key is configured.

### Privacy and accuracy

The demo itself uses **Google Gemini cloud processing**; ASYT's **local/offline software offering** is separate. Microphone recording begins only after an explicit click. This application does not persist submitted conversations or prospects to a database. Sharing a qualification summary happens only if the visitor copies it, downloads it, or chooses to share it. The live API is public; enable Gemini API usage quotas and monitor costs before sharing the site widely.

### Security

No Gemini key is compiled into the frontend. Request and WebSocket payload limits, Origin checking, connection caps and per-IP rate limiting are used as layers of protection, **not** as full authentication. Use provider-side spending limits and external abuse protection for wider launch.

### Operational note

Free Render instances may spin down after inactivity and incur cold-start latency. Model availability depends on account permissions and Gemini quotas; an HTTP health response does not prove a successful paid model call.
