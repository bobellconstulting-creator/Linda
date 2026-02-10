# Linda

Linda is an autonomous Senior Developer Assistant designed to run on Vercel or Netlify as a GitHub App webhook handler. She reads GitHub events, decides whether to fix code or generate new agents, logs activity to Google Sheets, reads Google Docs for context, and can search the web for documentation.

## Project Structure

```
.
├── package.json
├── tsconfig.json
├── src
│   ├── index.ts
│   ├── agent
│   │   └── linda.ts
│   └── utils
│       └── googleClient.ts
```

## Setup

### Quick Start (kid-friendly)

Think of Linda like a robot helper that wakes up when GitHub sends a message. To make her work, we have to give her a few keys, then turn her on.

1. **Get the code**

   ```bash
   git clone <your-repo-url>
   cd Linda
   ```

2. **Install her tools**

   ```bash
   npm install
   ```

3. **Give her keys (environment variables)**

   Create a file named `.env` in this folder and copy in the variables from the section below. These are like passwords Linda needs.

4. **Run her locally (for testing)**

   ```bash
   npm run build
   node dist/index.js
   ```

   > Note: Linda listens for GitHub webhooks. To test locally, you’ll need a tool like the GitHub CLI or a tunneling tool (like ngrok) so GitHub can reach your computer.

5. **Put her online**

   Deploy to Vercel or Netlify (steps below). Once she’s online, set your GitHub App webhook URL to her address.

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables

Create a `.env` file (or set in Vercel/Netlify):

```
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4o-mini
GITHUB_WEBHOOK_SECRET=your_webhook_secret
GITHUB_TOKEN=your_github_app_or_pat
GITHUB_OWNER=your_github_org_or_user
GOOGLE_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_ID=your_sheet_id
GOOGLE_SHEETS_RANGE=Logs!A:D
TAVILY_API_KEY=your_tavily_key
```

### 3) Set up the GitHub App

1. Create a GitHub App in your organization or user settings.
2. Set the webhook URL to your deployed `/api` endpoint (Vercel) or `/.netlify/functions` endpoint.
3. Generate and save a webhook secret; set `GITHUB_WEBHOOK_SECRET`.
4. Grant permissions: `Contents`, `Pull requests`, `Issues`, and `Metadata` (read/write as needed).
5. Subscribe to events: `push`, `issues`, `issue_comment`, `pull_request`.
6. Install the App on the repositories you want Linda to manage.
7. Use the App installation token or a Personal Access Token as `GITHUB_TOKEN` for API calls.

### 4) Google Cloud Service Account

1. Create a Google Cloud project and enable the **Google Sheets API** and **Google Docs API**.
2. Create a service account and download the JSON key.
3. Set `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` from the JSON key.
4. Share the target Google Sheet and Doc with the service account email.

### 5) Deploy to Vercel

1. Move `src/index.ts` to `api/index.ts` (or add a build step that outputs to `api` for Vercel).
2. In Vercel, set the build command to `npm run build` and output to `dist` if using the compiled files.
3. Ensure the webhook URL in GitHub points to `https://your-vercel-app.vercel.app/api`.

### 6) Deploy to Netlify

1. Configure a Netlify function that imports `src/index.ts`.
2. Set environment variables in Netlify.
3. Point GitHub webhooks to `https://your-site.netlify.app/.netlify/functions/linda`.

## Core Agent Logic

The main logic lives in `src/agent/linda.ts` and defines:

- **System prompt**: Linda’s Senior Developer persona.
- **Tools**:
  - `writeToGoogleSheet`
  - `readGoogleDoc`
  - `searchInternet`
  - `commitFileToGitHub`
- **Decision making**: Determines whether a webhook event indicates a code fix/feature vs. a new agent request.
- **Recursive agent creation**: If the event text includes “build an agent” or “generate a new agent,” Linda creates a new repository and commits a scaffold to it.

## Usage Notes

- Ensure the webhook secret is configured, otherwise requests are rejected.
- The agent logs every event to Google Sheets if `GOOGLE_SHEETS_ID` is set.
- The search tool uses Tavily by default; replace it with another search provider if desired.
