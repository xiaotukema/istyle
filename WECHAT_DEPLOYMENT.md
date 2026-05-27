# WeChat Mini Program Deployment Plan

## 1. Recommended Backend: WeChat CloudBase Run

Use WeChat CloudBase Run / 微信云托管 for the Node backend. This keeps the
current `server.js` shape, lets the mini program call the backend through
`wx.cloud.callContainer`, and avoids configuring a separate request legal domain
in the mini program console.

Required environment variables:

```text
GEMINI_API_KEY=...
IMAGE_PROVIDER=gemini
ANALYSIS_PROVIDER=gemini
GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview
ANALYSIS_MODEL=gemini-2.5-pro
DAILY_HAIR_LIMIT=11
HAIR_VARIANT_CONCURRENCY=1
```

When running through CloudBase Run, the backend reads the WeChat openid from
the cloud container request header. `WX_APPID` and `WX_APP_SECRET` are only
needed for the local HTTPS backend fallback that uses `wx.login` and
`/api/auth/wechat-login`.

Before real launch, replace the current in-memory quota storage with persistent
storage.

Recommended tables/keys:

- `users`: `openid`, `created_at`
- `daily_generation_usage`: `openid`, `date`, `used_count`

## 2. Mini Program

Open `miniprogram/` in WeChat DevTools.

Update:

- `miniprogram/project.config.json`: AppID is set to the real mini program AppID.
- `miniprogram/app.js`: `cloudEnv` is set to `prod-d3gvnehwy4403676a`.
- `miniprogram/app.js`: `cloudService` is set to `express-9jah`.
- Keep `useCloudContainer: true` for production.

For local backend debugging, set `useCloudContainer: false` and keep `apiBase`
pointing at `http://127.0.0.1:8000`.

## 3. WeChat Console / CloudBase

- Enable CloudBase / 云开发 for the mini program.
- Create a CloudBase Run service for this Node project.
- Configure the environment variables listed above.
- Enable camera permission description.
- Upload code through WeChat DevTools.
- Submit for review.

Suggested CloudBase Run settings:

- Public access: on during debugging, can be turned off after mini program
  `callContainer` is verified.
- Internal access: off for now.
- CPU / memory: 1 core / 2 GB.
- Instances: min 0, max 5.
- Scaling: CPU >= 80%, memory >= 80%.
- Log path: stdout.
- Pipeline code source: GitHub.
- Repository: `xiaotukema/istyle`.
- Branch: `main`.
- Target directory: empty or `/`.
- Port: `80`.
- Dockerfile: enabled.
- Dockerfile name: `Dockerfile`.

## 4. Product Quota Rule

Per user per day:

- First recommendation: 5 hairstyles.
- More recommendation 1: 3 hairstyles.
- More recommendation 2: 3 hairstyles.
- Total: 11 hairstyles.

After 11 generated hairstyles, show:

```text
您的今日生成次数已达上限，请明天再来试试吧
```
