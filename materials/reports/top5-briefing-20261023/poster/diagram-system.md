# 시스템 구성도 · 순위 산출과 설명 생성의 분리

현재 동작 기준은 [루트 README](../../../../README.md), [모델 manifest](../../../../models/final_rank_ensemble/manifest.json), [API 계약](../../../../FE/docs/api-contract.md)이다. 과거 [서비스 설계 문서](../../SERVICE_ARCHITECTURE_DESIGN.md)의 상승확률·뉴스 결합 순위·Naver 경로를 현재 구조로 옮기지 않는다.

```mermaid
flowchart LR
  subgraph Sources[데이터 수집]
    PYKRX["pykrx<br/>종목 OHLCV · 후보 풀"]
    KIS["KIS<br/>지수 일봉 · 시세 · 야간선물 · 업종<br/>수급은 실전 출처 미확인"]
    YAHOO["Yahoo Finance<br/>국내외 지수 · 환율 · 금리"]
    RSS["Google News RSS<br/>기사 제목 · 링크 · 출처 · 시각"]
  end

  subgraph Pipeline[Python 파이프라인]
    IDX["지수 이력 캐시<br/>KOSPI · KOSPI200<br/>최근 구간 정정 · 증분 갱신"]
    INPUT["공통 유효 모집단 · 완료 거래일<br/>종목 특징 + 국내 지수 특징<br/>학습 시 고정 스케일러"]
    TRANS["Transformer 20일 / 120일<br/>seed별 당일 순위 표준화<br/>기간별 평균 → 50:50 평균"]
    RANK["원본 전체 순위 · TOP5<br/>model_id / rank_score / pred_rank<br/>순위 산출물 저장"]
    NEWS["고정 TOP5 관련 기사 수집<br/>미수집 · 실패 · 성공 0건 구분"]
  end

  subgraph Server[서버 API · 검증 · 캐시]
    READ["완료 실행 · 모델 · 날짜 · 순위 일관성 검증<br/>원본 순서 고정"]
    BUDGET["KIS 프로세스 공통 스로틀<br/>진행 중 요청 병합 · 지수 캐시<br/>야간선물 / 업종 SWR"]
    FACT["설명용 관측 사실<br/>매크로 시각 · 장 상태<br/>종목별 규칙 근거 · 주의 · 기사 ID"]
    GET["GET /api/briefing<br/>TOP5 + 사실 + 캐시 설명<br/>Gemini 호출 없음"]
    POST["POST /api/briefing/narrative<br/>Gemini 입력 사실 요약"]
    GUARD["서버 검증기<br/>스키마 · 순서 · 날짜 · 수치 · 단위 · 인용<br/>금지 표현 검사 · 실패 필드만 규칙 대체"]
    NCACHE["설명 캐시<br/>실행 / 입력 해시 · 매크로 스냅샷<br/>실패 시 이전 검증 설명 · 오래됨 표시"]
    REF["나스닥-코스피 저장 참고 통계<br/>동일 비중 후보 구성<br/>Gemini 입력에서 제외"]
  end

  subgraph View[React 화면]
    UI["종합 브리핑 · 시장 지표 · 참고 통계<br/>원본 TOP5 · 근거 / 주의 · 종목 리포트<br/>출처 · 시각 · 실패 / 결측 표시"]
  end

  KIS --> IDX
  IDX --> INPUT
  PYKRX --> INPUT
  INPUT --> TRANS --> RANK --> READ
  READ --> GET
  READ --> NEWS
  RSS -.-> NEWS
  NEWS -.-> FACT
  READ -.-> FACT
  KIS -.-> BUDGET
  BUDGET -.-> FACT
  YAHOO -.-> FACT
  FACT -.-> GET
  FACT -.-> POST
  POST -.-> GUARD -.-> NCACHE -.-> GET
  REF -.-> GET
  GET --> UI
```

**실선:** 모델 입력 → 고정 순위 → 검증 → 화면의 순위 경로. **점선:** 수집 사실 → 설명·검증·캐시 → 화면의 설명 경로다. 외부 데이터 수집 자체가 모델 재학습이나 재정렬을 뜻하지 않는다. 설명 경로에서 Transformer나 원본 순위로 되돌아가는 연결은 없다.

국내 KOSPI·KOSPI200의 과거 특징은 이미 모델 입력에 들어간다. 추가 매크로 관측·최신 RSS 기사·Gemini 설명을 원본 순위 점수에 더하지 않는다는 의미다. 모델 기간·결합 가중치 근거: [manifest](../../../../models/final_rank_ensemble/manifest.json). 고정 TOP5·기사·검증 경로 근거: [API 계약](../../../../FE/docs/api-contract.md).

KIS 이력 캐시는 Python 경로이고 스로틀·SWR는 Node 경로다. 이 그림의 Node 공통 스로틀이 Python·다른 프로세스까지 합산 제어한다는 의미는 아니다. 업종은 미확인 시 null이고 수급 실전 출처는 별도 확인이 남아 있다. 근거: [API 계약](../../../../FE/docs/api-contract.md), [업종 진단](../sector-diagnostic.json), [이번 검증 한계](../README.md).

포스터 캡션: **모델 순위는 고정하고, 설명은 출처·시각·검증 결과와 함께 제공한다.** 수집·화면 연결의 동작 검증과 모델의 미래 예측 성능 검증을 구분한다.
