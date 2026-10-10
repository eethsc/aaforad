# Agentic AI 기반 아날로그 회로 설계 및 검증 논문 종합 분석 보고서

본 보고서는 Agentic AI 및 대형 언어 모델(LLM)을 활용한 아날로그 회로 설계 및 검증 분야의 주요 논문 5편에 대해 각 논문의 **도입 및 연구 배경(Introduction)**, **제안 기술(Proposed Technology)**, 그리고 **구현 방식 및 평가(Implementation & Evaluation)**를 체계적으로 정리하고 비교 분석한 결과를 담고 있습니다.

---

## 1. 논문별 핵심 요약 비교

| 논문 / 프레임워크 | 대상 분야 | 주요 제안 기술 | 주요 구현 및 기법 | 주요 성과 |
| :--- | :--- | :--- | :--- | :--- |
| **AaLLM** [45] | 엔드투엔드 아날로그 회로 생성 및 사이징 | Seq2Seq 토폴로지 생성, RAG 지식 확장, Tri-Agent 사이징 루프 | Bipartite 행렬 표현, FLAN-T5-base, Claude Haiku/Sonnet, SPICE 연동 [51, 54, 55] | SPICE 호출 3~4.5배 감소, 소요시간 40배 단축, 91.6% 수율 [45, 49, 50] |
| **EXPLORE** [18] | 아날로그 회로 토폴로지 생성 | MCTS 기반 테스트 타임 스케일링, Structured-Token Filtering ($p$-filtering) | Transformer LM priors + PUCT MCTS, NGSPICE 시뮬레이터 연동 [20, 21, 23] | 6-component 성공률 12%→65% 향상, MSE 20배 이상 감소 [18, 20] |
| **AgenticSizing** [60] | 고차원/복잡 아날로그 회로 사이징 | 2단계 회로 구조 분해, 1+N Planner-Sizers 협업, 4가지 관점 지식 추출 | LLM Decomposer, Cadence Spectre, GPT-5.2 기반 LangGraph [66, 67, 70, 71] | LDO(55 트랜지스터, 60 변수) 성공률 60% 달성 (기존 최적화기 실패) [60, 61] |
| **ATLAS** [35] | SAR ADC 아날로그/혼성신호 설계 | 3단계 Agentic 프레임워크, 템플릿 제약 넷리스트 생성, Multi-Objective BO | RAG 기반 계획, Two-winged 넷리스트 생성, BoTorch / qParEGO 최적화 [37, 40, 43] | 환각/물리적 오류 차단, 8-bit SAR ADC 엔드투엔드 합성 성공 [35, 43, 44] |
| **AnalogVerifier** [1] | 아날로그 회로 자동 검증 (Testbench) | Context-Aware Task Serialization, Graph-Symbolic Scheduling, SymPy Oracle | Port Dependency Graph (PDG), SymPy 기호 연산, Closed-Loop Repair [3, 7, 8, 10] | 5개 산업용 회로 대상 82.3%~100% 검증 통과율 달성 [1, 3, 13] |

---

## 2. 논문별 세부 분석

### 2.1. AaLLM (An End-to-End Analog Circuit Design Framework)

#### 1) 도입 및 연구 배경 (Introduction)
* 기존 LLM 기반 아날로그 회로 설계 방식은 회로 사이징(Sizing)이나 토폴로지 생성(Topology Generation) 중 어느 한 부분에만 치우친 파편화된 해결책을 제공함 [45].
* 기술적 지식을 수동으로 입력해야 하여 효율성이 떨어지고, 회로 사이징 과정에서 환각(Hallucination)이 빈번하게 발생함 [45].
* 다양한 성능 사양(Specs) 간의 트레이드오프 처리 과정이 지루한 반복 작업이며, 기존 관행적 토폴로지에만 의존하여 혁신적인 신규 회로 토폴로지를 생성하지 못하는 한계가 존재함 [45].

