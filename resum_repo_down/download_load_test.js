import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
// Dummy-100.js에서 파일 경로 import
import { filePaths } from './Dummy-100.js';

// 커스텀 메트릭 정의
const errorRate = new Rate('errors');
const downloadDuration = new Trend('download_duration');
const taskCompletionTime = new Trend('task_completion_time');

// 환경 변수 설정 (기존 코드 유지)
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const SPACE_ID = __ENV.SPACE_ID || '1';
const USER_ID = __ENV.USER_ID || '1';
const REPOSITORY = __ENV.REPOSITORY || 'test-user/test-repo-100';
const BRANCH = __ENV.BRANCH || 'main';
const MIN_FILES = parseInt(__ENV.MIN_FILES) || 1;
const MAX_FILES = parseInt(__ENV.MAX_FILES) || 100;

// 로드 테스트 단계 설정
const WARMUP_DURATION = __ENV.WARMUP_DURATION || '1m';
const SMALL_LOAD_DURATION = __ENV.SMALL_LOAD_DURATION || '2m';
const MEDIUM_LOAD_DURATION = __ENV.MEDIUM_LOAD_DURATION || '2m';
const HEAVY_LOAD_DURATION = __ENV.HEAVY_LOAD_DURATION || '3m';
const STRESS_LOAD_DURATION = __ENV.STRESS_LOAD_DURATION || '2m';
const COOLDOWN_DURATION = __ENV.COOLDOWN_DURATION || '1m';

const WARMUP_TARGET = parseInt(__ENV.WARMUP_TARGET) || 1;
const SMALL_LOAD_TARGET = parseInt(__ENV.SMALL_LOAD_TARGET) || 10;
const MEDIUM_LOAD_TARGET = parseInt(__ENV.MEDIUM_LOAD_TARGET) || 50;
const HEAVY_LOAD_TARGET = parseInt(__ENV.HEAVY_LOAD_TARGET) || 100;
const STRESS_LOAD_TARGET = parseInt(__ENV.STRESS_LOAD_TARGET) || 200;

const MAX_RESPONSE_TIME = parseInt(__ENV.MAX_RESPONSE_TIME) || 10000;
const MAX_ERROR_RATE = parseFloat(__ENV.MAX_ERROR_RATE) || 0.05;
const MAX_TASK_COMPLETION_TIME = parseInt(__ENV.MAX_TASK_COMPLETION_TIME) || 300000;

// 이 부분을 추가하세요 ⬇️
const POLL_INTERVAL = parseInt(__ENV.POLL_INTERVAL) || 5;
const MAX_POLLS = parseInt(__ENV.MAX_POLLS) || 60;
const STATUS_CHECK_TIMEOUT = __ENV.STATUS_CHECK_TIMEOUT || '10s';
const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || '30s';

const TEST_TYPE = __ENV.TEST || 'async'; // 실행할 테스트 타입

// 테스트 설정 맵
const testConfigs = {
  async: {
    endpoint: '/save-files/async',
    name: 'Async Download Test'
  },
  serial: {
    endpoint: '/save-files/serial',
    name: 'Serial Download Test'
  },
  zip: {
    endpoint: '/save-files/zip',
    name: 'Zip Download Test'
  }
};

// 선택된 테스트 설정
const selectedTest = testConfigs[TEST_TYPE];
if (!selectedTest) {
  throw new Error(`Invalid test type: ${TEST_TYPE}. Valid types: async, serial, zip`);
}

