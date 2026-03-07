# D-backs Ticket Draft Board

Reusable, real-time ticket draft board for your season package.

## What this includes

- `frontend/`: static app (public view + admin actions).
- `backend/`: AWS Lambda + API Gateway + DynamoDB + WebSocket template.
- `scripts/`: CSV-to-JSON import helper for annual refresh.
- `data/`: sample data and converted season files.

## Architecture

1. Public users open the frontend and view ticket status.
2. Frontend loads season tickets from `GET /tickets`.
3. Admin uses `x-admin-key` to call pick/unpick/import endpoints.
4. Backend writes DynamoDB and broadcasts updates over WebSocket.
5. Clients update without page refresh.

## Frontend config

Edit [frontend/config.js](C:\Users\LayneRichins\OneDrive - stotzeq.com\Documents\GitHub\laynerichins.github.io\dbacks-ticket-draft\frontend\config.js):

- `apiBaseUrl`: HTTP API base URL
- `wsUrl`: WebSocket URL
- `season`: current season (example `2026`)

## AWS backend deploy (CloudFormation package/deploy)

Prereqs: AWS CLI configured, Node.js 20+.

1. Install backend dependencies:

```powershell
cd dbacks-ticket-draft\backend
npm install
```

2. Create or reuse an artifact S3 bucket (replace values):

```powershell
$region = "us-west-2"
$account = (aws sts get-caller-identity | ConvertFrom-Json).Account
$bucket = "dbacks-ticket-draft-artifacts-$account-$region"
aws s3api create-bucket --bucket $bucket --region $region --create-bucket-configuration LocationConstraint=$region
```

3. Package and deploy:

```powershell
cd dbacks-ticket-draft\backend
aws cloudformation package --template-file template.yaml --s3-bucket $bucket --output-template-file packaged.yaml --region $region
aws cloudformation deploy --template-file packaged.yaml --stack-name dbacks-ticket-draft-prod --capabilities CAPABILITY_IAM --parameter-overrides AdminKey="YOUR_ADMIN_KEY" --region $region
```

4. Read outputs and update frontend config:

```powershell
aws cloudformation describe-stacks --stack-name dbacks-ticket-draft-prod --region $region
```

Use `HttpApiUrl` and `WebSocketUrl` output values.

## Importing season data

1. Convert CSV to app JSON:

```powershell
node scripts/csv-to-json.mjs "C:\path\to\schedule.csv" 2026 > data\2026-tickets.json
```

Optional defaults for all games:

```powershell
node scripts/csv-to-json.mjs "C:\path\to\schedule.csv" 2026 112 18 2 > data\2026-tickets.json
```

2. Import to backend:

```powershell
$api = "https://YOUR_API_ID.execute-api.us-west-2.amazonaws.com"
$adminKey = "YOUR_ADMIN_KEY"
$body = Get-Content -Raw .\data\2026-tickets.json
Invoke-RestMethod -Method Post -Uri "$api/admin/import" -Headers @{ "x-admin-key" = $adminKey } -ContentType "application/json" -Body $body
```

## Supported CSV formats

- Legacy sheet format: `date/gameDate`, `time/gameTime`, `opponent`, optional `section`, `row`, `seats`, `notes`
- Schedule export format: `START DATE`, `START TIME`, `SUBJECT`, `LOCATION`

For schedule export, opponent is derived from `SUBJECT` (example: `Tigers at D-backs`).

## Security note

This starter uses a shared admin header key for speed (no user login).
For stronger security later, switch to signed admin links or Cognito auth.