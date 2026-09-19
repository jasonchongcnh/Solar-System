# Solar-System

GitHub Pages dashboard for the smart floating solar power system.

## Files

- `management-console.html` - main management console page
- `assets/css/management-console.css` - console styling
- `assets/js/management-console.js` - console behavior
- `assets/js/management-console-i18n.js` - English and Traditional Chinese translations
- `scripts/build-daily-summary.mjs` - scheduled daily report generator
- `.github/workflows/daily-summary-email.yml` - GitHub Actions email/report automation

## Daily Email Setup

Add these repository secrets before enabling the workflow:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_TO`
- `EMAIL_FROM`

Optional repository variable:

- `DASHBOARD_URL`

The workflow runs daily at 08:00 Hong Kong time and can also be started manually from the GitHub Actions tab.
