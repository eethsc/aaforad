# FUSION Analog Agent Studio

아날로그 회로 설계를 위한 LLM-agent 실행 엔진과 그 웹 관측 화면입니다. 사양 입력에서 시작해 GraphRAG 근거 탐색, Architect→Planner→Critic→Verifier 루프, 토폴로지 탐색, 역할 기반 사이징, 수치 검증, 넷리스트·테스트벤치 내보내기까지 실행합니다.

> 연구용 설계 엔진입니다. OpenRouter LLM agent loop, GraphRAG, PUCT·ParEGO·SymPy 검증은 실제 실행됩니다. ngspice/PDK가 없는 경우의 성능 평가는 해석적 surrogate입니다. 제조 또는 테이프아웃 전에 자격을 갖춘 PDK와 독립적인 SPICE/사인오프 검증이 반드시 필요합니다.

## 실행

Node.js 20 이상만 있으면 됩니다. 별도 패키지 설치가 필요하지 않습니다.

```powershell
npm start
```

브라우저에서 [http://localhost:4173](http://localhost:4173)를 엽니다.

개발 중 자동 재시작:

```powershell
npm run dev
```

검증:

```powershell
npm run check
npm test
```

## 구현된 설계 흐름

| 단계 | UI / 서버 구현 | 연구 패턴 |
| --- | --- | --- |
| Grounding | 논문 요약을 paper/claim/concept 그래프로 구성해 경로 기반 evidence를 회수하고, component×node 이분 incidence matrix 생성 | AaLLM, ATLAS |
| Topology exploration | 실제 LM-prior PUCT 트리 탐색, partial beam completion, p-filter 자동 커밋 | EXPLORE |
| Sizing | Planner가 역할을 선택하고 role-sizer가 허용된 변수만 변경, ParEGO/RBF-LCB 탐색 | AgenticSizing, ATLAS |
| Review loop | 역할별 상태와 재사용 가능한 sizing heuristic 기록 | AaLLM, AgenticSizing |
| Verification | PDG 실행 순서, 별도 SymPy 프로세스 수치 오라클, closed-loop repair | AnalogVerifier |
| Deliverables | SPICE 넷리스트, testbench skeleton, 역할별 변수, 다운로드 | ATLAS, AnalogVerifier |

현재 지원 템플릿은 2-stage OTA, LDO, 8-bit SAR ADC입니다. 자유형 LLM 넷리스트 생성을 허용하지 않으며, 선택된 검증 템플릿과 동일한 결과만 생성합니다. local feasibility guard를 포함한 모든 수치 제약을 통과한 결과만 내보냅니다.

## LLM Agent와 GraphRAG

기본 실행 모드는 OpenRouter API 키를 요구합니다. 서버는 `analog_design_agentic_ai_papers.md`를 paper/claim/concept 노드와 공유 개념 edge로 구성한 GraphRAG로 바꾸고, Architect가 회로군을 선택한 뒤 Planner, Critic, Verifier가 각각 JSON action을 반환합니다. LLM이 없으면 production design run을 거부합니다. `FUSION_REQUIRE_LLM=false`은 네트워크 없는 단위 테스트에서만 사용하는 명시적 우회입니다.

서버에는 선택적 LLM planning adapter를 준비해 두었습니다. LLM 출력은 `targetRole`과 제한된 scale 값으로 된 구조화 action으로 파싱한 뒤, 허용된 역할·범위인지 검증될 때만 local sizing 단계에 반영합니다. 토폴로지 잠금과 넷리스트 생성 권한은 LLM에 주지 않습니다. 클라이언트 JavaScript에는 API 키가 전달되지 않으며, 서버 프로세스만 환경변수를 읽습니다.

## 실제 LLM 연결 준비

`.env.example`을 `.env`로 복사하고 다음 값을 설정합니다.

```dotenv
FUSION_REQUIRE_LLM=true
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/auto
```

`server.mjs`는 의존성 없이 `.env`를 읽으며, 키가 없거나 LLM agent가 실패하면 설계 run을 실패 처리합니다. 키는 절대로 `public/` 파일, 브라우저 콘솔, 응답 JSON에 노출되지 않습니다.

OpenRouter의 OpenAI-compatible Chat Completions API를 서버에서만 호출합니다. API 키는 환경변수 또는 비밀 관리 서비스에 보관해야 하며, OpenRouter는 `response_format`으로 구조화 JSON 출력을 지원합니다.

## 실제 시뮬레이터 연결을 위한 준비

현재 버전은 실행 시 `ngspice -v`를 감지하고, 설치되어 있으면 생성된 deck을 batch mode로 호출해 `.meas` 결과를 수집합니다. 이 폴더에는 PDK가 없으므로 현 환경에서는 surrogate 모드가 정상입니다. Cadence adapter는 별도의 상용 런타임 연결이 필요합니다.

- **ngspice**: `NGSPICE_PATH`에 실행 경로를 설정하고, 실제 PDK model include 경로를 공급해야 합니다.
- **Cadence**: 유효한 Virtuoso/Maestro 설치 및 라이선스, `CADENCE_PROJECT_DIR`, 쓰기 가능한 `AGENTIC_SIZING_CADENCE_WORK_ROOT`가 필요합니다.
- **OpenRouter agent loop**: 위의 `OPENROUTER_API_KEY`, 사용 가능한 `OPENROUTER_MODEL`이 필요합니다.

이 구조는 [agentic-analog-sizing](https://github.com/aprilaihub/agentic-analog-sizing)의 mock/real adapter 분리와 역할 기반 workflow, 그리고 [AaLLM](https://anonymous.4open.science/r/AaLLM/README.md)의 사양→토폴로지→사이징 폐루프를 참고해 독립적으로 구현했습니다. 외부 저장소 코드를 복사하거나 실행하지 않습니다.

## 주요 파일

| 파일 | 역할 |
| --- | --- |
| `server.mjs` | 표준 Node 서버, API, 설계 orchestration, 캐시, optional LLM adapter |
| `engine/graphrag.mjs` | paper/claim/concept evidence graph와 path-aware retrieval |
| `engine/openrouter.mjs` | 필수 OpenRouter Architect/Planner/Critic/Verifier agent client |
| `engine/mcts.mjs` | EXPLORE 방식 PUCT, p-filter, partial completion |
| `engine/parego.mjs` | ATLAS 방식 다목적 ParEGO/RBF-LCB 최적화 |
| `engine/symbolic_oracle.py` | AnalogVerifier 방식 SymPy 수치 오라클 |
| `engine/simulator.mjs` | 실제 ngspice batch adapter 및 측정 파서 |
| `public/index.html` | 단일 페이지 GUI |
| `public/styles.css` | 반응형 회로 설계 워크벤치 디자인 |
| `public/app.js` | 입력, 실행, 그래프·회로·아티팩트 렌더링 |
| `test/server.test.mjs` | 입력 정규화, 설계 결과, HTTP API 테스트 |
| `.env.example` | 선택적 LLM / simulator 연결 변수 |
