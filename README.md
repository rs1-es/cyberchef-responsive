# CyberChef Responsive

A build script that turns the official [CyberChef](https://github.com/gchq/CyberChef) into a site that is
comfortable to use on phones and tablets, and optionally deploys it to an S3 bucket.

> **Not affiliated with GCHQ.** This project does not contain CyberChef's source code. It downloads the
> official source at build time, injects a small responsive layer and builds it. The result is a *modified*
> version of CyberChef and says so in its **Download CyberChef** and **About / Support** dialogs. The official,
> unmodified version lives at <https://gchq.github.io/CyberChef>.

## What it changes

The original CyberChef is a three-column desktop layout driven by drag and drop. The responsive layer adds:

- **Mobile layout** (viewport narrower than 900 px): a bottom tab bar (*Operations*, *Recipe*, *Input*,
  *Output*) with one full-screen pane at a time, a single-line banner, bigger touch targets, and a badge
  with the number of operations in the recipe. Pressing **Bake!** jumps to the output.
- **Touch interaction** (devices whose main pointer is coarse, whatever the screen width): a single tap on an
  operation adds it to the recipe, and each recipe step gets *move up / move down / remove* buttons. Drag and
  drop and native double-tap are turned off in that case because they fight with scrolling.
- **Mouse interaction is untouched**: on a desktop, even in a narrow window, double click and drag and drop
  work exactly as in the original.
- A different **page title** (default `CyberChef Responsive`, also kept when CyberChef updates it as the recipe
  changes) and the **modified-version notices** mentioned above.

Layout (by width) and interaction (by pointer type) are decided independently, so a landscape tablet keeps the
desktop layout but gets tap-to-add, and a narrow desktop window gets the tab bar but keeps drag and drop.

The UI is English only, like the original.

## Requirements

- `bash`, `git`, `node` and `npm` (CyberChef's `.nvmrc` is honoured if you use [nvm](https://github.com/nvm-sh/nvm))
- Several minutes and ~4 GB of RAM for the CyberChef build
- To deploy: the [AWS CLI](https://aws.amazon.com/cli/) with credentials that can write to the bucket

## Usage

Build only (no AWS needed):

```bash
./cyberchef-responsive.sh --skip-deploy
# The site is in ./cyberchef-responsive-build/CyberChef/build/prod
```

Build and deploy to S3:

```bash
./cyberchef-responsive.sh --bucket my-bucket --ref v11.5.0 --contact you@example.com
```

Pin `--ref` to a CyberChef tag (as above) for reproducible builds; the default is `master`. The assets folder
(`assets/`) must stay next to the script.

### Options

| Option | Description |
|---|---|
| `--bucket NAME` | Destination S3 bucket (required unless `--skip-deploy`) |
| `--prefix PATH` | Folder inside the bucket (default: bucket root) |
| `--ref REF` | CyberChef branch, tag or commit (default: `master`) |
| `--workdir DIR` | Working directory (default: `./cyberchef-responsive-build`) |
| `--breakpoint PX` | Maximum width for the mobile layout (default: `900`) |
| `--title TEXT` | Page title (default: `CyberChef Responsive`) |
| `--contact TEXT` | Where to report problems of *your* build (URL, email or text), shown in *About / Support > Report a bug*. Without it the notice just tells users not to report them to GCHQ. |
| `--profile`, `--region` | AWS CLI profile / region |
| `--cloudfront ID` | Invalidate this CloudFront distribution after deploying |
| `--website` | Configure the bucket as a static website |
| `--no-delete` | Do not delete old files from the bucket |
| `-y`, `--yes` | Do not ask for confirmation before deleting |
| `--skip-deploy` | Only clone, patch and build |
| `--dry-run` | Simulate the upload without writing anything |

Every option also exists as an environment variable (see `--help`).

### About `--delete`

By default the bucket (or `--prefix`) is synced with `aws s3 sync --delete`, so **anything that is not part of the
build is removed**. In an interactive terminal the script asks for confirmation first (`--yes` skips it). Use
`--prefix`, `--no-delete` or `--dry-run` if the bucket holds other things.

HTML files are uploaded with `Cache-Control: no-cache` and everything else with a one day cache. If a CDN sits in
front of the bucket, pass `--cloudfront` or invalidate it yourself.

## How it works

1. Clones `gchq/CyberChef` at `--ref` into the working directory.
2. `assets/patch-html.js` edits `src/web/html/index.html` (the page template): viewport meta tag, the inline
   `assets/mobile.css` and `assets/mobile.js`, the page title and the notices. It is idempotent.
3. `npm ci` and `npx grunt prod` build CyberChef (the ZIP offered by the *Download* dialog is built from the same
   patched template).
4. The patcher runs again on the built `index.html` and the script aborts if the layer, the title or the notices
   are missing.
5. The build is uploaded to S3 (skipped with `--skip-deploy`).

Nothing is changed in CyberChef's own JavaScript, so operations and recipes behave exactly as upstream. If a
future CyberChef release renames the elements the layer relies on (`#banner`, `#operations`, `#recipe`, `#IO`,
`#rec-list`, `#bake`...), the script prints a warning.

## Tests

A Playwright smoke test checks a finished build: page title, notices, tap-to-add, double-tap, scrolling without
accidental drags, the recipe buttons, the tablet case and the narrow-window-with-mouse case.

```bash
npm install
npx playwright install chromium
./cyberchef-responsive.sh --skip-deploy
node tests/smoke.js cyberchef-responsive-build/CyberChef/build/prod
```

To check syntax locally (no extra tools needed): `npm run lint`.

## Created with Claude

This project (the build script, the responsive layer in `assets/`, the tests and this documentation) was
created with [Claude](https://www.anthropic.com/claude), an AI assistant by Anthropic, working through
[Claude Code](https://claude.com/claude-code). It is covered by the smoke test above, but as with any
generated code you should read it before running it against your own AWS account, especially the
`aws s3 sync --delete` step.

## License

[Apache License 2.0](LICENSE), the same license as CyberChef. See [NOTICE](NOTICE).
