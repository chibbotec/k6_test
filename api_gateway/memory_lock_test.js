import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// 커스텀 메트릭 정의
const authCallsCounter = new Counter('auth_service_calls');
const redisHitRate = new Rate('redis_hit_rate');
const refreshTokenLatency = new Trend('refresh_token_latency');
const loginCounter = new Counter('login_calls');

// 환경변수로 테스트 타입 구분
const TEST_TYPE = __ENV.TEST_TYPE || 'complex'; // 기본값: current

// 테스트 타입별 설정
const testConfigs = {
  // 현재 로직 (복잡한 락) 테스트
  complex: {
    name: '현재 로직 (복잡한 락)',
    baseUrl: 'http://localhost:9000',
    expectedLatency: 800, // 예상 응답시간 (ms)
    thresholds: {
      'http_req_duration': ['p(95)<2000'], // 현재는 느리니까 2초로 설정
      'refresh_token_latency': ['p(95)<1500'],
      'http_req_failed': ['rate<0.05'],
    }
  },
  
  // Redis 적용 후 테스트
  redis: {
    name: 'Redis 캐싱 로직',
    baseUrl: 'http://localhost:9000',
    expectedLatency: 100, // 예상 응답시간 (ms)
    thresholds: {
      'http_req_duration': ['p(95)<2000'], // Redis 적용 후엔 빨라야 함
      'refresh_token_latency': ['p(95)<1500'],
      'http_req_failed': ['rate<0.01'],
    }
  },
  
  // 단순 로직 (락 제거) 테스트
  simple: {
    name: '단순 로직 (락 제거)',
    baseUrl: 'http://localhost:9000',
    expectedLatency: 100,
    thresholds: {
      'http_req_duration': ['p(95)<500'],
      'refresh_token_latency': ['p(95)<300'],
      'http_req_failed': ['rate<0.02'],
    }
  }
};

// 현재 테스트 설정 선택
const currentConfig = testConfigs[TEST_TYPE];

// 테스트 설정
export const options = {
  stages: [
    { duration: '1m', target: 1 },    // 워밍업
    { duration: '2m', target: 10 },   // 소규모
    { duration: '2m', target: 50 },   // 중간 규모
    { duration: '2m', target: 100 },  // 대규모
    { duration: '1m', target: 0 },    // 쿨다운
  ],
  thresholds: currentConfig.thresholds,
};

const BASE_URL = 'http://localhost:9000';

// 테스트 계정 데이터 (실제 로그인용)
const TEST_ACCOUNTS = [];
const TEST_ACCOUNTS_COUNT = 100; // VU 수에 맞춰 계정 수 설정

// VU별 사용자 토큰 저장소
let userTokens = null;

// 회원가입 함수
function performSignup(username) {
  console.log(`[DEBUG] 회원가입 시도: ${username}`);
  const signupData = {
    username: username,
    password: '1234',
    email: `${username}@test.com`,
    nickname: `test_${username}`
  };

  const signupRes = http.post(`${BASE_URL}/api/v1/auth/signup`, JSON.stringify(signupData), {
    headers: { 
      'Content-Type': 'application/json'
    },
    tags: { 
      test_type: TEST_TYPE,
      scenario: 'signup'
    }
  });

  console.log(`[DEBUG] 회원가입 응답: ${signupRes.status} - ${signupRes.body}`);

  const signupSuccess = check(signupRes, {
    '회원가입 성공': (r) => r.status === 201,
    '회원가입 응답시간 < 3초': (r) => r.timings.duration < 3000,
  });

  if (!signupSuccess) {
    console.log(`❌ 회원가입 실패 - Status: ${signupRes.status}, Body: ${signupRes.body}`);
    return null;
  }

  try {
    const responseBody = JSON.parse(signupRes.body);
    console.log(`[DEBUG] 회원가입 성공 데이터:`, responseBody);
    return {
      username: responseBody.username,
      id: responseBody.id
    };
  } catch (e) {
    console.log(`❌ 회원가입 응답 파싱 실패: ${signupRes.body}`);
    return null;
  }
}

