# yt-lead-checker

This command-line tool checks YouTube channels against a configurable sales-prospect rubric for a service that sends creators a weekly AI-written summary of what their commenters ask, complain about, and praise. It uses only the official YouTube Data API v3. It does not scrape YouTube pages.

## What you need

- Node.js 22 or newer and pnpm.
- A YouTube Data API v3 key from a Google Cloud project where the YouTube Data API v3 is enabled.
- An internet connection while checking channels.

The project is small enough to use in a terminal app on a phone, such as a mobile SSH client connected to your computer or a cloud development workspace.

## One-time setup

1. Copy this project to your computer or development workspace and open its folder in a terminal.
2. Install the project packages:

   ```sh
   pnpm install
   ```

   Build the command once:

   ```sh
   pnpm build
   ```

3. In Google Cloud Console, create or select a project, enable **YouTube Data API v3**, and create an API key. Restrict the key to the YouTube Data API if possible.
4. Set the key in your terminal without displaying it:

   ```sh
   read -s YOUTUBE_API_KEY && export YOUTUBE_API_KEY
   ```

   Press Enter after pasting the key. It is held in that terminal session's environment; do not put it in a command-line argument, source file, or results file. Alternatively, copy `.env.example` to `.env`, replace the placeholder privately, and run Node with `--env-file=.env`, for example:

   ```sh
   node --env-file=.env dist/cli.js check leads.txt
   ```

   `.env` is ignored by Git. The tool does not read `.env` itself.

5. (Optional) Copy `config.example.json` to `config.json` to change the scoring or qualification thresholds. The example defaults are used if no `config.json` is present.

## Add channels and run a check

Create a text file with one channel on each line. You can use an `@handle`, a YouTube channel URL, or a channel ID. Lines starting with `#` are comments and are ignored. `leads.example.txt` shows the format.

You can also use CSV with a `channel` or `handle` column. Other CSV columns are ignored.

```sh
pnpm start check leads.txt
pnpm start check leads.csv --out output
```

Plain names are not searched by default. To allow name search (each search costs 100 quota units), use `--search`; limit how many names can be searched with `--max-search` (default 20):

```sh
pnpm start check leads.txt --search --max-search 5
```

Other useful options:

- `--config config.json` — use a particular JSON configuration.
- `--refresh` — ignore the local cache and prior completed results and check again.
- `--concurrency 1` — simultaneous channel checks. The default of 1 is the polite, least-bursty setting.
- `--out output` — save results in a different folder.

Each check writes `results.csv` and `results.json` in the output folder. Partial results are saved after each completed lead. Running the same command again skips completed inputs and continues with unchecked leads. A channel that could not be completed because the daily budget or YouTube quota was reached is not marked complete.

## Reading the results

Open `output/results.csv` in a spreadsheet app. Each row is one input. `status` is `PASS`, `FAIL`, `NOT_FOUND`, or `ERROR`; `score` is a heuristic score from 0 to 10. The CSV also contains the channel URL, handle, subscriber count, recent upload and comment metrics, creator-reply tally, monetization terms found, description links, and any email address found in the channel's public description.

`why` lists every failed hard requirement. A passing lead has an empty `why`. Use the saved-run summary and failure breakdown with:

```sh
pnpm start report
```

## Quota and local storage

The tool estimates quota by charging each API request according to YouTube's published costs: 1 unit for channel lookup, playlist lookup, video lookup, and comment-thread lookup; a name search is 100 units. Retries also count because they make another API request. It stops before exceeding the configured daily budget (default 9,000 units).

```sh
pnpm start quota
```

The usage log resets on a UTC calendar-day boundary. The local cache expires after 30 days and contains only channel/result metrics and counts; raw comment text is never saved. Cache, usage log, and default output files are excluded from Git.

## Configuration and development

`config.example.json` documents all thresholds, score weights, monetization signals, retry settings, and API sampling limits. Customize a copy named `config.json`, or pass another file with `--config`.

```sh
pnpm build
pnpm test
pnpm lint
pnpm run check:secrets
```

## Troubleshooting

- **Missing YOUTUBE_API_KEY:** set it in the current terminal session as shown above. If you opened a new terminal, set it again.
- **403 or API not enabled:** confirm that YouTube Data API v3 is enabled for the key's Google Cloud project and that the key is valid.
- **Quota exceeded:** wait until the daily reset (UTC) or lower the number of lookups/searches. `quota` shows this tool's local estimate; Google Cloud may show additional use by other tools.
- **Plain name not found:** channel names require `--search`; searches are limited by `--max-search`. Prefer a handle or channel URL to avoid search cost.
- **Comments disabled:** channels/videos with disabled comments are recorded and may fail the qualification rules; this is not a crash.
- **Invalid or deleted channel:** check the handle, URL, or channel ID. The row is recorded as `NOT_FOUND`.
- **Transient network error:** rerun the same check; saved results are kept and transient HTTP 429/5xx errors are retried automatically.

## Assumptions

- "Comments enabled on recent videos" means at least one of the five most recent videos sampled exposes a comment count. Total and average comments are calculated from the sampled recent videos for which the API provides a count.
- A creator reply counts once per sampled top-level comment thread if any returned reply has the channel's own channel ID. The sample is at most 50 threads on the most-commented sampled recent video.
- The default cache and resume files are local to the working folder; use the same `--out` directory to resume a run.

## LIMITATIONS

The YouTube Data API cannot return creator email addresses; the tool only detects an email if it appears in the channel's own public description. Scores are heuristics, not a guarantee of sales fit. API comment data may be unavailable, incomplete, or disabled. Manually review every result and its public contact details before outreach.
