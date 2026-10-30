#!/usr/bin/env bash
# =============================================================================
#  cyberchef-responsive.sh
#
#  1. Clones the official CyberChef repository (gchq/CyberChef)
#  2. Injects a responsive layer (CSS + JS from ./assets) into the web page template
#  3. Builds the project in production mode (npx grunt prod)
#  4. Deploys the result (build/prod) to an S3 bucket
#
#  Quick start:
#     ./cyberchef-responsive.sh --bucket my-bucket
#
#  Build only, without deploying (no AWS needed):
#     ./cyberchef-responsive.sh --skip-deploy
#
#  All options:
#     ./cyberchef-responsive.sh --help
# =============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# ----------------------------- Configuration ---------------------------------
# Every option can be given as an environment variable or as an argument.
CYBERCHEF_REPO="${CYBERCHEF_REPO:-https://github.com/gchq/CyberChef.git}"
CYBERCHEF_REF="${CYBERCHEF_REF:-master}"          # branch, tag (e.g. v10.19.4) or commit
WORK_DIR="${WORK_DIR:-$PWD/cyberchef-responsive-build}"
ASSETS_DIR="${ASSETS_DIR:-$SCRIPT_DIR/assets}"    # mobile.css, mobile.js and patch-html.js
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-}"                        # folder inside the bucket (optional)
MOBILE_BREAKPOINT="${MOBILE_BREAKPOINT:-900}"     # width (px) below which the mobile layout is used
SITE_TITLE="${SITE_TITLE:-CyberChef Responsive}"  # page title (the original is "CyberChef")
CONTACT="${CONTACT:-}"                            # shown in the "Report a bug" notice (URL, email or text)
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"
CONFIGURE_WEBSITE="${CONFIGURE_WEBSITE:-false}"   # enable static website hosting on the bucket
S3_DELETE="${S3_DELETE:-true}"                    # delete from the bucket what is no longer in the build
ASSUME_YES="${ASSUME_YES:-false}"                 # do not ask for confirmation before deleting
SKIP_DEPLOY="${SKIP_DEPLOY:-false}"
DRY_RUN="${DRY_RUN:-false}"

# ----------------------------- Helpers ---------------------------------------
if [[ -t 1 ]]; then
  C_BLUE=$'\e[1;34m'; C_YEL=$'\e[1;33m'; C_RED=$'\e[1;31m'; C_GRN=$'\e[1;32m'; C_OFF=$'\e[0m'
else
  C_BLUE=""; C_YEL=""; C_RED=""; C_GRN=""; C_OFF=""
fi
log()  { printf '%s==>%s %s\n' "$C_BLUE" "$C_OFF" "$*"; }
ok()   { printf '%s ✔ %s %s\n' "$C_GRN" "$C_OFF" "$*"; }
warn() { printf '%s ! %s %s\n' "$C_YEL" "$C_OFF" "$*" >&2; }
die()  { printf '%s ✘ %s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }
trap 'printf "%s ✘ %s Error on line %s: %s\n" "$C_RED" "$C_OFF" "$LINENO" "$BASH_COMMAND" >&2' ERR

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --bucket NAME          Destination S3 bucket (required unless --skip-deploy)
  --prefix PATH          Folder inside the bucket (default: bucket root)
  --ref REF              CyberChef branch, tag or commit (default: master)
  --workdir DIR          Working directory (default: ./cyberchef-responsive-build)
  --breakpoint PX        Maximum width for the mobile layout (default: 900)
  --title TEXT           Page title (default: "CyberChef Responsive")
  --contact TEXT         Where to report problems of this modified build: a URL, an email
                         address or plain text. Shown in About / Support > Report a bug.
  --profile PROFILE      AWS CLI profile to use
  --region REGION        AWS region
  --cloudfront ID        Invalidate this CloudFront distribution after deploying
  --website              Configure the bucket as a static website (index.html)
  --no-delete            Do not delete old files from the bucket
  -y, --yes              Do not ask for confirmation before deleting from the bucket
  --skip-deploy          Only clone, patch and build
  --dry-run              Simulate the S3 upload without writing anything
  -h, --help             Show this help

Equivalent environment variables: S3_BUCKET, S3_PREFIX, CYBERCHEF_REF, WORK_DIR,
MOBILE_BREAKPOINT, SITE_TITLE, CONTACT, CLOUDFRONT_DISTRIBUTION_ID, CONFIGURE_WEBSITE,
S3_DELETE, ASSUME_YES, SKIP_DEPLOY, DRY_RUN, AWS_PROFILE, AWS_REGION.
EOF
}