export function setup() {
  console.log('=== 성능 테스트 시작 ===');
  console.log(`테스트 타입: ${currentConfig.name}`);
  console.log(`대상 URL: ${currentConfig.baseUrl}`);
  console.log(`예상 응답시간: ${currentConfig.expectedLatency}ms`);
  console.log('');
  console.log('측정 항목:');
  console.log('1. Refresh Token 처리 응답시간');
  console.log('2. Auth 서비스 호출 횟수');
  console.log('3. 캐시 히트율 (Redis 테스트시)');
  console.log('4. 동시 사용자별 성능 변화');
  console.log('5. 실제 로그인 성공률');
  
  // 테스트 계정 생성
  console.log(`\n테스트 계정 생성 중... (${TEST_ACCOUNTS_COUNT}개)`);
  const createdAccounts = [];
  
  for (let i = 1; i <= TEST_ACCOUNTS_COUNT; i++) {
    let username = "";
    if (TEST_TYPE === 'complex') {
      username = `complex${i}`;
    } else if (TEST_TYPE === 'redis') {
      username = `redis${i}`;
    } else if (TEST_TYPE === 'simple') {
      username = `simple${i}`;
    }
    
    const account = performSignup(username);
    if (account) {
      const accountInfo = {
        username: account.username,
        password: '1234'
      };
      createdAccounts.push(accountInfo);
      console.log(`✅ 계정 생성 성공: ${username}`);
      console.log(`[DEBUG] createdAccounts 배열 상태:`, createdAccounts);
    } else {
      console.log(`❌ 계정 생성 실패: ${username}`);
    }
  }
  
  console.log(`\n생성된 테스트 계정 수: ${createdAccounts.length}`);
  console.log(`[DEBUG] 최종 createdAccounts 배열:`, createdAccounts);
  
  if (createdAccounts.length === 0) {
    console.log('❌ 테스트 계정 생성 실패. 테스트를 중단합니다.');
    return null;
  }
  
  // 전역 변수에 계정 정보 저장
  TEST_ACCOUNTS.push(...createdAccounts);
  console.log(`[DEBUG] TEST_ACCOUNTS 배열 상태:`, TEST_ACCOUNTS);
  
  return { 
    startTime: new Date(),
    testType: TEST_TYPE,
    config: currentConfig,
    accounts: createdAccounts
  };
}

export default function(data) {
  // setup에서 반환된 계정 정보 사용
  if (!data || !data.accounts || data.accounts.length === 0) {
    console.log(`❌ VU ${__VU}: 계정 정보를 찾을 수 없습니다`);
    return;
  }

  // VU 시작 시 로그인 (VU당 한 번만)
  if (!userTokens) {
    // VU별로 다른 계정 사용 (라운드 로빈 방식)
    const accountIndex = (__VU - 1) % data.accounts.length;
    const account = data.accounts[accountIndex];
    
    console.log(`[DEBUG] VU ${__VU}: 선택된 account =`, account);
    
    userTokens = performLogin(account);
    if (!userTokens) {
      console.log(`❌ VU ${__VU}: 로그인 실패, 테스트 중단`);
      return;
    }
    console.log(`✅ VU ${__VU}: 로그인 성공`);
  }
  
  // 시나리오 1: 만료된 Access Token으로 API 호출 (Refresh 필요)
  testExpiredTokenScenario(userTokens);
  
  // 시나리오 2: 동일한 Refresh Token으로 연속 호출 (캐시 테스트)
  testSameRefreshTokenScenario(userTokens);
  
  sleep(1);
}

