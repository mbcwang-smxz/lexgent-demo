#!/bin/bash
# YAML Server 集成测试
# 用法:
#   ./scripts/test_yaml_server.sh              # 本地模式
#   ./scripts/test_yaml_server.sh http://host:3003  # 远程模式
#   ./scripts/test_yaml_server.sh --file health     # 本地模式，指定测试文件
#   ./scripts/test_yaml_server.sh http://host:3003 --file skills  # 远程模式，指定测试文件

cd "$(dirname "$0")/.." || exit 1

REMOTE_URL=""
TEST_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --file) TEST_FILE="$2"; shift 2 ;;
    http*) REMOTE_URL="$1"; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

TEST_PATH="tests/integration/yaml_server"
if [ -n "$TEST_FILE" ]; then
  TEST_PATH="tests/integration/yaml_server/${TEST_FILE}.test.ts"
fi

if [ -n "$REMOTE_URL" ]; then
  echo "远程模式: $REMOTE_URL"
  YAML_SERVER_URL="$REMOTE_URL" npx jest "$TEST_PATH"
else
  echo "本地模式"
  npx jest "$TEST_PATH"
fi