need_arg() { [[ -n "${2:-}" && "${2:0:2}" != "--" ]] || die "Option $1 needs a value"; }

parse_args() {
  while (($#)); do
    case "$1" in
      --bucket)      need_arg "$@"; S3_BUCKET="$2"; shift 2 ;;
      --prefix)      need_arg "$@"; S3_PREFIX="$2"; shift 2 ;;
      --ref)         need_arg "$@"; CYBERCHEF_REF="$2"; shift 2 ;;
      --workdir)     need_arg "$@"; WORK_DIR="$2"; shift 2 ;;
      --breakpoint)  need_arg "$@"; MOBILE_BREAKPOINT="$2"; shift 2 ;;
      --title)       need_arg "$@"; SITE_TITLE="$2"; shift 2 ;;
      --contact)     need_arg "$@"; CONTACT="$2"; shift 2 ;;
      --profile)     need_arg "$@"; export AWS_PROFILE="$2"; shift 2 ;;
      --region)      need_arg "$@"; export AWS_REGION="$2" AWS_DEFAULT_REGION="$2"; shift 2 ;;
      --cloudfront)  need_arg "$@"; CLOUDFRONT_DISTRIBUTION_ID="$2"; shift 2 ;;
      --website)     CONFIGURE_WEBSITE=true; shift ;;
      --no-delete)   S3_DELETE=false; shift ;;
      -y|--yes)      ASSUME_YES=true; shift ;;
      --skip-deploy) SKIP_DEPLOY=true; shift ;;
      --dry-run)     DRY_RUN=true; shift ;;
      -h|--help)     usage; exit 0 ;;
      *)             usage; die "Unknown option: $1" ;;
    esac
  done
}

