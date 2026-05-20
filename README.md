# World Foresight Forum

A global public foresight and policy forum for possible futures.

People write time-capsule posts about the futures they think are coming, attach a target year and country, then read, search, vote, and discuss the public forecasts other people are willing to name.

Production path: `https://thetrustcommons.com/wff/`

## Core Features

- Future-dated posts with a time slider.
- Country tagging, including a `Global` option.
- Generated public names with private login names.
- Guest reader mode.
- Semantic search, voting, and year filtering.
- Message requests, accepted private conversations, registered-user chatroom, and PWA notifications.
- Policy proposal extraction for education, economy, environment, health, and governance.

## Local Development

Backend:

```bash
cd backend
python app.py
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Production build:

```bash
cd frontend
npm install
npm run build
```

SQLite database: `backend/wff.db`.
