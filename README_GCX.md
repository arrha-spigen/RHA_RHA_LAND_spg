# ABM_Relay_Log 에러 핸들링 가이드

> 대상 시트: [ASIN_Master(먼데이보드) — ABM_Relay_Log 탭](https://docs.google.com/spreadsheets/d/1fx9K4r2T9SeZK076zy9kMHoLzAKDgmlRp-C2VtnTKVo/edit?gid=1093828792#gid=1093828792)
>
> 이 문서는 GCX Reply Tampermonkey의 **ABM(Amazon Buyer Messaging) 자동 전달 기능**이 실패했을 때, CS 팀원이 무엇을 확인하고 어떻게 수동으로 처리해야 하는지 설명합니다.

---

## 1. 이 시트가 왜 존재하나요?

Zendesk에서 ABM 티켓(수신 주소가 `amazon@spigenhelp.zendesk.com`인 티켓)에 **Public reply**를 보내면, GCX Reply 확장 프로그램이 그 답변을 자동으로 **Seller Central의 Buyer-Seller Messaging**에도 동일하게 전송합니다. 에이전트가 Zendesk에만 답장하고 Seller Central에는 깜빡하고 안 보내는 실수를 막기 위한 기능입니다.

`ABM_Relay_Log`는 "이 전송이 실제로 Amazon 구매자에게 도달했는지"를 기록하는 **영구 로그**입니다. 브라우저 탭을 닫거나 새로고침해도 이 시트에 남은 기록을 보고 나중에 다른 에이전트의 브라우저가 이어서 재시도할 수 있습니다.

**중요:** 이 시트는 참고용 로그이지, 직접 고치는 용도가 아닙니다. 문제가 생겼을 때는 **1순위로 Zendesk 패널의 ABM 버튼**을 사용하고, 시트는 상태를 "확인"하는 용도로만 보는 것을 권장합니다. (아래 4번 참고)

---

## 2. 컬럼 설명

| 컬럼 | 의미 |
|---|---|
| `Timestamp` | 이 행이 마지막으로 갱신된 시각 (최초 전송 시각이 아님 — 재시도마다 갱신됨) |
| `RelayKey` | `{티켓ID}_{전송시작시각ms}` 형태의 고유 키. 같은 티켓에 답장을 여러 번 보내면 답장마다 별도 행이 생김 |
| `TicketId` | Zendesk 티켓 번호 |
| `CommentId` | 이 전달이 연결된 Zendesk 댓글(답장) ID — 첨부파일 재전송 시 사용 |
| `CaseId` | Seller Central의 Buyer-Seller Messaging 케이스 ID |
| `Marketplace` | 대상 아마존 도메인 (예: `amazon.de`, `amazon.co.jp`) |
| `Status` | 아래 3번 참고 |
| `Attempts` | 지금까지 전송을 시도한 횟수 |
| `LastError` | 마지막 실패 원인 (성공 시 빈 칸) |
| `MessageText` | 실제로 전송(또는 전송 시도)된 답변 본문 — 재시도할 때 이 텍스트를 그대로 다시 보냄 |

---

## 3. Status 값과 의미

| Status | 의미 | 정상적인 지속 시간 |
|---|---|---|
| `pending` | 방금 전송을 시작함, 아직 결과 모름 | 보통 몇 초~90초 이내에 `success`/`failed`로 바뀜 |
| `sending` | 어떤 브라우저가 이 건을 "내가 처리 중"이라고 선점(claim)한 상태 — 다른 브라우저가 중복 전송하지 않도록 잠금 | 보통 몇 초, 최대 5분 |
| `success` | Seller Central에 실제로 전송 완료 확인됨 | — (더 이상 재시도 안 함) |
| `failed` | 3회 재시도(약 몇 초 간격) 후에도 전송 실패 | 자동 재시도 대상으로 계속 남음 |

**정상적인 흐름:** `pending` → (`sending`) → `success`

**문제가 되는 경우:** 아래 상태로 오래 멈춰 있는 행
- `pending` 상태로 **90초 이상** 멈춰 있음 → 원래 보내던 탭이 죽었을 가능성. 자동으로 다른 브라우저의 정기 스윕(5분마다)이 주워서 재시도합니다.
- `sending` 상태로 **5분 이상** 멈춰 있음 → 선점한 탭이 중간에 닫히거나 크래시. 역시 자동 스윕이 다시 풀어서 재시도합니다.
- `failed` 상태 → 3번의 자동 재시도(csrfToken/세션 갱신 포함)가 모두 실패한 것. **자동 재시도가 계속 시도하지만, 원인이 반복되는 문제(로그인 세션 만료 등)라면 계속 실패할 수 있으므로 사람이 확인 필요.**

> 자동 재시도는 서버가 아니라 **CS 팀원이 Zendesk를 열어놓은 브라우저**에서 5분마다 돌아갑니다. 즉, 아무도 Zendesk를 켜놓지 않은 시간대(예: 새벽)에는 재시도가 일어나지 않습니다.

---

## 4. 에러 확인 및 처리 — 권장 순서

### ① 먼저 Zendesk 패널의 ABM 버튼을 사용하세요 (시트를 직접 열기 전에)

GCX Reply 패널 상단에 있는 **`ABM`** 버튼을 클릭하면:
- 아직 전달 안 된 건(Undelivered)과 전달 완료된 건(Delivered)이 목록으로 보입니다.
- 각 항목에 티켓 링크, 시간, 메시지 미리보기, 실패 사유가 함께 표시됩니다.
- 답장 발송 후 1시간이 지나도 전달 안 된 건이 있으면 화면 우측 상단에 **빨간 배지(⚠)**로 자동으로 알려줍니다.

버튼에 처리 옵션이 있습니다:
| 버튼 | 동작 |
|---|---|
| **Retry selected** | 체크한 항목만 그 자리에서 즉시 재전송 시도 |
| **Retry all** | Undelivered 전체를 즉시 재전송 시도 |
| **Mark delivered** (Undelivered 목록의 각 행) | 에이전트가 Seller Central에서 직접 확인했거나 수동으로 보낸 경우, 더 이상 자동 재시도 안 하도록 상태를 `success`로 변경 |
| **Mark undelivered** (Delivered 목록의 각 행) | `success`로 되어있지만 실제로는 고객에게 안 갔다고 확인된 경우, 다시 재시도 대상(`failed`)으로 되돌림 |

**이 버튼들이 사실상 시트의 `Status`/`LastError` 컬럼을 수정하는 것과 동일합니다.** 시트를 직접 열어 셀을 고치는 것보다 안전하고 빠릅니다.

### ② 그래도 안 될 때만 시트를 직접 확인/수정

패널로 해결이 안 되거나, 여러 건을 한눈에 파악하고 싶을 때만 시트를 엽니다.

1. `TicketId` 컬럼에서 문제의 티켓 번호를 검색(Ctrl+F)합니다.
2. `Status`, `Attempts`, `LastError`를 확인합니다.
3. **직접 셀을 고쳐야 한다면:**
   - `Status`만 수정하세요 (`success` 또는 `failed`로).
   - `RelayKey`, `Timestamp`, `MessageText`는 절대 건드리지 마세요 — 자동화 스크립트가 `RelayKey`로 행을 찾아서 갱신하기 때문에, 값이 바뀌면 다음 자동 갱신이 새 행을 만들어버리거나 엉뚱한 행을 갱신할 수 있습니다.
   - `Status`를 수정했으면 `LastError`에 간단히 사유를 남겨두면 다른 팀원이 나중에 헷갈리지 않습니다. (예: "SC에서 직접 확인, 실제 발송됨")
4. 행 자체를 삭제하는 것은 권장하지 않습니다. 정상적으로 15일이 지난 오래된 행은 자동 정리(매일 새벽 4시경, `cleanupOldAbmRelayLogRows`)로 삭제되므로, 오래된 `success` 행이 시트에서 사라져도 문제 있는 게 아닙니다.

---

## 5. ⚠️ 가장 중요한 예외: 시트에 아예 기록이 없는 경우

**티켓에 답장을 보냈는데 `ABM_Relay_Log`에 해당 `TicketId` 행이 아예 없다면, 이는 "재시도 중" 이 아니라 "애초에 전달 시도 자체가 시작되지 않은 것"입니다.**

로그는 Seller Central에서 **일치하는 케이스(Case)를 찾은 이후부터**만 기록됩니다. 아래 경우들은 로그 기록 전에 실패하기 때문에 시트에 아무 흔적도 남지 않습니다:

- 마켓플레이스 도메인을 판별하지 못함 (발신 주소 형식 문제)
- Seller Central에서 일치하는 케이스를 찾지 못함 (주문번호/ASIN 매칭 실패)
- Zendesk 티켓 정보 로드 자체가 실패

이 경우 화면에 다음과 같은 토스트 메시지가 뜹니다:
> "⚠ ABM relay: could not resolve marketplace — reply manually in Seller Central"
> "⚠ ABM relay: no matching Seller Central case found — reply manually in Seller Central"

**→ 이 메시지를 봤거나, 시트에 해당 티켓 기록이 전혀 없다면 반드시 Seller Central에 직접 로그인해서 수동으로 답장을 보내야 합니다.** 자동 재시도가 절대 대신 처리해주지 않습니다.

---

## 6. `LastError` 메시지 해석

| 메시지 패턴 | 의미 |
|---|---|
| `exhausted retries — send rejected (...)` | Seller Central이 전송 요청 자체를 거부함 (세션 만료, 권한 문제 등 가능성) |
| `exhausted retries — resource-version fetch failed` | Seller Central 페이지 정보를 가져오는 단계에서 실패 (보통 로그인 세션 문제) |
| `manually set by agent` | 에이전트가 패널의 Mark delivered/undelivered 버튼으로 직접 상태를 바꾼 것 (정상) |

`LastError`에 반복적으로 같은 메시지가 쌓인다면 (예: 특정 마켓플레이스에서만 계속 실패), Seller Central 로그인 세션이 해당 마켓플레이스 계정에서 만료됐을 가능성이 높으니 재로그인 후 다시 확인하세요.

---

## 7. 상황별 빠른 대응 요약

| 상황 | 대응 |
|---|---|
| 시트에서 특정 티켓이 `pending`으로 몇 분째 멈춰있음 | 잠시 기다리기 (5분 자동 스윕이 처리) → 급하면 패널에서 Retry |
| `failed` 상태가 계속됨 | 패널 ABM 버튼 → Retry selected, 안 되면 원인(`LastError`) 확인 후 Seller Central에서 직접 확인 |
| 고객이 "Amazon에서 답장을 못 받았다"고 함 | 시트에서 `TicketId` 검색 → 있으면 Status 확인, **없으면 → 반드시 Seller Central에서 수동으로 직접 답장** |
| Seller Central에서는 이미 답장 확인됐는데 시트엔 `failed`로 남음 | 패널에서 해당 항목 **Mark delivered** 클릭 (직접 시트 수정 안 해도 됨) |
| 시트에 `success`로 되어 있는데 고객이 못 받았다고 확인됨 | 패널에서 **Mark undelivered** 클릭 → 자동 재시도 대상으로 다시 들어감 |
| 오래된 행이 시트에서 사라짐 | 정상 — 15일 지난 행은 매일 자동 정리됨, 걱정할 필요 없음 |

---

## 8. 관련 파일 (참고용, 팀원이 직접 건드릴 필요는 없음)

| 파일 | 역할 |
|---|---|
| `GAS_Zendesk/GCXReply_GAS/Code.js` | `ABM_Relay_Log` 읽기/쓰기, 재시도 큐, 상태 변경 API (`upsertAbmRelayLog_`, `claimAbmRelay_`, `setAbmRelayStatus_`) |
| `Browser_Extensions/tampermonkey_scripts/GCX Reply.user.js` | ABM 전송 로직, 재시도 스윕, 패널 UI (`relayAbmReply_`, `sweepAbmRelayFailures_`, `showAbmPanel_`) |
| `GAS_Zendesk/ASIN_Master_MondaySync/Code.js` | `ABM_Relay_Log` 15일 보존 정리 (`cleanupOldAbmRelayLogRows`) |