# ----------------------------- Checks ----------------------------------------
check_requirements() {
  log "Checking requirements"
  local cmd f
  for cmd in git node npm; do
    command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' not found in PATH"
  done
  for f in mobile.css mobile.js patch-html.js; do
    [[ -f "$ASSETS_DIR/$f" ]] || die "Missing $ASSETS_DIR/$f (the assets folder must sit next to the script)"
  done
  [[ "$MOBILE_BREAKPOINT" =~ ^[0-9]+$ ]] || die "--breakpoint must be an integer (px)"

  # The title and the contact end up inside HTML and JS that go through lodash.template:
  # no <, >, &, quotes, backslash or dollar-brace.
  [[ -n "$SITE_TITLE" && "$SITE_TITLE" != *[\<\>\&\"\\]* && "$SITE_TITLE" != *'${'* ]] \
    || die "--title cannot be empty or contain < > & \" \\ or \${"
  [[ "$CONTACT" != *[\<\>\&\"\\]* && "$CONTACT" != *'${'* ]] \
    || die "--contact cannot contain < > & \" \\ or \${"

  if [[ "$SKIP_DEPLOY" != true ]]; then
    command -v aws >/dev/null 2>&1 || die "AWS CLI ('aws') not found. Install it or use --skip-deploy"
    [[ -n "$S3_BUCKET" ]] || die "Give the bucket with --bucket or S3_BUCKET (or use --skip-deploy)"
    S3_BUCKET="${S3_BUCKET#s3://}"; S3_BUCKET="${S3_BUCKET%%/*}"
    S3_PREFIX="${S3_PREFIX#/}"; S3_PREFIX="${S3_PREFIX%/}"
  fi
  ok "Requirements OK"
}

# ----------------------------- 1. Clone --------------------------------------
clone_repo() {
  SRC_DIR="$WORK_DIR/CyberChef"
  mkdir -p "$WORK_DIR"
  if [[ -d "$SRC_DIR" ]]; then
    log "Removing previous clone in $SRC_DIR"
    rm -rf -- "$SRC_DIR"
  fi

  log "Cloning $CYBERCHEF_REPO ($CYBERCHEF_REF)"
  if ! git clone --depth 1 --branch "$CYBERCHEF_REF" "$CYBERCHEF_REPO" "$SRC_DIR" 2>/dev/null; then
    # It may be a commit hash: full clone + checkout
    rm -rf -- "$SRC_DIR"
    git clone "$CYBERCHEF_REPO" "$SRC_DIR"
    git -C "$SRC_DIR" checkout --quiet "$CYBERCHEF_REF" || die "Reference '$CYBERCHEF_REF' does not exist"
  fi
  CC_VERSION="$(node -p "require('$SRC_DIR/package.json').version")"
  ok "CyberChef v$CC_VERSION cloned ($(git -C "$SRC_DIR" rev-parse --short HEAD))"
}

# ----------------------------- Node version ----------------------------------
setup_node() {
  local nvmrc="$SRC_DIR/.nvmrc" wanted current
  [[ -f "$nvmrc" ]] || { warn "The repo has no .nvmrc; using Node $(node -v)"; return; }
  wanted="$(tr -d ' \r\n' < "$nvmrc")"

  local nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [[ -s "$nvm_sh" ]]; then
    log "Using nvm to install/activate Node $wanted"
    set +u
    # shellcheck disable=SC1090
    source "$nvm_sh"
    (cd "$SRC_DIR" && nvm install >/dev/null) && nvm use "$wanted" >/dev/null
    set -u
  fi

  current="$(node -p 'process.versions.node.split(".")[0]')"
  wanted="${wanted#v}"
  if [[ "${wanted%%.*}" =~ ^[0-9]+$ && "${wanted%%.*}" != "$current" ]]; then
    warn "CyberChef wants Node ${wanted} and you have $(node -v). The build may fail."
  else
    ok "Node $(node -v)"
  fi
}

# ----------------------------- 2. Responsive layer ---------------------------
# Runs the HTML patcher (assets/patch-html.js) on the given files. Idempotent.
patch_html() {
  node "$ASSETS_DIR/patch-html.js" "$ASSETS_DIR/mobile.css" "$ASSETS_DIR/mobile.js" \
       "$MOBILE_BREAKPOINT" "$SITE_TITLE" "$CONTACT" "$@"
}

patch_source() {
  local template="$SRC_DIR/src/web/html/index.html"
  [[ -f "$template" ]] || die "Template $template not found (has the repo structure changed?)"

  # Warn if the elements the responsive layer relies on no longer exist
  local id
  for id in banner operations recipe IO input output rec-list bake; do
    grep -q "id=\"$id\"" "$template" || warn "The template has no #$id; check the responsive layer"
  done

  log "Injecting the responsive layer into the template (breakpoint: ${MOBILE_BREAKPOINT}px, title: $SITE_TITLE)"
  patch_html "$template"
  ok "Template patched"
}

# ----------------------------- 3. Build --------------------------------------
build_project() {
  log "Installing dependencies (this can take several minutes)"
  cd "$SRC_DIR"
  # Test dependencies download browsers that are not needed to build
  export CHROMEDRIVER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

  if [[ -f package-lock.json ]]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi

  log "Building in production mode (npx grunt prod)"
  npx grunt prod

  BUILD_DIR="$SRC_DIR/build/prod"
  [[ -f "$BUILD_DIR/index.html" ]] || die "The build did not produce $BUILD_DIR/index.html"
  ok "Build finished in $BUILD_DIR"
}

verify_build() {
  log "Checking that the build includes the responsive layer"
  # If the minifier had removed anything, patch the final HTML again
  patch_html "$BUILD_DIR/index.html"

  local index="$BUILD_DIR/index.html" m
  grep -q "cc-mobile-style" "$index" || die "The build does not contain the responsive layer"
  grep -qF "<title>$SITE_TITLE</title>" "$index" || die "The build does not contain the title '$SITE_TITLE'"
  for m in cc-modified-notice cc-modified-about cc-modified-bug; do
    grep -q "$m" "$index" || die "The build does not contain the modified-version notice ($m)"
  done
  ok "Responsive layer present in the build"
}

# ----------------------------- 4. Deploy -------------------------------------
confirm_delete() {
  local target="$1"
  [[ "$S3_DELETE" == true && "$DRY_RUN" != true && "$ASSUME_YES" != true && -t 0 ]] || return 0
  warn "This syncs $target with --delete: anything in it that is not part of the build will be removed."
  local answer
  read -r -p "Continue? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || die "Aborted"
}

deploy_s3() {
  local dest="s3://$S3_BUCKET"
  [[ -n "$S3_PREFIX" ]] && dest="$dest/$S3_PREFIX"

  log "Checking AWS credentials"
  aws sts get-caller-identity --query Arn --output text >/dev/null \
    || die "No valid AWS credentials (run 'aws configure' or use --profile)"

  local extra=()
  [[ "$DRY_RUN" == true ]] && extra+=(--dryrun)
  [[ "$S3_DELETE" == true ]] && extra+=(--delete)
  if [[ "$S3_DELETE" == true && -z "$S3_PREFIX" ]]; then
    warn "Syncing the bucket root with --delete: everything that is not CyberChef will be removed"
  fi
  confirm_delete "$dest/"

  # Internal webpack report (~1 MB): not needed to serve the app
  rm -f -- "$BUILD_DIR/BundleAnalyzerReport.html"

  log "Uploading static assets to $dest"
  aws s3 sync "$BUILD_DIR/" "$dest/" \
    --exclude "*.html" \
    --cache-control "public, max-age=86400" \
    --only-show-errors ${extra[@]+"${extra[@]}"}

  log "Uploading HTML (no cache, so updates show up right away)"
  aws s3 sync "$BUILD_DIR/" "$dest/" \
    --exclude "*" --include "*.html" \
    --content-type "text/html; charset=utf-8" \
    --cache-control "no-cache, no-store, must-revalidate" \
    --only-show-errors ${extra[@]+"${extra[@]}"}

  if [[ "$CONFIGURE_WEBSITE" == true && "$DRY_RUN" != true ]]; then
    log "Configuring the bucket as a static website"
    aws s3 website "s3://$S3_BUCKET" --index-document index.html --error-document index.html
    warn "For public access you must allow it in 'Block Public Access' and add a bucket policy (or use CloudFront)"
  fi

  if [[ -n "$CLOUDFRONT_DISTRIBUTION_ID" && "$DRY_RUN" != true ]]; then
    local path="/*"
    [[ -n "$S3_PREFIX" ]] && path="/$S3_PREFIX/*"
    log "Invalidating CloudFront ($CLOUDFRONT_DISTRIBUTION_ID) at $path"
    aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
      --paths "$path" --query Invalidation.Id --output text
  fi

  ok "Deployed to $dest/"
  if [[ "$CONFIGURE_WEBSITE" == true ]]; then
    local region
    region="$(aws s3api get-bucket-location --bucket "$S3_BUCKET" --query LocationConstraint --output text 2>/dev/null || true)"
    [[ -z "$region" || "$region" == "None" || "$region" == "null" ]] && region="us-east-1"
    printf '   Website URL: http://%s.s3-website.%s.amazonaws.com/%s\n' \
      "$S3_BUCKET" "$region" "${S3_PREFIX:+$S3_PREFIX/}"
  fi
}

# ----------------------------- Main ------------------------------------------
main() {
  parse_args "$@"
  check_requirements
  clone_repo
  setup_node
  patch_source
  build_project
  verify_build
  if [[ "$SKIP_DEPLOY" == true ]]; then
    ok "Deploy skipped. Build ready in: $BUILD_DIR"
  else
    deploy_s3
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