// 테스트 옵션 설정 (단일 시나리오만 실행)
export const options = {
  scenarios: {
    [`${TEST_TYPE}_progressive_load_test`]: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        // 1단계: 워밍업
        { duration: WARMUP_DURATION, target: WARMUP_TARGET },
        // 2단계: 소규모 부하
        { duration: SMALL_LOAD_DURATION, target: SMALL_LOAD_TARGET },
        // 3단계: 중간 규모 부하  
        { duration: MEDIUM_LOAD_DURATION, target: MEDIUM_LOAD_TARGET },
        // 4단계: 대규모 부하
        { duration: HEAVY_LOAD_DURATION, target: HEAVY_LOAD_TARGET },
        // 5단계: 스트레스 테스트 (선택적)
        { duration: STRESS_LOAD_DURATION, target: STRESS_LOAD_TARGET },
        
        // 6단계: 쿨다운
        { duration: COOLDOWN_DURATION, target: 0 },
      ],
      tags: { test_type: TEST_TYPE },
      env: { ENDPOINT: selectedTest.endpoint },
    },
  },
  thresholds: {
    http_req_duration: [`p(95)<${MAX_RESPONSE_TIME}`],
    errors: [`rate<${MAX_ERROR_RATE}`],
    task_completion_time: [`p(90)<${MAX_TASK_COMPLETION_TIME}`],
  },
};

// 랜덤하게 파일 경로 선택하는 함수
function getRandomFilePaths() {
  const randomCount = Math.floor(Math.random() * (MAX_FILES - MIN_FILES + 1)) + MIN_FILES;
  const shuffled = [...filePaths].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, randomCount);
}

// 메인 테스트 함수
export default function () {
  
  // 현재 실행 중인 테스트 타입과 엔드포인트
  const testType = TEST_TYPE;
  const endpoint = selectedTest.endpoint;
  
  // 랜덤하게 파일 선택
  const selectedFilePaths = getRandomFilePaths();
  
  console.log(`[${testType.toUpperCase()}] Testing with ${selectedFilePaths.length} random files from ${REPOSITORY}`);

  // 1. 다운로드 요청
  const downloadStartTime = Date.now();
  
  const payload = {
    repository: REPOSITORY,
    filePaths: selectedFilePaths,
    branch: BRANCH
  };

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: REQUEST_TIMEOUT,
    tags: { test_type: testType },
  };

  // POST 요청으로 다운로드 시작
  const downloadResponse = http.post(
    `${BASE_URL}/api/v1/resume/${SPACE_ID}/k6/users/${USER_ID}${endpoint}`,
    JSON.stringify(payload),
    params
  );

  // 다운로드 요청 검증
  const downloadSuccess = check(downloadResponse, {
    [`${testType} download request successful`]: (resp) => resp.status === 202,
    [`${testType} response has taskId`]: (resp) => {
      try {
        const body = JSON.parse(resp.body);
        return body.taskId !== undefined;
      } catch (e) {
        return false;
      }
    },
  });

  if (!downloadSuccess) {
    errorRate.add(1);
    console.error(`[${testType.toUpperCase()}] Download request failed: ${downloadResponse.status} - ${downloadResponse.body}`);
    return;
  }

  // taskId 추출
  let taskId;
  try {
    const responseBody = JSON.parse(downloadResponse.body);
    taskId = responseBody.taskId;
    console.log(`[${testType.toUpperCase()}] Task started with ID: ${taskId}`);
  } catch (e) {
    errorRate.add(1);
    console.error(`[${testType.toUpperCase()}] Failed to parse download response:`, e);
    return;
  }

  downloadDuration.add(Date.now() - downloadStartTime);

  // 2. 작업 상태 폴링
  let completed = false;
  let pollCount = 0;
  const maxPolls = MAX_POLLS;
  const pollInterval = POLL_INTERVAL;

  const taskStartTime = Date.now();

  while (!completed && pollCount < maxPolls) {
    sleep(pollInterval);
    pollCount++;

    // 작업 상태 확인
    const statusResponse = http.get(
      `${BASE_URL}/api/v1/resume/${SPACE_ID}/k6/tasks/${taskId}`,
      { 
        timeout: STATUS_CHECK_TIMEOUT,
        tags: { test_type: testType }
      }
    );

    const statusCheck = check(statusResponse, {
      [`${testType} status request successful`]: (resp) => resp.status === 200,
      [`${testType} status response is valid`]: (resp) => {
        try {
          const body = JSON.parse(resp.body);
          return body.taskId === taskId;
        } catch (e) {
          return false;
        }
      },
    });

    if (!statusCheck) {
      if (statusResponse.status === 404) {
        console.log(`[${testType.toUpperCase()}] Task ${taskId} not found - may have been cleaned up`);
        break;
      }
      errorRate.add(1);
      console.error(`[${testType.toUpperCase()}] Status check failed: ${statusResponse.status} - ${statusResponse.body}`);
      continue;
    }

    try {
      const statusBody = JSON.parse(statusResponse.body);
      completed = statusBody.completed;
      const progress = statusBody.progress || 0;
      const totalFiles = statusBody.totalFiles || 0;
      const completedFiles = statusBody.completedFiles || 0;

      console.log(`[${testType.toUpperCase()}] Task ${taskId} - Poll ${pollCount}: ${progress}% (${completedFiles}/${totalFiles})`);

      if (completed) {
        const taskEndTime = Date.now();
        const totalTime = taskEndTime - taskStartTime;
        taskCompletionTime.add(totalTime);

        console.log(`[${testType.toUpperCase()}] Task ${taskId} completed in ${totalTime}ms`);
        console.log(`[${testType.toUpperCase()}] Saved files: ${statusBody.savedFiles?.length || 0}`);
        console.log(`[${testType.toUpperCase()}] Failed files: ${statusBody.failedFiles?.length || 0}`);

        // 성공 검증
        check(statusBody, {
          [`${testType} task completed successfully`]: (body) => body.completed === true,
          [`${testType} has saved files`]: (body) => (body.savedFiles?.length || 0) > 0,
          [`${testType} error rate acceptable`]: (body) => {
            const total = (body.savedFiles?.length || 0) + (body.failedFiles?.length || 0);
            const failureRate = total > 0 ? (body.failedFiles?.length || 0) / total : 0;
            return failureRate <= 0.1; // 10% 이하 실패율
          },
        });

        break;
      }
    } catch (e) {
      errorRate.add(1);
      console.error(`[${testType.toUpperCase()}] Failed to parse status response:`, e);
    }
  }

  if (!completed) {
    errorRate.add(1);
    console.error(`[${testType.toUpperCase()}] Task ${taskId} did not complete within ${maxPolls * pollInterval} seconds`);
  }

  errorRate.add(0); // 성공한 경우
}