function performLogin(account) {
  if (!account || !account.username) {
    console.log(`❌ VU ${__VU}: 유효하지 않은 계정 정보`);
    return null;
  }
  
  console.log(`VU ${__VU}: ${account.username}으로 로그인 시도`);
  
  // CookieJar 생성 (credentials: true 역할)
  const jar = http.cookieJar();
  
  try {
    const loginRes = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({
      username: account.username,
      password: account.password
    }), {
      headers: { 
        'Content-Type': 'application/json'
      },
      jar: jar, // credentials: true 효과
      tags: { 
        test_type: TEST_TYPE,
        scenario: 'login'
      }
    });
    
    loginCounter.add(1);
    
    const loginSuccess = check(loginRes, {
      '로그인 성공': (r) => r.status === 200,
      '로그인 응답시간 < 3초': (r) => r.timings.duration < 3000,
    });
    
    if (!loginSuccess) {
      console.log(`❌ VU ${__VU}: 로그인 실패 - Status: ${loginRes.status}, Body: ${loginRes.body}`);
      return null;
    }
    
    let accessToken = null;
    let refreshToken = null;
    
    // 1. 응답 본문에서 토큰 추출 (우선순위)
    try {
      const responseBody = JSON.parse(loginRes.body);
      accessToken = responseBody.accessToken;
      refreshToken = responseBody.refreshToken;
      
      if (accessToken && refreshToken) {
        console.log(`✅ VU ${__VU}: 응답 본문에서 토큰 획득 성공 (${account.username})`);
        return {
          accessToken: accessToken,
          refreshToken: refreshToken,
          username: account.username,
          jar: jar // CookieJar도 함께 반환
        };
      }
    } catch (e) {
      console.log(`VU ${__VU}: JSON 파싱 실패, Set-Cookie 헤더 확인`);
    }
    
    // 2. Set-Cookie 헤더에서 토큰 추출 (백업)
    const setCookieHeaders = loginRes.headers['Set-Cookie'] || loginRes.headers['set-cookie'] || [];
    const cookieArray = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    
    for (let cookieHeader of cookieArray) {
      if (typeof cookieHeader === 'string') {
        if (cookieHeader.includes('accessToken=')) {
          accessToken = extractCookieValue(cookieHeader, 'accessToken');
        } else if (cookieHeader.includes('refreshToken=')) {
          refreshToken = extractCookieValue(cookieHeader, 'refreshToken');
        }
      }
    }
    
    if (!accessToken || !refreshToken) {
      console.log(`❌ VU ${__VU}: 토큰 추출 실패`);
      console.log(`Response Body: ${loginRes.body}`);
      return null;
    }
    
    console.log(`✅ VU ${__VU}: Set-Cookie에서 토큰 획득 성공 (${account.username})`);
    
    return {
      accessToken: accessToken,
      refreshToken: refreshToken,
      username: account.username,
      jar: jar // CookieJar도 함께 반환
    };
    
  } catch (error) {
    console.log(`❌ VU ${__VU}: 로그인 중 오류 - ${error}`);
    return null;
  }
}

// 쿠키 값 추출 헬퍼 함수
function extractCookieValue(cookieHeader, cookieName) {
  const regex = new RegExp(`${cookieName}=([^;]+)`);
  const match = cookieHeader.match(regex);
  return match ? match[1] : null;
}

function testExpiredTokenScenario(tokens) {
  const testName = `${currentConfig.name} - 만료된 토큰 처리`;
  
  const startTime = new Date();
  
  // 의도적으로 만료된(잘못된) Access Token 사용하되, 유효한 RefreshToken은 jar에서 자동 전송
  const response = http.get(`${currentConfig.baseUrl}/api/v1/members/me`, {
    headers: {
      'Cookie': `accessToken=expired_token_${Date.now()}; refreshToken=${tokens.refreshToken}`
    },
    jar: tokens.jar, // credentials: true 효과 - 쿠키 자동 전송
    tags: { 
      test_type: TEST_TYPE,
      scenario: 'expired_token',
      username: tokens.username
    }
  });
  
  const endTime = new Date();
  const latency = endTime - startTime;
  
  // 메트릭 수집
  refreshTokenLatency.add(latency, { 
    test_type: TEST_TYPE,
    username: tokens.username 
  });
  
  // 응답 검증
  const isSuccess = check(response, {
    'response completed': (r) => r.status >= 200 && r.status < 500,
    // [`response time < ${currentConfig.expectedLatency * 2}ms`]: (r) => r.timings.duration < (currentConfig.expectedLatency * 2),
    'refresh token processed': (r) => {
      // 새로운 토큰이 Set-Cookie에 있거나 200 OK인지 확인
      const setCookieHeader = r.headers['Set-Cookie'] || r.headers['set-cookie'];
      const hasNewToken = setCookieHeader && (
        setCookieHeader.toString().includes('accessToken') || 
        setCookieHeader.toString().includes('refreshToken')
      );
      return hasNewToken || r.status === 200;
    }
  });
  
  // 성능 분석
  let performanceAnalysis = analyzePerformance(latency, TEST_TYPE);
  
  if (isSuccess) {
    console.log(`✅ VU ${__VU} (${tokens.username}): ${testName} 성공: ${latency}ms - ${performanceAnalysis}`);
  } else {
    console.log(`❌ VU ${__VU} (${tokens.username}): ${testName} 실패: ${latency}ms, Status: ${response.status}`);
  }
}

