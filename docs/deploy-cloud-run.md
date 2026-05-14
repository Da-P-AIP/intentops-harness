# Deploy to Cloud Run

IntentOps Harness can run on Cloud Run as a small Node.js service.

## 1. Prepare Google Cloud

Use Cloud Shell or a terminal with the Google Cloud CLI installed.

```powershell
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

## 2. Deploy

Run this from the repository root:

```powershell
gcloud run deploy intentops-harness `
  --source . `
  --region asia-northeast1 `
  --allow-unauthenticated `
  --set-env-vars GEMINI_API_KEY=YOUR_GEMINI_API_KEY,GEMINI_MODEL=gemini-2.5-flash
```

Cloud Run will print a service URL such as:

```text
https://intentops-harness-xxxxx-an.a.run.app
```

Use that URL for the hackathon field named "deployed work URL".

## Notes

- Do not commit `.env`.
- Cloud Run injects the `PORT` environment variable automatically.
- Generated artifacts are saved inside the running container and are suitable for demo download/open flows, but they are not persistent storage.
- Keep the Cloud Run service available until the review period ends.
