#!/bin/bash
# Engine 集成测试
# 用法:
#   ./scripts/test_engine.sh                         # 本地模式（自动启动三服务）
#   ./scripts/test_engine.sh http://localhost:3001    # 远程模式
#
# 远程模式可选环境变量:
#   DATA_SERVER_URL=http://localhost:3000  (用于 session 创建时传给 engine)
#
# 本地模式要求 lexgent-engine 与 lexgent-demo 同级目录

cd "$(dirname "$0")/.." || exit 1

REMOTE_URL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    http*) REMOTE_URL="$1"; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

TEST_PATH="tests/integration/engine"

if [ -n "$REMOTE_URL" ]; then
  echo "远程模式: $REMOTE_URL"
  ENGINE_SERVER_URL="$REMOTE_URL" npx jest "$TEST_PATH"
else
  echo "本地模式（Data Server + YAML Server in-process, Engine subprocess）"
  npx jest "$TEST_PATH"
fi