function testSameRefreshTokenScenario(tokens) {
  const results = [];
  
  // 같은 refresh token으로 3번 연속 호출
  for (let i = 0; i < 3; i++) {
    const startTime = new Date();
    
    const response = http.get(`${currentConfig.baseUrl}/api/v1/members/me`, {
      headers: {
        'Cookie': `accessToken=expired_token_${Date.now()}_${i}; refreshToken=${tokens.refreshToken}`
      },
      jar: tokens.jar, // credentials: true 효과
      tags: { 
        test_type: TEST_TYPE,
        scenario: 'same_token_repeat',
        username: tokens.username,
        call_number: i + 1
      }
    });
    
    const endTime = new Date();
    const latency = endTime - startTime;
    results.push(latency);
    
    refreshTokenLatency.add(latency, { 
      test_type: TEST_TYPE,
      username: tokens.username,
      call_sequence: i + 1
    });
    
    // 메트릭 업데이트 (캐시 효과 분석)
    updateCacheMetrics(i, latency);
    
    sleep(0.1); // 100ms 간격
  }
  
  // 캐시 효과 분석
  const cacheEffectiveness = analyzeCacheEffect(results);
  console.log(`VU ${__VU} (${tokens.username}) 연속 호출: ${results.join('ms, ')}ms - ${cacheEffectiveness}`);
}

function analyzePerformance(latency, testType) {
  if (testType === 'current') {
    if (latency > 500) {
      authCallsCounter.add(1);
      redisHitRate.add(false);
      return '예상대로 느림 (복잡한 락 로직)';
    } else {
      redisHitRate.add(true);
      return '예상보다 빠름 (캐시 히트?)';
    }
  } else if (testType === 'redis') {
    if (latency < 100) {
      redisHitRate.add(true);
      return '우수한 성능 (Redis 캐시 히트)';
    } else if (latency < 200) {
      authCallsCounter.add(1);
      redisHitRate.add(false);
      return '양호한 성능 (Auth 서비스 호출)';
    } else {
      authCallsCounter.add(1);
      redisHitRate.add(false);
      return '성능 문제 (예상보다 느림)';
    }
  } else if (testType === 'simple') {
    authCallsCounter.add(1);
    if (latency < 200) {
      return '양호한 성능 (락 제거 효과)';
    } else {
      return '여전히 느림 (Auth 서비스 부하)';
    }
  }
  return '분석 중';
}

function updateCacheMetrics(callIndex, latency) {
  if (callIndex === 0) {
    // 첫 번째 호출은 항상 Auth 서비스 호출
    authCallsCounter.add(1);
    redisHitRate.add(false);
  } else {
    // 두 번째, 세 번째 호출에서 캐시 효과 측정
    if (TEST_TYPE === 'redis' && latency < 100) {
      redisHitRate.add(true); // 캐시 히트
    } else {
      authCallsCounter.add(1);
      redisHitRate.add(false); // 캐시 미스
    }
  }
}

