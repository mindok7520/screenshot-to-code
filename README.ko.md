# Screenshot to Code 로컬 실행 가이드

이 문서는 이 저장소를 로컬에서 실행하는 방법과 이미지 업로드 후 코드가 생성되는 내부 파이프라인을 설명합니다. 현재 이 분기는 OpenAI API 키 입력 대신 로컬 Codex/ChatGPT 계정 로그인 정보를 사용합니다.

## 주요 기능

- 스크린샷, 디자인 이미지, 텍스트 프롬프트, 화면 녹화를 코드로 변환합니다.
- 지원 스택은 HTML + Tailwind, HTML + CSS, React + Tailwind, Vue + Tailwind, Bootstrap, Ionic + Tailwind입니다.
- Settings 화면에서 ChatGPT 계정으로 로그인한 뒤, 계정에 노출되는 모델 목록을 불러와 모델과 reasoning effort를 선택합니다.
- 현재 UI에서 노출하는 ChatGPT 계정용 모델은 `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`이며 effort는 `low`, `medium`, `high`, `xhigh`입니다.

## 실행 전 준비

- Python 3.10 이상
- Node.js와 `pnpm`
- 브라우저에서 로그인 가능한 ChatGPT 계정

이 분기는 API 키 대신 Codex가 저장하는 ChatGPT 로그인 토큰을 사용합니다. 로그인 정보는 기본적으로 `C:\Users\<사용자>\.codex\auth.json`에 저장됩니다.

## 백엔드 실행

PowerShell 기준:

```powershell
cd C:\Users\jaemin.shin\Desktop\git\codex\target_repo\screenshot-to-code\backend
poetry install
poetry run uvicorn main:app --host 127.0.0.1 --port 7001
```

이미 `.venv`가 만들어져 있다면 다음처럼 바로 실행할 수 있습니다.

```powershell
cd C:\Users\jaemin.shin\Desktop\git\codex\target_repo\screenshot-to-code\backend
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 7001
```

백엔드 기본 주소는 `http://127.0.0.1:7001`입니다.

## 프론트엔드 실행

```powershell
cd C:\Users\jaemin.shin\Desktop\git\codex\target_repo\screenshot-to-code\frontend
pnpm install
pnpm exec vite --host 127.0.0.1 --port 5173
```

5173 포트가 이미 사용 중이면 다른 포트를 지정합니다.

```powershell
pnpm exec vite --host 127.0.0.1 --port 5177
```

브라우저에서 `http://127.0.0.1:5173/` 또는 지정한 포트의 URL을 엽니다.

## ChatGPT 계정 로그인

1. 백엔드와 프론트엔드를 모두 실행합니다.
2. 앱 왼쪽의 Settings를 엽니다.
3. Codex Account 섹션에서 `Sign in with ChatGPT`를 누릅니다.
4. 열린 브라우저 창에서 ChatGPT 계정 로그인을 완료합니다.
5. Settings 화면에 `Connected`가 표시되면 모델 목록이 자동으로 로드됩니다.
6. `Model`과 `Reasoning`을 선택한 뒤 generate를 실행합니다.

로그아웃은 같은 섹션의 `Sign out` 버튼을 사용합니다.

## 생성 파이프라인

### 1. 프론트엔드 요청

프론트엔드는 사용자가 업로드한 이미지, 선택한 코드 스택, 모델 설정, 기존 코드 상태를 모아 WebSocket으로 보냅니다.

- 진입점: `frontend/src/generateCode.ts`
- WebSocket 주소: `ws://127.0.0.1:7001/generate-code`
- Settings의 모델 선택값은 `codeGenerationModel`로 백엔드에 전달됩니다.

### 2. WebSocket 초기화

백엔드는 `/generate-code` WebSocket을 열고 요청 파라미터를 받습니다.

- 진입점: `backend/routes/generate_code.py`
- 단계: `WebSocketSetupMiddleware`

### 3. 파라미터 추출과 인증 확인

`ParameterExtractionStage`가 요청 값을 검증합니다.

- 코드 스택과 입력 모드를 검증합니다.
- 로컬 Codex/ChatGPT 로그인 파일에서 access token과 계정 헤더를 읽습니다.
- 선택한 모델 문자열을 `Llm` enum으로 변환합니다.
- 지원하지 않는 모델이면 기본값 `gpt-5.5 (high thinking)`으로 되돌립니다.