#### 2) 제안 기술 핵심 (Proposed Technology)
* **엔드투엔드 멀티에이전트 워크플로우**: 사용자 사양 입력부터 토폴로지 생성, 선택, 회로 사이징 및 최종 넷리스트 출력을 단일 통합 파이프라인으로 구현함 [45, 50].
* **Bipartite Matrix 회로 표현법**: 회로를 부품(Component)과 노드(Node) 간의 연결을 나타내는 이분 그래프 matrix $B \in \mathbb{R}^{|C| \times |N|}$ 로 표현하여, 포맷 고정 및 위치 인식 제약 하에서 파라메트릭한 생성이 가능하도록 함 [51].
* **Seq2Seq 기반 신규 토폴로지 생성**: fine-tuning된 파인튜닝 모델을 활용하여 전통적 회로뿐만 아니라 학술 문헌에 존재하지 않는 전기적으로 유효한 신규(Novel) 토폴로지를 창출함 [45, 47, 48].
* **RAG (Retrieval-Augmented Generation) 모듈**: 회로 교재(Razavi 등) 및 학술 논문 DB를 자율적으로 확장 및 탐색하여, 토폴로지 선택 및 사이징 단계에서 이론적 근거를 제공함 [45, 46, 50, 55].
* **Tri-Agent 사이징 루프**: 회로 파라미터를 설정하는 **Designer**, 이를 검증 및 진단하는 **Critic**, 전략을 결정하여 사이징 반복 횟수를 최소화하는 **Evaluator** 간의 협업 체계를 구축함 [45, 47, 54].

#### 3) 구현 방식 및 평가 (Implementation & Evaluation)
* **모델 구성**: 토폴로지 생성에는 FLAN-T5-base(Constrained decoding)를 사용하고, 토폴로지 선택에는 Claude Haiku 4.5, Tri-Agent 사이징 및 지식 추출에는 Claude Sonnet 4.6을 적용함 [54, 55].
* **공정 및 대상 회로**: 130nm SkyWater 공정 노드 기반으로 연산증폭기(OPAMP) 및 필터 회로를 대상으로 검증함 [57].
* **성능 결과**: 기존 최적화 방식 대비 SPICE 시뮬레이션 호출 횟수를 3배~4.5배 감소시켰으며, Wall-clock time을 40배 단축함 [45, 49, 59]. 신규 토폴로지 생성 시 FoM(Figure of Merit)이 기존 대비 최대 3배 향상됨 [45, 49].

---

### 2.2. EXPLORE (Search-Enhanced LM Framework for Topology Generation)

#### 1) 도입 및 연구 배경 (Introduction)
* 아날로그 회로 토폴로지 자동 생성 시, 기존의 단일 패스(One-shot) 언어 모델 생성 방식은 회로 복잡도가 증가함에 따라 탐색 공간이 지수적으로 증가하여 실패율이 급격히 높아짐 [18, 19].
* 시뮬레이터(NGSPICE) 호출 비용이 매우 비싸기 때문에(1회당 수초~수분 소요), 무작위 샘플링이나 단일 생성 방식으로는 고복잡도 회로 생성이 불가능함 [18, 21].

#### 2) 제안 기술 핵심 (Proposed Technology)
* **LM-Guided MCTS (Monte Carlo Tree Search)**: 언어 모델의 예측 확률(Action Prior)을 PUCT 스타일의 MCTS 선택 단계에 결합하여 테스트 타임 스케일링(Test-time scaling)을 실현함 [18, 22, 23].
* **Structured-Token Filtering ($p$-filtering)**: 회로의 인접 행렬 텍스트 표현 중 구문적/구조적 토큰(Structural tokens)은 유용한 토폴로지 결정 기능을 하지 않으므로, 모델 예측 확률이 $p \ge 0.99$ 인 고확신 토큰은 자동 커밋(Auto-commit)하여 시뮬레이션 예산을 아낌 [18, 20, 23]. (전체 수순 중 24%~48%의 불필요한 시뮬레이션 시도를 생략함) [20].
* **Partial Topology Beam Completion**: 미완성 회로 상태에서 빔 탐색(Beam search)을 통해 완전한 회로를 완성한 후 시뮬레이션 평가를 수행함 [21, 22].
* **2단계 데이터셋 구축**: 무작위 열거 피드백 데이터 생성 후, 탐색 체계 자체를 데이터 수집 엔진으로 사용하여 고품질 회로 데이터셋을 확장함 [20, 25].

#### 3) 구현 방식 및 평가 (Implementation & Evaluation)
* **시뮬레이터 연동**: NGSPICE 연동 및 Caching 기법을 적용하여 평균 시뮬레이션 수행 시간을 관리함 [21, 27].
* **성능 결과**: 6-component 전력 변환기 벤치마크(오차 허용오차 0.01)에서 성공률을 기존 One-shot(12%) 및 Sampling+Filtering(33%) 대비 **65%**로 대폭 향상시켰으며, MSE를 20배 이상 감소시킴 [18, 20].
* **스케일링**: 기존 3~6 개 부품 수준을 넘어 7~10 개 부품을 가진 고복잡도 아날로그 회로 토폴로지 생성까지 성공적으로 확장함 [20, 30].