function analyzeCacheEffect(results) {
  const [first, second, third] = results;
  const improvement2nd = ((first - second) / first * 100).toFixed(1);
  const improvement3rd = ((first - third) / first * 100).toFixed(1);
  
  if (TEST_TYPE === 'redis') {
    if (second < first * 0.5 && third < first * 0.5) {
      return `캐시 효과 우수 (2nd: ${improvement2nd}% 개선, 3rd: ${improvement3rd}% 개선)`;
    } else if (second < first * 0.8 && third < first * 0.8) {
      return `캐시 효과 보통 (2nd: ${improvement2nd}% 개선, 3rd: ${improvement3rd}% 개선)`;
    } else {
      return `캐시 효과 미미 (2nd: ${improvement2nd}% 개선, 3rd: ${improvement3rd}% 개선)`;
    }
  } else {
    return `반복 호출 효과: 2nd(${improvement2nd}%), 3rd(${improvement3rd}%)`;
  }
}

export function teardown(data) {
  const endTime = new Date();
  const duration = (endTime - data.startTime) / 1000;
  
  console.log('=== 성능 테스트 완료 ===');
  console.log(`총 테스트 시간: ${duration}초`);
  console.log(`테스트 계정 수: ${TEST_ACCOUNTS.length}개`);
  console.log('상세 결과는 k6 리포트를 확인하세요.');
  
  // 결과 분석 가이드
  console.log('\n📊 결과 분석 가이드:');
  console.log('1. refresh_token_latency: Refresh 처리 시간 (사용자별)');
  console.log('2. auth_service_calls: Auth 서비스 실제 호출 횟수');
  console.log('3. redis_hit_rate: Redis 캐시 히트율');
  console.log('4. login_calls: 실제 로그인 시도 횟수');
  console.log('5. http_req_duration: 전체 요청 응답시간');
  
  console.log('\n🔍 개선사항:');
  console.log('- 실제 로그인을 통한 유효한 토큰 사용');
  console.log('- VU별 서로 다른 사용자 계정 분산');
  console.log('- 쿠키 기반 토큰 관리');
  console.log('- 사용자별 성능 분석');
}

/*
🧪 테스트 실행 방법:

1. 현재 로직 (복잡한 락) 테스트:
K6_WEB_DASHBOARD=true k6 run --env TEST_TYPE=complex memory_lock_test.js

2. Redis 캐싱 로직 테스트:
K6_WEB_DASHBOARD=true k6 run --env TEST_TYPE=redis api_gateway/memory_lock_test.js

3. 단순 로직 (락 제거) 테스트:
K6_WEB_DASHBOARD=true k6 run --env TEST_TYPE=simple api_gateway/memory_lock_test.js

4. 상세 리포트 생성 (사용자별 분석):
k6 run --env TEST_TYPE=redis --out json=redis-results.json k6-gateway-test-improved.js

5. 실시간 모니터링:
k6 run --env TEST_TYPE=redis --out influxdb=http://localhost:8086/k6 k6-gateway-test-improved.js

📊 예상 결과 비교 (실제 토큰 사용):

| 테스트 타입 | P95 응답시간 | Auth 호출율 | 캐시 히트율 | 로그인 성공률 |
|------------|------------|------------|------------|--------------|
| current    | ~800ms     | 100%       | 0%         | 95%+         |
| simple     | ~100ms     | 100%       | 0%         | 95%+         |
| redis      | ~30ms      | 20%        | 80%        | 95%+         |

🎯 개선 확인 포인트:
1. 실제 사용자 시나리오 반영
2. VU별 독립적인 사용자 세션
3. 토큰 갱신 과정의 정확한 측정
4. 캐시 효과의 실제 검증

⚠️ 주의사항:
- TEST_ACCOUNTS 배열에 실제 테스트 계정 정보 입력 필요
- 각 계정은 테스트 전에 미리 생성되어 있어야 함
- 동시 사용자 수가 계정 수보다 많으면 계정 재사용됨
- 서버의 동시 로그인 제한 정책 고려 필요

🔧 계정 관리:
- 계정별로 독립적인 refresh token 생성
- VU 종료 시 로그아웃 처리 (필요시)
- 계정 풀 관리로 확장 가능
- 실제 운영 환경과 유사한 토큰 라이프사이클 테스트
*/