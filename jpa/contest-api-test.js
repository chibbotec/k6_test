import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// 커스텀 메트릭 정의
export const requestDuration = new Trend('request_duration'); // 요청 완료 시간
export const requestSuccess = new Counter('request_success'); // 성공한 요청 수
export const requestFailure = new Counter('request_failure'); // 실패한 요청 수
export const contestListSuccessRate = new Rate('contest_list_success_rate');

// 환경 변수 설정
const BASE_URL = __ENV.BASE_URL || 'http://localhost:9040';
const SPACE_ID = __ENV.SPACE_ID || '1';
const TEST_URL = `${BASE_URL}/api/v1/tech-interview/${SPACE_ID}/contests`;

// 테스트 구성 생성 함수
export function createOptions() {
    return {
        stages: [
            { duration: '10s', target: 10 },  // 10개로 증가
            { duration: '20s', target: 10 },  // 10개 유지
            { duration: '10s', target: 20 },  // 20개로 증가
            { duration: '20s', target: 20 },  // 20개 유지
            { duration: '10s', target: 30 },  // 30개로 증가
            { duration: '20s', target: 30 },  // 30개 유지
            { duration: '10s', target: 0 },   // 종료
        ],
        thresholds: {
            'request_duration': ['p(95)<1000'], // 95%의 요청이 1초 이내 완료
            'contest_list_success_rate': ['rate>0.95'], // 95% 이상 성공률
            'http_req_failed': ['rate<0.05'], // HTTP 요청 실패율 5% 미만
            'http_req_duration': ['p(95)<1000'], // HTTP 응답시간 95%가 1초 이내
        },
        tags: {
            test_type: 'contest_list_api'
        }
    };
}

// 요청 헤더 설정
export function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
}

// Contest 목록 조회 테스트
export function testGetContestList() {
    let requestStart = new Date().getTime();

    let response = http.get(TEST_URL, {
        headers: getHeaders(),
        tags: { endpoint: 'contest_list' }
    });

    let requestEnd = new Date().getTime();
    let duration = requestEnd - requestStart;
    requestDuration.add(duration);

    // 체크 결과를 개별적으로 확인
    let statusCheck = response.status === 200;
    let responseTimeCheck = response.timings.duration < 1000;
    let jsonValidCheck = false;
    let contentTypeCheck = response.headers['Content-Type'] && response.headers['Content-Type'].includes('application/json');

    // JSON 유효성 검사
    try {
        let body = response.json();
        jsonValidCheck = Array.isArray(body);
    } catch (e) {
        console.log(`JSON parsing error: ${e.message}`);
        jsonValidCheck = false;
    }

    // 전체 체크 실행 (메트릭을 위해)
    let success = check(response, {
        'status is 200': (r) => r.status === 200,
        'response time < 1000ms': (r) => r.timings.duration < 1000,
        'has valid JSON response': (r) => {
            try {
                let body = r.json();
                return Array.isArray(body);
            } catch (e) {
                return false;
            }
        },
        'content-type is JSON': (r) => r.headers['Content-Type'] && r.headers['Content-Type'].includes('application/json')
    });

    // 성공/실패 판정: HTTP 상태코드와 JSON 유효성만으로 판단 (응답시간 제외)
    let isActualSuccess = statusCheck && jsonValidCheck && contentTypeCheck;

    if (isActualSuccess) {
        requestSuccess.add(1);
        contestListSuccessRate.add(true);

        // 가끔씩 성공 로그 출력 (너무 많은 로그 방지)
        if (Math.random() < 0.1) { // 10% 확률
            console.log(`✅ Contest list retrieved successfully in ${duration}ms (Response size: ${response.body.length} bytes)`);
        }
    } else {
        requestFailure.add(1);
        contestListSuccessRate.add(false);

        // 실제 오류만 로그 출력 (응답시간 초과는 제외)
        if (!statusCheck) {
            console.log(`❌ Contest list request failed - Status: ${response.status}, Duration: ${duration}ms`);
            console.log(`   Error body: ${response.body.substring(0, 200)}...`);
        } else if (!jsonValidCheck) {
            console.log(`❌ Contest list request failed - Invalid JSON response, Duration: ${duration}ms`);
        } else if (!contentTypeCheck) {
            console.log(`❌ Contest list request failed - Invalid content type, Duration: ${duration}ms`);
        }
        // 응답시간 초과는 로그에 출력하지 않음
    }

    return response;
}

