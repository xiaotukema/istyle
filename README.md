# iStyle Hair Try-On

Camera-based AI hairstyle recommendation and try-on prototype, with a WeChat Mini Program version scaffold.

## Features

- Gemini-powered hairstyle analysis and image try-on.
- Identity lock prompt: only change hairstyle, preserve the user's face and recognizability.
- First run generates 5 hairstyles, then two "more recommendations" batches of 3 each.
- Daily quota control: 11 generated hairstyles per user per day.
- WeChat Mini Program login scaffold using `wx.login` and backend token sessions.

## Local Web

```bash
cp .env.example .env
# Fill GEMINI_API_KEY and optional WeChat credentials.
npm start
```

Open:

```text
http://127.0.0.1:8000/
```

## WeChat Mini Program

The Mini Program source is in `miniprogram/`.

For local development, open `miniprogram/` in WeChat DevTools. The backend supports dev login without `WX_APPID/WX_APP_SECRET`, but production must configure real credentials.

Production requirements:

- HTTPS backend domain.
- The domain must be added to WeChat Mini Program legal request domains.
- Set `WX_APPID` and `WX_APP_SECRET` on the backend.
- Set `GEMINI_API_KEY` on the backend.
- Persist quota data in a real database before production traffic.

## Cost Control

The backend exposes:

- `POST /api/auth/wechat-login`
- `GET /api/quota`
- `POST /api/hair-recommendation`
- `POST /api/hair-tryon`

When a request includes `Authorization: Bearer <token>`, `/api/hair-tryon` consumes daily quota. Default limit is `11` hairstyles per user per day. After the limit is reached, the API returns:

```text
您的今日生成次数已达上限，请明天再来试试吧
```

Current in-memory quota is suitable for local/dev only. For online production, replace `quotaByUserDay` and `authSessions` in `server.js` with Redis/Postgres/CloudBase.

## Notes

Do not commit `.env` or API keys. Use `.env.example` for configuration shape only.