---

### 2.3. AgenticSizing (Multi-Agent Framework for Analog Circuit Sizing)

#### 1) 도입 및 연구 배경 (Introduction)
* 아날로그 회로 사이징은 비선형적이고 고차원적인 탐색 공간 및 엄격한 성능 트레이드오프 때문에 매우 많은 시간이 소요됨 [60].
* 기존 단순 LLM 방식이나 블랙박스 최적화기(DE, BO)는 회로 토폴로지에 대한 명시적 이해가 부족하여 복잡한 회로(예: LDO)에서 최적화에 실패하거나 샘플 효율성이 떨어짐 [60, 61, 72].

#### 2) 제안 기술 핵심 (Proposed Technology)
* **2단계 회로 구조 분해 (Two-step Decomposition)**: 
  1) **Functional Role Tags**: 회로 넷리스트를 주 신호 경로, 바이어스 네트워크, 피드백 네트워크, 출력 단 등 고수준 기능 역할로 분할함 [64, 66].
  2) **Substructure Tags**: 각 역할을 정규화된 온톨로지(Differential pair, Current mirror, Cascode 등)로 정밀하게 태깅함 [64, 66].
* **1+N Planner-Sizer 협업 구조**: 
  - **High-Level Planner**: 시뮬레이션 결과를 바탕으로 미충족 사양을 진단하고, 특정 역할과 목표 지표를 선택하여 담당 Sizer에게 지시를 전달함 [64, 67, 69].
  - **Role-Specific Sizers**: 자신이 할당받은 회로 역할에 속한 소자 변수만 한정하여 최적의 파라미터 변경안을 제안함 [64, 67, 68].
* **4가지 관점의 지식 추출 (Knowledge Base)**: 최적화 과정에서 얻은 경험을 성능 결합, 핵심 파라미터, 역할-성능 영향력, 전이 가능한 휴리스틱 등 4가지 구조화된 지식 뷰로 저장하여 재사용함 [65, 70].

#### 3) 구현 방식 및 평가 (Implementation & Evaluation)
* **시뮬레이터 및 모델**: Cadence Spectre 시뮬레이터와 백본 언어모델 GPT-5.2(LangGraph 프레임워크 기반)를 결합함 [71].
* **벤치마크 및 결과**: 최대 55개 트랜지스터와 60개 변수를 가진 LDO(Low-Dropout Regulator)를 포함한 8개 회로에서 평가함 [60].
* **성능 성과**: 기존 최적화기(DE, BO, MARL)가 6시간 시간 제한 내에 모두 실패한 LDO 벤치마크에서 **60% 성공률** 및 평균 83~90회 시뮬레이션 내 최적화 성공을 달성함 [60, 61, 71].

---

### 2.4. ATLAS (Agentic Template-Constrained ADC Synthesizer)

#### 1) 도입 및 연구 배경 (Introduction)
* 아날로그 EDA 분야에서 LLM을 직접 프롬프팅하여 제약 없이 회로 넷리스트를 생성(Unconstrained generation)하게 할 경우, 연결 오류 및 물리적으로 불가능한 구조 등 심각한 환각이 발생함 [34, 35, 37].
* 특히 SAR ADC와 같은 복잡한 혼성신호 아날로그 블록을 안정적으로 합성하기 위한 가이드라인이 필요함 [34, 35].

#### 2) 제안 기술 핵심 (Proposed Technology)
* **3단계 agentic 프레임워크 구조**:
  - **Stage 1 (Grounding in Expert Knowledge)**: 논문 DB에서 k-NN(k=5) 검색 및 LLM 요약을 통해 목표 사양에 맞는 전문가 지식 및 가이드 플랜을 생성함 [37, 38, 43].
  - **Stage 2 (Netlist Generation - Two-Winged Architecture)**: 
    - *Wing 1*: 규칙 기반 검증 엔진을 동반한 Grounded Zero-shot 생성 [40, 41].
    - *Wing 2 (Fallback)*: 템플릿 제약 기반 생성(Template-constrained generation)으로, 전문가가 검증한 서브블록(StrongArm latch, Miyahara comparator, DAC array 등) 템플릿을 선택 및 수정하여 결합함 [40, 41, 43].
    - Integrator, Testbench Creator, Debugger LLM 간 루프를 통한 자율 디버깅 [41, 42].
  - **Stage 3 (Netlist Sizing and Optimization)**: Sizer LLM이 가변 파라미터 범위를 추출하고 Multi-Objective Bayesian Optimization (qParEGO, BoTorch, Sobol 초기화)을 결합하여 정밀 사이징 수행 [41, 42, 43].

