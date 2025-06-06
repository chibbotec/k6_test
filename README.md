# k6_test
## 1. API gateway 캐싱 변경
### 테스트 내용
JVM 내부 메모리 락 -> Redis 락으로 변경

### 주요 테스트 결과
<li><strong>처리량 크게 개선:</strong> Request Rate가 15.9/s에서 37.7/s로 137% 증가하여 시스템의 처리 능력이 크게 향상됨</li>
                <li><strong>대시보드 응답성 개선:</strong> 대시보드에서 보이는 HTTP Request Duration이 1s에서 177ms로 82% 개선됨</li>
                <li><strong>혼재된 지연 시간:</strong> 평균 응답시간은 개선되었지만, 일부 고백분위수(p90, p95)에서는 지연이 증가함</li>
                <li><strong>네트워크 효율성:</strong> 데이터 수신/송신 속도가 모두 증가하여 전반적인 네트워크 활용도가 개선됨</li>
                <li><strong>시스템 안정성:</strong> 두 테스트 모두 동일한 실패율(1/s)을 유지하여 안정성은 변화 없음</li>
                <li><strong>성능 트레이드오프:</strong> 높은 처리량을 달성했지만 일부 극단적인 케이스에서는 지연시간이 증가하는 트레이드오프 발생</li>
            </ul>

### [👉 상세 결과 보기](./api_gateway/result.md)