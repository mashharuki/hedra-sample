#!/usr/bin/env bash
# EC2 上でサブグラフスタックを起動し、初回のみビルド&デプロイする。
# userData から呼ばれる。再実行しても安全（sentinel でガード）。
set -euxo pipefail

APP_DIR=/opt/app/hedera-subgraph-example
COMPOSE_FILE="${APP_DIR}/deploy/docker-compose.prod.yaml"
SENTINEL=/opt/app/.subgraph-deployed
LOG=/var/log/subgraph-bootstrap.log

exec > >(tee -a "${LOG}") 2>&1
cd "${APP_DIR}"

echo "[bootstrap] starting compose stack"
docker compose -f "${COMPOSE_FILE}" up -d

echo "[bootstrap] waiting for graph-node admin endpoint on :8020"
for i in $(seq 1 60); do
  if nc -z localhost 8020; then
    echo "[bootstrap] graph-node admin is reachable"
    break
  fi
  echo "[bootstrap] waiting... (${i}/60)"
  sleep 5
done

if [ -f "${SENTINEL}" ]; then
  echo "[bootstrap] sentinel present; subgraph already deployed. Done."
  exit 0
fi

echo "[bootstrap] installing subgraph toolchain deps"
export PNPM_HOME=/root/.local/share/pnpm
export PATH="${PNPM_HOME}:${PATH}"
pnpm install --frozen-lockfile

echo "[bootstrap] compiling subgraph (mustache + graph codegen + graph build)"
pnpm compile

echo "[bootstrap] creating subgraph on the local node"
pnpm exec graph create --node http://localhost:8020/ MyToken || true

echo "[bootstrap] deploying subgraph"
pnpm exec graph deploy \
  --node http://localhost:8020/ \
  --ipfs http://localhost:5001 \
  --version-label v0.0.1 \
  MyToken

touch "${SENTINEL}"
echo "[bootstrap] done. Query at http://<elastic-ip>:8000/subgraphs/name/MyToken"