#### 3) 구현 방식 및 평가 (Implementation & Evaluation)
* **구현 세부사항**: BoTorch 기반 Bayesian Optimization과 SPICE 시뮬레이션 연동 루프 구축 [43].
* **성능 결과**: 8-bit SAR ADC에 대한 엔드투엔드 자동 합성을 성공적으로 시연하였으며, 물리적 환각을 원천 차단하고 높은 신뢰성의 회로 합성을 달성함 [35, 43, 44].

---

### 2.5. AnalogVerifier (Neuro-Symbolic Framework for Analog Verification)

#### 1) 도입 및 연구 배경 (Introduction)
* 아날로그 회로 검증(Verification)은 전체 엔지니어링 주기의 50% 이상을 소비하는 심각한 병목 구간임 [1].
* 기존 수동 작업은 비구조적이고 이질적인 사양서 문서 해석에 과도한 노력이 들며, 일반적인 LLM 적용 시 시간에 따른 동작 순서 오류(Temporal scheduling error) 및 수치적 환각(Numerical hallucination)이 빈번함 [1, 6].

#### 2) 제안 기술 핵심 (Proposed Technology)
* **Neuro-Symbolic 패러다임**: LLM의 유연한 자연어 해석 능력과 심볼릭(Symbolic) 제약 조건의 엄격한 결정론적 논리를 결합함 [1, 6].
* **Context-Aware Task Serialization (Stage 0-2)**: 비구조적 문서 사양서를 에이전틱 워크플로우를 통해 독립된 원자적(Atomic) 제약 단위 및 문서 DB로 변환함 [1, 3, 7].
* **Graph-Symbolic Scheduling (Stage 3)**: 포트 간 물리적 우선순위를 인코딩한 **Port Dependency Graph (PDG)**를 구축하고, 위상 정렬(Topological Sort)을 통해 시간적 인과성이 보장된 자극(Stimulus) 스케줄을 도출함 [1, 3, 8].
* **Numerical-Symbolic Grounding (Stage 4)**: 문맥에서 추출한 매개변수를 SymPy 기반 심볼릭 오라클(Symbolic Oracle)로 전달하여 수치적 임계값 및 공차를 정확히 계산하여 수치 환각을 완전히 배제함 [1, 3, 8, 9].
* **Closed-Loop Repair (Stage 5)**: 시뮬레이션 피드백 기반 디버깅 루프를 작동하여 구문 오류, 수렴 오류(스케줄 완화), 문턱값 불일치(SymPy 오라클 재검증)를 자율 수정함 [1, 10, 11].

#### 3) 구현 방식 및 평가 (Implementation & Evaluation)
* **구현 세부사항**: SymPy 심볼릭 엔진, RAG 구조화 문서 DB, SPICE 시뮬레이터 연동 파이프라인 구축 [3, 8, 9, 10].
* **성능 결과**: 5개 산업용 아날로그 회로 벤치마크 평가 결과 **82.3% ~ 100% 기능적 패스율(Functional Pass Rate)**을 달성하여 수동 검증 비용을 혁신적으로 절감함 [1, 3, 13].

---

## 3. 결론 및 종합 시사점

1. **상호보완적 프레임워크 발전**:
   - **토폴로지 생성**: EXPLORE의 MCTS/p-filtering 기법과 AaLLM의 Seq2Seq 이분 행렬 기법은 아날로그 회로 탐색 공간의 지수적 폭발 문제를 해결함 [18, 51].
   - **회로 사이징**: AgenticSizing의 역할/구조 분해 체계와 ATLAS의 Bayesian Optimization 연동은 고차원 변수 최적화에서 샘플 효율성을 대폭 끌어올림 [43, 60, 66].
   - **회로 검증**: AnalogVerifier의 Neuro-Symbolic 접근법은 LLM의 환각을 기호 수학(SymPy) 및 그래프 이론(PDG)으로 보완함 [1, 3, 8].

2. **향후 연구 방향**:
   - 아날로그/혼성신호(AMS) 회로 설계 자동화는 단일 생성(One-shot) 방식에서 **에이전틱 협업(Multi-agent)**, **심볼릭 연동(Neuro-symbolic)**, 그리고 **시뮬레이션 피드백 루프(Closed-loop simulation)**를 결합하는 방향으로 빠르게 진화하고 있음 [3, 11, 47, 60].