// 테스트 시작 시 실행
export function setup() {
  console.log(`\n=== Starting K6 ${selectedTest.name} ===`);
  console.log(`Test Type: ${TEST_TYPE.toUpperCase()}`);
  console.log(`Endpoint: ${selectedTest.endpoint}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Repository: ${REPOSITORY}, Branch: ${BRANCH}`);
  console.log(`File range: ${MIN_FILES}-${MAX_FILES}, Total available: ${filePaths.length}`);
  
  console.log(`\n=== Load Test Stages ===`);
  console.log(`1. Warmup:     ${WARMUP_DURATION} → ${WARMUP_TARGET} users`);
  console.log(`2. Small Load: ${SMALL_LOAD_DURATION} → ${SMALL_LOAD_TARGET} users`);
  console.log(`3. Medium Load:${MEDIUM_LOAD_DURATION} → ${MEDIUM_LOAD_TARGET} users`);
  console.log(`4. Heavy Load: ${HEAVY_LOAD_DURATION} → ${HEAVY_LOAD_TARGET} users`);
  console.log(`5. Stress Test:${STRESS_LOAD_DURATION} → ${STRESS_LOAD_TARGET} users`);
  console.log(`6. Cooldown:   ${COOLDOWN_DURATION} → 0 users`);
  
  console.log(`\n=== Performance Thresholds ===`);
  console.log(`Max Response Time: ${MAX_RESPONSE_TIME}ms (p95)`);
  console.log(`Max Error Rate: ${MAX_ERROR_RATE * 100}%`);
  console.log(`Max Task Time: ${MAX_TASK_COMPLETION_TIME}ms (p90)`)
  
  // 서버 상태 확인 (선택사항)
  const healthCheck = http.get(`${BASE_URL}/actuator/health`, { timeout: '10s' });
  if (healthCheck.status !== 200) {
    console.warn('Health check failed, but continuing with test');
  }
}

// 테스트 종료 시 실행
export function teardown(data) {
  console.log(`K6 ${selectedTest.name} completed`);
}