### 4. 상태 브로드캐스트

프론트엔드에 variant 개수와 `Generating code...` 상태를 보냅니다.

- 단계: `StatusBroadcastMiddleware`
- create 작업은 여러 variant를 만들고, update 작업은 지연과 비용을 줄이기 위해 더 적은 variant를 사용합니다.

### 5. 프롬프트 생성

`PromptCreationStage`가 업로드 이미지, 텍스트, 기존 코드, 선택 스택을 모델 입력 메시지로 변환합니다.

- 프롬프트 생성: `prompts/pipeline.py`
- 이미지와 업로드 asset 경로 보정: `uploaded_assets`

### 6. 모델 선택

`ModelSelectionStage`는 Settings에서 사용자가 선택한 모델 하나를 모든 variant에 적용합니다.

- 선택 가능 모델 목록: `backend/routes/model_choice_sets.py`
- 실제 OpenAI API 모델명과 reasoning effort 매핑: `backend/llm.py`

### 7. Agent 실행

각 variant는 `Agent`를 통해 병렬 실행됩니다.

- 실행 진입점: `backend/agent/engine.py`
- provider 생성: `backend/agent/providers/factory.py`
- OpenAI/ChatGPT 계정 provider: `backend/agent/providers/openai.py`

Agent는 모델 응답을 스트리밍하면서 다음 이벤트를 프론트엔드에 보냅니다.

- `thinking`: reasoning summary
- `assistant`: assistant text
- `toolStart`: 도구 실행 시작
- `toolResult`: 도구 실행 결과
- `setCode`: 현재까지 생성 또는 수정된 코드
- `variantComplete`: variant 완료

### 8. 도구 호출 루프

모델이 `create_file`, `edit_file`, 이미지 생성 같은 도구를 호출하면 백엔드가 도구를 실행하고 결과를 다시 모델에 전달합니다. 이 루프는 최대 20단계까지 반복됩니다.

OpenAI Responses 요청은 `store=false`로 실행되므로, 이전 응답의 reasoning item id를 다음 input에 다시 넣으면 안 됩니다. 따라서 provider는 다음 turn에 필요한 function call item만 보존하고, `rs_...` reasoning item은 제거합니다.

### 9. 후처리와 결과 표시

모든 variant가 끝나면 백엔드는 최종 코드를 정리해 프론트엔드로 보내고, 프론트엔드는 preview와 code pane에 결과를 표시합니다.

## 문제 해결

### `gpt-5.2-codex` 또는 `gpt-5.3-codex`가 지원되지 않는다는 오류

ChatGPT 계정으로 Codex backend API를 호출할 때 일부 `*-codex` 모델 slug는 Responses 생성에 사용할 수 없습니다. Settings의 모델 목록은 실제 호출 가능한 `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`만 보여주도록 필터링되어 있습니다.

### `Item with id 'rs_...' not found` 오류

이 오류는 `store=false`인 Responses 요청에 이전 reasoning item id를 다시 넣을 때 발생합니다. reasoning item은 서버에 저장되지 않으므로 다음 input에서 제거해야 합니다. 현재 provider는 function call에 필요한 item만 재전송하도록 처리합니다.

### 로그인 상태가 보이지 않는 경우

- 백엔드가 `127.0.0.1:7001`에서 실행 중인지 확인합니다.
- Settings에서 새로고침 버튼을 누릅니다.
- 계속 실패하면 `Sign out` 후 다시 `Sign in with ChatGPT`를 실행합니다.

## 검증 명령

백엔드 테스트:

```powershell
cd C:\Users\jaemin.shin\Desktop\git\codex\target_repo\screenshot-to-code\backend
.\.venv\Scripts\python.exe -m pytest tests/test_openai_provider_session.py
.\.venv\Scripts\python.exe -m pyright --pythonpath .\.venv\Scripts\python.exe
```

프론트엔드 타입 검사와 빌드:

```powershell
cd C:\Users\jaemin.shin\Desktop\git\codex\target_repo\screenshot-to-code\frontend
pnpm exec tsc --noEmit
pnpm build
```
