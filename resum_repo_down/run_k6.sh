#!/bin/bash
set -a  # 모든 변수를 자동으로 export
source .env
set +a

K6_INFLUXDB_PUSH_INTERVAL=5s K6_INFLUXDB_CONCURRENT_WRITES=4 k6 run \
 --out influxdb=http://k6user:k6pass@210.113.34.187:8086/k6 \
 --out json=${1}_result.json \
 -e TEST=$1 \
 download_load_test.js