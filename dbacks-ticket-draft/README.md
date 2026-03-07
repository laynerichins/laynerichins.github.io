# D-backs Ticket Draft Board

Realtime ticket draft board with a public viewer and a separate admin page.

## Pages

- Public viewer: `frontend/index.html`
- Admin console: `frontend/admin.html`

The public page is view-only. Admin actions (pick/unpick, create season, import data, rotate admin key) are only on the admin page.

## Core Features

- Live updates via WebSocket
- Calendar view and list view
- Filters: status, picked by, month, weekend-only, teams
- Recent picks sidebar
- Draft clock (on the clock / up next)
- Total draft order display
- Admin auto-assigns picks to the current person on the clock
- Admin key rotation from admin UI

## New Season Workflow (Admin)

On `admin.html`:

1. Enter and save current admin key.
2. In **Create New Season**:
   - `New season` (example: `2027`)
   - Upload `Schedule CSV`
   - Enter participants in textarea (`Name,Count`) or upload `Participants CSV`
   - Optional `Seed`
3. Click **Preview Order** to generate randomized snake order.
4. Click **Create Season** to:
   - import schedule to `/admin/import`
   - save draft config to `/admin/draft-config`

Validation:

- Sum of participant ticket counts must equal number of games in the schedule CSV.

## Admin Key Rotation

Use the admin panel to rotate the key:

1. Save current admin key session.
2. Enter new key (`8+` chars).
3. Click **Rotate Admin Key**.

The new key is stored server-side as a SHA-256 hash. The CloudFormation `AdminKey` parameter remains a bootstrap recovery key.

## Draft Order Format

Draft config is stored per season in DynamoDB (`ticketId: _DRAFT_CONFIG`) and returned by `GET /draft-config`:

```json
{
  "mode": "snake-quotas",
  "seed": "2027-dbacks",
  "participants": [{ "name": "Layne", "tickets": 13 }],
  "baseOrder": ["Layne"],
  "sequence": ["Layne"]
}
```

If API draft config is missing, frontend falls back to `data/pick-order-<season>.json`.

## Frontend Config

Edit `frontend/config.js`:

- `apiBaseUrl`: HTTP API base URL
- `wsUrl`: WebSocket URL
- `season`: default season
- `adminHeaderName`: usually `x-admin-key`
- `pickOrderUrl`: optional local fallback path

## CSV Conversion Script

Convert schedule CSV to JSON (optional helper script):

```powershell
node scripts/csv-to-json.mjs "C:\path\to\schedule.csv" 2026 > data\2026-tickets.json
```

## Backend API

- `GET /tickets?season=2026`
- `GET /draft-config?season=2026`
- `POST /admin/pick`
- `POST /admin/unpick`
- `POST /admin/import`
- `POST /admin/draft-config`
- `POST /admin/rotate-key`

Admin endpoints require header `x-admin-key`.

## Deploy Backend (CloudFormation package/deploy)

```powershell
cd dbacks-ticket-draft\backend
npm install

$region = "us-west-2"
$account = (aws sts get-caller-identity | ConvertFrom-Json).Account
$bucket = "dbacks-ticket-draft-artifacts-$account-$region"

aws s3api create-bucket --bucket $bucket --region $region --create-bucket-configuration LocationConstraint=$region
aws cloudformation package --template-file template.yaml --s3-bucket $bucket --output-template-file packaged.yaml --region $region
aws cloudformation deploy --template-file packaged.yaml --stack-name dbacks-ticket-draft-prod --capabilities CAPABILITY_IAM --parameter-overrides AdminKey="YOUR_ADMIN_KEY" --region $region
```

## Security Note

If admin key is exposed, rotate it in the admin UI immediately. If needed, redeploy with a new CloudFormation `AdminKey` bootstrap value.
