# 後端資料層改用 Hyperledger Fabric — 可行性評估與 PoC 計畫

> 建立：**2026-07-23**。
> 議題：評估另開分支，將後端資料層由 PostgreSQL + Prisma 改為 Hyperledger Fabric 的可能性。
> 對應現況：後端 Fastify 4 + Prisma 5 + PostgreSQL 16（v2 資料模型，12 張表）。
> 參考藍本：[`fabric-lab`（chaincode-dev / v2.5 分支）](https://gitlab.com/cshuangtw/fabric-lab)。

---

## 結論

**可行——而且從業務性質看，本專案是 Fabric 的教科書級適用場景。**
但「把後端資料庫換成 Fabric」需拆開理解：Fabric **不是能直接替換 PostgreSQL 的資料庫**，務實作法是**混合架構**（部分上鏈、部分留庫），而非整站重寫。建議以**並存的 PoC 分支**起步，不動現有 Postgres 主線。

---

## 一、為什麼這專案適合 Fabric（概念面很契合）

本系統本質是**跨機構聯盟**：多家銀行 + 法院 + 平台，共同對「債權申報 / 確認 / 還款」留下一份**不可竄改、有共識、可稽核**的紀錄。這正是 Fabric 的核心用途：

- 目前辛苦維護的 `AuditLog`（append-only）——上鏈後**帳本本身就是稽核軌跡**，每筆交易天生有序、防竄改、帶簽章。
- 「主辦凍結 `confirmedClaimAmount`」「各行確認 / 異議」——變成需要**該銀行組織背書（endorsement）**的交易，以密碼學保證「這筆是我銀行確認的」，而非靠平台資料庫的一個欄位。
- 富邦「聯合試辦」的多方互信訴求，用聯盟鏈的說服力遠高於單一平台 DB。

---

## 二、關鍵現實：Fabric ≠ 關聯式資料庫

| 面向 | 現在（Prisma / PG） | 換成 Fabric 後 |
|---|---|---|
| 存取方式 | SQL / Prisma ORM | **chaincode（Go 智能合約）**讀寫 key-value world state |
| 查詢 | join、where、聚合隨你 | 無 join；CouchDB 可做 JSON 查詢但**無關聯查詢、無跨表交易** |
| 12 張表 + 外鍵 | 關聯模型 | 要**重新設計成 KV / 文件模型**（複合鍵、反正規化） |
| 身分 | JWT + bcrypt 帳密 | **MSP / X.509 憑證，每組織一套**（人的登入仍需另一層） |
| 金額 | `Decimal(21,4)` | chaincode 內自行處理定點數（**絕不能用 float**），攤提尾差邏輯要重寫 |
| 部署 | 一個 Postgres 容器 | orderer + 每組織 peer + CA + CouchDB（**基礎設施大幅變重**） |

---

## 三、務實作法：混合架構（不是「換掉」，而是「切分」）

不建議把整個 DB 搬上鏈。合理切法：

### 上鏈（聯盟共享、需防竄改）
- `Case`（案件、狀態流轉 DRAFT → PENDING_CONFIRMATION → IN_REPAYMENT → SETTLED / TERMINATED）
- `CaseParticipantBank`（各行債權容器、`planRatio`、凍結的 `confirmedClaimAmount`、確認 / 異議狀態）
- `CreditItem`（債權明細）
- `RepaymentPeriod` / `RepaymentAllocation`（每期實收、依比例攤提、尾差）

### 留在 PostgreSQL（不該上共享鏈）
- `User` / `passwordHash` / `AccessCode` / `PasswordResetRequest`——**憑證、個資，上鏈是安全災難**
- `Notification`——暫時性
- **查詢用 read-model 鏡像**：把鏈上事件同步下來，讓前端列表 / 儀表板仍能快速查詢

### 後端如何變動
那些「上鏈實體」的 Prisma 呼叫，改為透過 **`@hyperledger/fabric-gateway`（Node.js SDK）** 送交易；
**Fastify、Zod、RBAC、前端幾乎不用動**。等於資料層的一部分從 Prisma 換成 Fabric Gateway client，而非全站重寫。

---

## 四、最大變數：銀行是否真的各跑一個 peer？

此決定工作量與價值，差異極大：

- **平台代管（demo / 試辦初期）**：所有 peer、orderer、CA 都跑在平台（如參考 lab 的 org1 / org2 同機）。
  快、可先驗證、單機 `docker-compose` 起得來。但「跨機構互信」是模擬的。
- **真分散（正式）**：每家銀行自建 peer、持自己的 MSP 憑證、參與背書。
  這才有真正的聯盟鏈價值，但涉及各行 IT / 網路 / 憑證治理，是**跨組織工程專案**，非單一 repo 能完成。

> 建議 PoC 階段先採**平台代管**拓樸，正式化再評估真分散。

---

## 五、工作量與分階段建議

這**不是一個小 branch**。務實分三階段：

### 階段 1 — PoC 分支（約 1–2 週）
- 單機 Fabric（沿用參考 lab 拓樸：1 orderer org + 2 peer org + CA + CouchDB）。
- 只把 `Case` ＋ `CreditItem` ＋ **確認流程**寫成 chaincode。
- 後端加一條 fabric-gateway 路徑，與現有 Postgres **並存**。
- **目標**：證明「確認交易由該行背書 → 上鏈 → 可查」。

### 階段 2 — 混合整合
- 還款攤提（`planRatio` 拆分、尾差由主辦吸收）上鏈。
- Postgres 降為 auth + read-model。
- 建立鏈上事件 → Postgres 鏡像的同步機制。

### 階段 3 — 多組織化（僅在試辦要求真分散時）
- 拆各行 MSP、設定背書政策（endorsement policy）。
- 跨機構部署、憑證治理。

---

## 六、資料模型映射草案（關聯 → Fabric KV）

| 現有表 | 上鏈 key 設計（草案） | 備註 |
|---|---|---|
| `Case` | `CASE~{courtCode}~{docNumber}` | 主鍵沿用法院公文文號複合鍵 |
| `CaseParticipantBank` | `PART~{caseKey}~{bankCode}` | 併債權容器；`confirmedClaimAmount` 確認當下凍結 |
| `CreditItem` | `ITEM~{caseKey}~{bankCode}~{seq}` | 明細 |
| `RepaymentPeriod` | `RPD~{caseKey}~{period}` | 每期實收總額 |
| `RepaymentAllocation` | `ALLOC~{caseKey}~{period}~{bankCode}` | 攤提；尾差記主辦 |
| 狀態流轉 / 稽核 | 交易本身 = 帳本歷史 | 取代 `AuditLog` |

> CouchDB 作為 state DB 時，可對上述文件做 rich query（依 status、bankCode 篩選），但仍**無 join**，跨實體彙整需在 chaincode 或應用層組裝。

---

## 七、主要風險與注意事項

- **定點數金額**：chaincode（Go）內金額運算需以整數 / 定點處理，重現 `Decimal(21,4)` 與攤提尾差邏輯，禁用浮點。
- **查詢能力下降**：現有 join / 聚合需改以反正規化 + 應用層組裝或 read-model。
- **身分雙層**：Fabric MSP 管「組織對鏈」的身分；人的登入 / RBAC 仍由後端維持，需設計「人 → 組織 Fabric 身分」的映射。
- **基礎設施變重**：部署從單一 Postgres 變為 orderer + 多 peer + CA + CouchDB，維運複雜度上升。
- **個資 / 憑證絕不上鏈**：帳密、AccessCode、個資僅留 Postgres。

---

## 八、建議下一步

先開 `feat/fabric-poc` 分支做**階段 1 PoC**，採平台代管拓樸，與現有 Postgres 主線**並存**（不改主線）。
風險最低，又能產出可向富邦展示的實體成果。

待確認事項：
1. PoC 先做**評估文件（本文件）**即可，還是要直接**搭 chaincode 骨架 + gateway client 範例**？
2. 試辦階段採**平台代管**，或需規劃**各行自建 peer**？（決定架構設計方向）
