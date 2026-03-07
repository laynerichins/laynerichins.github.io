# D-backs Ticket Draft Board

Realtime ticket draft board with separate public viewer and admin console.

## Pages

- Public viewer: `frontend/index.html`
- Admin console: `frontend/admin.html`

## Features

- Realtime updates via WebSocket
- Filters: status, month, weekend-only, team selection
- View modes: calendar and list
- Recent picks sidebar
- Draft clock (on-the-clock / up-next) from pick order file
- Admin actions (pick/unpick) only on `admin.html`

## Frontend config

Edit `frontend/config.js`:

- `apiBaseUrl`: HTTP API URL
- `wsUrl`: WebSocket URL
- `season`: active season year
- `adminHeaderName`: usually `x-admin-key`
- `pickOrderUrl`: optional path to pick order JSON

## Data files

- Season tickets: `data/2026-tickets.json`
- Pick order: `data/pick-order-2026.json`

Pick order format:

```json
{
  "mode": "linear",
  "order": ["Person 1", "Person 2", "Person 3"]
}
```

The app computes on-the-clock from `pickedCount % order.length`.

## Backend deploy (CloudFormation package/deploy)

1. Install dependencies:

```powershell
cd dbacks-ticket-draft\backend
npm install
```

2. Package/deploy:

```powershell
$region = "us-west-2"
$account = (aws sts get-caller-identity | ConvertFrom-Json).Account
$bucket = "dbacks-ticket-draft-artifacts-$account-$region"

aws s3api create-bucket --bucket $bucket --region $region --create-bucket-configuration LocationConstraint=$region
aws cloudformation package --template-file template.yaml --s3-bucket $bucket --output-template-file packaged.yaml --region $region
aws cloudformation deploy --template-file packaged.yaml --stack-name dbacks-ticket-draft-prod --capabilities CAPABILITY_IAM --parameter-overrides AdminKey="YOUR_ADMIN_KEY" --region $region
```

3. Import tickets:

```powershell
$api = "https://YOUR_API_ID.execute-api.us-west-2.amazonaws.com"
$adminKey = "YOUR_ADMIN_KEY"
$body = Get-Content -Raw .\data\2026-tickets.json
Invoke-RestMethod -Method Post -Uri "$api/admin/import" -Headers @{ "x-admin-key" = $adminKey } -ContentType "application/json" -Body $body
```

## CSV conversion

Convert schedule CSV to app JSON:

```powershell
node scripts/csv-to-json.mjs "C:\path\to\schedule.csv" 2026 > data\2026-tickets.json
```

Optional default seat fields:

```powershell
node scripts/csv-to-json.mjs "C:\path\to\schedule.csv" 2026 112 18 2 > data\2026-tickets.json
```

## Security note

Admin actions are protected by shared `x-admin-key`. If you suspect key exposure, rotate by redeploying stack with a new `AdminKey` parameter.