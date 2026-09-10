#!/usr/bin/env bash
#
# 例行升版：在「本機」建置映像 → 串流傳送至部署主機 → 切換容器。
#
# 為什麼不在主機上 build：staging 主機為 1 OCPU / 1 GB（VM.Standard.E2.1.Micro）。
# 容器內 `npm ci` + `vite build` 峰值需 1.5–2 GB，曾在無 swap 時把整台機器拖進
# 重度 swap thrash——sshd 連交握都送不出、Caddy 停止回應，只能強制電源循環。
# 主機端只做「解壓映像 + 換容器」，負載幾乎不動。
#
# 用法：
#   ./deploy/build-and-ship.sh                 # 建置並部署
#   ./deploy/build-and-ship.sh --build-only    # 只建置，不傳送（本機驗證用）
#   TARGET_PLATFORM=linux/arm64 ./deploy/build-and-ship.sh   # 若將來搬到 Ampere A1
#
set -euo pipefail

# ---- 可覆寫設定 ----
HOST="${HOST:-ubuntu@207.211.153.165}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/oci_key}"
REMOTE_DIR="${REMOTE_DIR:-~/DataExchange}"
PROJECT="${PROJECT:-dataexchange}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.fullstack.yml}"
# 目標主機架構。目前 staging 為 x86_64；搬到 A1（Ampere）時改 linux/arm64
TARGET_PLATFORM="${TARGET_PLATFORM:-linux/amd64}"
PUBLIC_URL="${PUBLIC_URL:-https://debit-ex-platform-staging.baasinnovation.com}"

BUILD_ONLY=0
[ "${1:-}" = "--build-only" ] && BUILD_ONLY=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

SSH="ssh -i ${SSH_KEY} -o ConnectTimeout=20"
say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

VERSION="$(git describe --tags --always 2>/dev/null || echo dev)"
say "版本 ${VERSION} · 目標架構 ${TARGET_PLATFORM}"

# ---------------------------------------------------------------- 1. 後端映像
# 後端可直接跨架構建置：建置期只跑 Node/Prisma，未觸發 QEMU 下會崩潰的 Go 二進位。
say "建置後端映像（${TARGET_PLATFORM}）"
docker buildx build --platform "${TARGET_PLATFORM}" \
  -t dataexchange-api:latest -t "dataexchange-api:${VERSION}" --load ./backend

# ---------------------------------------------------------------- 2. 前端映像
# 前端**必須**先在本機原生建置，再包成「只做 COPY」的映像。
# 原因見 deploy/Dockerfile.web-prebuilt 的說明（esbuild 是 Go 二進位，QEMU 下必崩）。
say "本機原生建置前端（VITE_API_BASE=\"\" → 同源 /api）"
rm -rf dist
VITE_API_BASE="" npm run build

# 防呆：漏帶 VITE_API_BASE 會回退成 http://localhost:4000，線上登入會直接 Failed to fetch
if grep -rq "localhost:4000" dist/; then
  echo "✗ dist/ 內含 localhost:4000 —— VITE_API_BASE 未正確帶入，中止。" >&2
  exit 1
fi
echo "✓ dist/ 無 localhost:4000（同源模式正確）"

say "打包前端映像（${TARGET_PLATFORM}，僅 COPY 不執行二進位）"
CTX="$(mktemp -d)"
trap 'rm -rf "${CTX}"' EXIT
cp -R dist "${CTX}/dist"
cp nginx.conf "${CTX}/nginx.conf"
cp deploy/Dockerfile.web-prebuilt "${CTX}/Dockerfile"
docker buildx build --platform "${TARGET_PLATFORM}" \
  -t dataexchange-web:latest -t "dataexchange-web:${VERSION}" --load "${CTX}"

docker image inspect dataexchange-api:latest dataexchange-web:latest \
  --format '  {{.RepoTags}} arch={{.Architecture}}/{{.Os}}'

if [ "${BUILD_ONLY}" = "1" ]; then
  say "--build-only：就此停止，未傳送"
  exit 0
fi

# ---------------------------------------------------------------- 3. 傳送
# 串流傳送，不落地暫存檔（映像約 330 MB，壓縮後約 128 MB，實測約 2–3 分鐘）
say "傳送映像至 ${HOST}"
# 連同版本標籤一併傳送：同一份映像多個標籤不會增加傳輸量（層共用），
# 但主機端才會留下可辨識的版本標記，回滾時不必猜哪個 latest 是哪一版。
docker save \
  dataexchange-api:latest "dataexchange-api:${VERSION}" \
  dataexchange-web:latest "dataexchange-web:${VERSION}" \
  | gzip -1 | ${SSH} "${HOST}" 'gunzip -c | docker load'

# ---------------------------------------------------------------- 4. 切換容器
# --no-build 是關鍵：沒有它，compose 會在主機上重新 build，正是要避免的事。
say "切換容器（--no-build）"
${SSH} "${HOST}" "cd ${REMOTE_DIR} && docker compose -p ${PROJECT} -f ${COMPOSE_FILE} up -d --no-build api web"

# ---------------------------------------------------------------- 5. 驗證
say "驗證"
sleep 15
${SSH} "${HOST}" 'docker ps --format "  {{.Names}} {{.Status}}"'
echo "  /health → $(curl -s --max-time 20 "${PUBLIC_URL}/health")"
${SSH} "${HOST}" 'docker exec dataexchange-db-1 psql -U app -d mediation -t -c "select (select count(*) from users) users,(select count(*) from cases) cases,(select count(*) from credit_items) items;"' \
  | sed 's/^/   資料筆數:/'

say "完成。回滾方式見 deploy/README.md"
