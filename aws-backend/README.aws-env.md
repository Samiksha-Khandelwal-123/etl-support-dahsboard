This repo includes a helper script to refresh temporary AWS credentials and update `aws-backend/.env`.

Usage

- Refresh using default profile and default duration (3600s):

  `bash scripts/refresh-aws-env.sh`

- Refresh for a specific profile:

  `bash scripts/refresh-aws-env.sh --profile myprofile`

- Assume a role (recommended when you have an assumable role):

  `bash scripts/refresh-aws-env.sh --role-arn arn:aws:iam::123456789012:role/MyRole --profile myprofile --duration 3600`

Notes

- Requires the AWS CLI and `jq` installed.
- The script replaces the `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` lines in `aws-backend/.env`.
- Prefer using IAM roles / IRSA / task roles in production; this helper is for local/dev convenience.
