# Playwright Result to Slack test

[![.github/workflows/test.yml](https://github.com/kimchunghwan/playwright_test/actions/workflows/test.yml/badge.svg)](https://github.com/kimchunghwan/playwright_test/actions/workflows/test.yml)

A tool for automatically capturing financial market screenshots using Playwright and uploading them to Slack.

## Features

- Captures screenshots from financial websites:
  - Stock charts from Finviz
  - Korean market indices (KOSPI, KOSDAQ)
  - US 10-Year Bond Yield
- Uploads screenshots to Slack automatically
- Configurable with multiple stock symbols

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- NPM or PNPM
- Slack Bot Token with proper permissions

### Installation

1. Clone the repository:
```bash
git clone https://github.com/kimchunghwan/playwright-result-to-slack.git
cd playwright-result-to-slack
```

2. Install dependencies:
```bash
npm install
# or
pnpm install
```

3. Set up environment variables:
```bash
export SLACK_BOT_TOKEN=your-slack-bot-token
```

### Usage

#### Running Tests

Run all tests and upload results:
```bash
npm run test:all
```

Run specific tests:
```bash
npm run test:stock    # Run stock-related tests
npm run test:bond     # Run bond-yield tests
```

Upload screenshots to Slack:
```bash
npm run upload
```

### Configuration

Modify the `define.ts` file to customize:

- Stock symbols
- Target URLs
- Slack channel IDs

## Project Structure

- `tests/`: Contains Playwright test files
  - `stock.spec.ts`: Tests for capturing stock charts
  - `bond-yield.spec.ts`: Tests for capturing bond yields
- `upload-files.ts`: Script for uploading screenshots to Slack
- `define.ts`: Configuration constants
- `playwright.config.ts`: Playwright configuration

## Advanced Usage

### Debug Mode

Run tests in debug mode:
```bash
npm run debug
```

### View Test Report

View the HTML report:
```bash
npm run report
```

### Clean Test Results

Remove all screenshot files:
```bash
npm run clean
```

## GitHub Actions

This project can be configured to run automatically using GitHub Actions:

- Scheduled runs
- Self-hosted runners
- Caching for better performance

### Setting up GitHub Actions

#### 1. Register Slack Bot Token as GitHub Secret

To use Slack notifications in GitHub Actions workflows, you need to register your Slack Bot User OAuth Token:

1. Go to your repository on GitHub
2. Navigate to **Settings** > **Secrets and variables** > **Actions**
3. Click **New repository secret**
4. Name: `SLACK_BOT_TOKEN`
5. Value: Your Slack Bot User OAuth Token (starts with `xoxb-`)
6. Click **Add secret**

#### 2. Workflow Configuration Example

The workflows use the `SLACK_BOT_TOKEN` to send notifications to Slack channels. Here's how to configure:

**For file change notifications** (`.github/workflows/noti-file-changed.yml`):
```yaml
- name: Send Slack notification
  uses: slackapi/slack-github-action@v1.25.0
  with:
    channel-id: '#general' # Specify your target channel
    payload: |
      {
        "text": "Your notification message"
      }
  env:
    SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
```

**For test results** (`.github/workflows/test.yml`):
```yaml
env:
  SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}

# ... later in the workflow
- name: upload to slack
  run: npm run upload
```

#### 3. Getting a Slack Bot Token

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Create a new app or select an existing one
3. Navigate to **OAuth & Permissions**
4. Add the following Bot Token Scopes:
   - `chat:write` - Send messages
   - `files:write` - Upload files
5. Install the app to your workspace
6. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
7. Invite the bot to your desired channels (e.g., `/invite @YourBotName` in #general)

## License

ISC

## Acknowledgments

- [Playwright](https://playwright.dev/)
- [Slack API](https://api.slack.com/)
- [Finviz](https://finviz.com/)