// 테스트 시작 전 설정 검증
export function setupTest() {
    console.log('🚀 Contest List API Performance Test Starting...');
    console.log(`Target URL: ${TEST_URL}`);
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Space ID: ${SPACE_ID}`);
    console.log(`Auth: No authentication required`);
    console.log(`Expected Response: JSON Array of contests`);

    // 연결 테스트
    console.log('🔍 Testing connection...');
    let testResponse = http.get(TEST_URL, { headers: getHeaders() });

    if (testResponse.status === 200) {
        console.log('✅ Connection test successful');
        try {
            let testData = testResponse.json();
            console.log(`📊 Sample response: Array with ${Array.isArray(testData) ? testData.length : 'unknown'} items`);
        } catch (e) {
            console.log('⚠️ Response is not valid JSON');
        }
    } else {
        console.log(`❌ Connection test failed - Status: ${testResponse.status}`);
        console.log(`   Response: ${testResponse.body.substring(0, 200)}...`);
    }

    return {
        startTime: new Date().toISOString(),
        testType: 'contest_list_api',
        targetUrl: TEST_URL
    };
}

// 테스트 설정
export let options = createOptions();

// 테스트 시작 전 설정
export function setup() {
    return setupTest();
}

// 메인 테스트 시나리오 (각 VU가 실행)
export default function () {
    // Contest 목록 조회
    testGetContestList();

    // VU간 간격 조절 (서버 부하 분산)
    sleep(0.1 + Math.random() * 0.5); // 0.1~0.6초 랜덤 대기
}

// 테스트 결과 요약
export function handleSummary(data) {
    return createSummary(data);
}

function createSummary(data) {
    // 안전한 메트릭 접근 헬퍼 함수
    const getMetricValue = (metricName, valueName, defaultValue = 0) => {
        return data.metrics[metricName]?.values?.[valueName] || defaultValue;
    };

    // 기본 요청 통계
    let successCount = getMetricValue('request_success', 'count');
    let failureCount = getMetricValue('request_failure', 'count');
    let totalRequests = successCount + failureCount;
    let successRate = totalRequests > 0 ? (successCount / totalRequests * 100) : 0;

    // Contest List API 성공률
    let listSuccessRate = getMetricValue('contest_list_success_rate', 'rate') * 100;

    // 테스트 실행 정보
    let testDurationSec = data.state.testRunDurationMs / 1000;
    let maxVUs = getMetricValue('vus_max', 'max');
    let avgVUs = getMetricValue('vus', 'avg');

    // 요청 성능 분석
    let avgRequestDuration = getMetricValue('request_duration', 'avg');
    let minRequestDuration = getMetricValue('request_duration', 'min');
    let maxRequestDuration = getMetricValue('request_duration', 'max');
    let p50RequestDuration = getMetricValue('request_duration', 'med');
    let p90RequestDuration = getMetricValue('request_duration', 'p(90)');
    let p95RequestDuration = getMetricValue('request_duration', 'p(95)');
    let p99RequestDuration = getMetricValue('request_duration', 'p(99)');

    // HTTP 성능 분석
    let totalHttpReqs = getMetricValue('http_reqs', 'count');
    let httpReqsPerSec = getMetricValue('http_reqs', 'rate');
    let avgResponseTime = getMetricValue('http_req_duration', 'avg');
    let minResponseTime = getMetricValue('http_req_duration', 'min');
    let maxResponseTime = getMetricValue('http_req_duration', 'max');
    let p50ResponseTime = getMetricValue('http_req_duration', 'med');
    let p90ResponseTime = getMetricValue('http_req_duration', 'p(90)');
    let p95ResponseTime = getMetricValue('http_req_duration', 'p(95)');
    let p99ResponseTime = getMetricValue('http_req_duration', 'p(99)');
    let httpFailRate = getMetricValue('http_req_failed', 'rate') * 100;

    // HTTP 세부 타이밍
    let avgConnecting = getMetricValue('http_req_connecting', 'avg');
    let avgWaiting = getMetricValue('http_req_waiting', 'avg');
    let avgReceiving = getMetricValue('http_req_receiving', 'avg');
    let avgBlocked = getMetricValue('http_req_blocked', 'avg');

    // 처리량 분석
    let requestsPerMinute = (totalRequests / testDurationSec) * 60;
    let requestsPerSecond = totalRequests / testDurationSec;
    let iterationsPerSec = getMetricValue('iterations', 'rate');

    // 데이터 전송량
    let dataReceived = getMetricValue('data_received', 'count');
    let dataSent = getMetricValue('data_sent', 'count');
    let dataReceivedRate = getMetricValue('data_received', 'rate');
    let dataSentRate = getMetricValue('data_sent', 'rate');

    console.log(`
=========================================================
        Contest List API 상세 성능 테스트 결과
=========================================================

🎯 테스트 대상
  URL                 : ${TEST_URL}
  테스트 유형         : Contest 목록 조회 API

📊 테스트 실행 개요
  총 테스트 기간      : ${testDurationSec.toFixed(2)}초 (${(testDurationSec / 60).toFixed(1)}분)
  최대 동시 VU 수     : ${maxVUs}개
  평균 동시 VU 수     : ${avgVUs.toFixed(1)}개
  총 완료된 반복      : ${getMetricValue('iterations', 'count')}회
  반복 처리율         : ${iterationsPerSec.toFixed(3)}/초

🎯 API 요청 성능 분석
  총 요청 수          : ${totalRequests}개
  성공한 요청         : ${successCount}개 (${successRate.toFixed(2)}%)
  실패한 요청         : ${failureCount}개
  API 성공률          : ${listSuccessRate.toFixed(2)}%
  
📈 처리량 분석
  초당 요청 수        : ${requestsPerSecond.toFixed(2)} req/s
  분당 요청 수        : ${requestsPerMinute.toFixed(0)} req/min
  VU당 평균 요청      : ${(totalRequests / maxVUs).toFixed(1)} req/VU

⏱️  애플리케이션 응답 시간
  평균 (Average)      : ${avgRequestDuration.toFixed(2)}ms
  최소 (Min)          : ${minRequestDuration.toFixed(2)}ms
  최대 (Max)          : ${maxRequestDuration.toFixed(2)}ms
  중앙값 (p50)        : ${p50RequestDuration.toFixed(2)}ms
  90th percentile     : ${p90RequestDuration.toFixed(2)}ms
  95th percentile     : ${p95RequestDuration.toFixed(2)}ms
  99th percentile     : ${p99RequestDuration.toFixed(2)}ms

🌐 HTTP 네트워크 성능
  총 HTTP 요청 수     : ${totalHttpReqs}개
  HTTP 처리율         : ${httpReqsPerSec.toFixed(2)}/초
  HTTP 실패율         : ${httpFailRate.toFixed(2)}%
  
🕐 HTTP 응답 시간 분포
  평균                : ${avgResponseTime.toFixed(2)}ms
  최소                : ${minResponseTime.toFixed(2)}ms
  최대                : ${maxResponseTime.toFixed(2)}ms
  중앙값 (p50)        : ${p50ResponseTime.toFixed(2)}ms
  90th percentile     : ${p90ResponseTime.toFixed(2)}ms
  95th percentile     : ${p95ResponseTime.toFixed(2)}ms
  99th percentile     : ${p99ResponseTime.toFixed(2)}ms

🔧 HTTP 요청 세부 타이밍
  연결 설정 시간      : ${avgConnecting.toFixed(2)}ms
  서버 처리 시간      : ${avgWaiting.toFixed(2)}ms
  응답 수신 시간      : ${avgReceiving.toFixed(2)}ms
  요청 차단 시간      : ${avgBlocked.toFixed(2)}ms

📊 데이터 전송량
  수신된 데이터       : ${(dataReceived / 1024).toFixed(2)} KB
  전송된 데이터       : ${(dataSent / 1024).toFixed(2)} KB
  평균 수신 속도      : ${(dataReceivedRate / 1024).toFixed(2)} KB/s
  평균 전송 속도      : ${(dataSentRate / 1024).toFixed(2)} KB/s
  요청당 평균 응답크기: ${totalRequests > 0 ? (dataReceived / totalRequests).toFixed(0) : 0} bytes

💡 성능 등급 평가
  응답시간 (평균)     : ${avgResponseTime < 200 ? '🟢 매우우수' : avgResponseTime < 500 ? '🟡 우수' : avgResponseTime < 1000 ? '🟠 보통' : '🔴 개선필요'}
  응답시간 (95%)      : ${p95ResponseTime < 500 ? '🟢 매우우수' : p95ResponseTime < 1000 ? '🟡 우수' : p95ResponseTime < 2000 ? '🟠 보통' : '🔴 개선필요'}
  안정성 (성공률)     : ${successRate >= 99 ? '🟢 매우안정' : successRate >= 95 ? '🟡 안정' : successRate >= 90 ? '🟠 보통' : '🔴 불안정'}
  처리량 (req/s)      : ${requestsPerSecond >= 100 ? '🟢 높음' : requestsPerSecond >= 50 ? '🟡 보통' : requestsPerSecond >= 20 ? '🟠 낮음' : '🔴 매우낮음'}

🎯 성능 임계값 달성 여부
  95% 응답시간 < 1초  : ${p95ResponseTime < 1000 ? '✅ 달성' : '❌ 미달성'} (${p95ResponseTime.toFixed(0)}ms)
  성공률 > 95%        : ${listSuccessRate > 95 ? '✅ 달성' : '❌ 미달성'} (${listSuccessRate.toFixed(1)}%)
  HTTP 실패율 < 5%    : ${httpFailRate < 5 ? '✅ 달성' : '❌ 미달성'} (${httpFailRate.toFixed(1)}%)

🎯 권장사항
${generateRecommendations(successRate, avgResponseTime, p95ResponseTime, httpFailRate, maxVUs, requestsPerSecond)}

=========================================================
    `);

    return {
        stdout: `Contest List API Test - ${maxVUs}VU | Success: ${successRate.toFixed(1)}% | Avg: ${avgResponseTime.toFixed(0)}ms | P95: ${p95ResponseTime.toFixed(0)}ms | ${requestsPerSecond.toFixed(1)} req/s`
    };
}

function generateRecommendations(successRate, avgResponse, p95Response, httpFailRate, maxVUs, reqPerSec) {
    let recommendations = [];

    // 성능 등급별 권장사항
    if (successRate >= 99 && p95Response <= 200 && reqPerSec >= 100) {
        recommendations.push("🏆 최고 성능! 현재 설정으로 프로덕션 배포 권장");
        recommendations.push("🚀 더 높은 부하에서 한계점 테스트 고려 (VU 50+ 테스트)");
    } else if (successRate >= 95 && p95Response <= 500 && reqPerSec >= 50) {
        recommendations.push("✅ 우수한 성능 - 일반적인 운영 환경에 적합");
        recommendations.push("💡 캐싱 전략 도입으로 더 나은 성능 가능");
    } else {
        // 개선 필요 사항들
        if (successRate < 95) {
            recommendations.push("⚠️ 성공률 개선 필요 - 애플리케이션 로그 및 에러 분석");
        }

        if (p95Response > 1000) {
            recommendations.push("⚠️ 응답시간 최적화 필요 - DB 쿼리 성능 점검");
        }

        if (httpFailRate > 5) {
            recommendations.push("❌ HTTP 실패율 높음 - 서버 리소스 및 연결 설정 점검");
        }

        if (reqPerSec < 20) {
            recommendations.push("💡 처리량 개선 - 애플리케이션 병목 지점 분석 필요");
        }
    }

    // 부하 테스트 단계별 권장사항
    if (maxVUs <= 30 && successRate >= 95) {
        recommendations.push("📈 다음 단계: VU 50개로 스트레스 테스트 진행");
    }

    // 성능 최적화 제안
    if (avgResponse > 100) {
        recommendations.push("🔧 성능 최적화 팁:");
        recommendations.push("   - DB 인덱스 최적화");
        recommendations.push("   - 응답 데이터 압축 (gzip)");
        recommendations.push("   - Redis 캐시 도입");
        recommendations.push("   - Connection Pool 튜닝");
    }

    return recommendations.length > 0 ? recommendations.join('\n  ') : "  📈 현재 성능 수준 양호";
}