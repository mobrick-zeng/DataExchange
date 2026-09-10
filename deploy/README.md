# 部署手冊（staging）

> 適用：`debit-ex-platform-staging.baasinnovation.com`（OCI `207.211.153.165`）
> 最後更新：2026-09-10（v0.5 上線後整理）

---

## 鐵則：**不得在部署主機上 build**

```
✗  docker compose ... up -d --build      ← 會拖垮主機
✓  ./deploy/build-and-ship.sh            ← 本機建置，主機只換容器
```

**理由(實際發生過)：** staging 主機為 `VM.Standard.E2.1.Micro`，**1 OCPU / 954 MB RAM**。
容器內 `npm ci` + `vite build` 峰值需要 1.5–2 GB。2026-09-10 在該機執行 `docker compose build`
時，記憶體耗盡且當時**沒有 swap**，整台機器進入重度 thrash：

- TCP 22／443 仍可完成三向交握(核心層)，但 **sshd 送不出 banner、Caddy 停止回應**(使用者層行程搶不到 CPU)
- Console 的 Stop／Reboot 是 ACPI 優雅動作，需 guest OS 回應，因此**全部卡住無進度**
- 最後以 **Reset(強制電源循環)** 才恢復；PostgreSQL 靠 WAL crash recovery 完整復原，資料零損失

事後已加 **4 GB swap**(`/swapfile`，已寫入 `/etc/fstab`，`vm.swappiness=10`)，
故障模式的殺傷力降低，但**根本解法仍是不要在主機上 build**。

---

## 例行升版

```bash
./deploy/build-and-ship.sh
```

腳本會依序完成：本機建置後端映像 → 本機原生建置前端 → 打包前端映像 →
串流傳送至主機 → `up -d --no-build` 切換容器 → 驗證。

需要先確認：
- 本機 Docker Desktop 已啟動，`docker buildx ls` 可見 `linux/amd64`
- `~/.ssh/oci_key` 可連上主機
- 已 `git push`，主機端若需同步文件另行 `git pull`(程式碼以映像為準，不靠主機的 git)

---

## 兩個必須知道的坑

### 1. 前端不能跨架構在容器內 build

Vite 依賴的 **esbuild 是 Go 二進位**。以 Apple Silicon(arm64)透過 `--platform linux/amd64`
建置時，buildx 走 QEMU 使用者態模擬，Go runtime 會因指標打包假設不成立而直接崩潰：

```
runtime: lfstack.push invalid packing: node=0xffff8543d800 ... 
fatal error: lfstack.push
[vite:esbuild] The service was stopped
```

**解法：**前端建置產物是純靜態檔、與架構無關。先在本機**原生**跑 `npm run build`，
再用 [`Dockerfile.web-prebuilt`](./Dockerfile.web-prebuilt)(只做 `COPY`、不執行任何二進位)
包成目標架構的映像。後端沒有這個問題，可直接跨架構建置。

> 若將來搬到 **Ampere A1(arm64)**，本機 M1 與目標同架構，這個 workaround 就不再需要，
> 但腳本沿用亦無妨(只是少了一次模擬)。屆時設 `TARGET_PLATFORM=linux/arm64` 即可。

### 2. `VITE_API_BASE=""` 必須顯式帶入

`src/services/api.ts` 以 `envBase ?? 'http://localhost:4000'` 解析(刻意用 `??` 而非 `||`，
否則空字串會被當 falsy)。本機直接跑 `npm run build` **不會**帶入這個變數，
產物會烘焙成 `http://localhost:4000`，部署後**登入直接 Failed to fetch**。

腳本已內建防呆：build 後掃描 `dist/`，發現 `localhost:4000` 即中止。

---

## 回滾

資料庫在升版時完全未被異動(v0.5 無新 migration)，因此回滾**不需要還原備份**，
只要把映像換回舊版標籤即可：

```bash
ssh -i ~/.ssh/oci_key ubuntu@207.211.153.165
docker tag dataexchange-api:v0.4e-rollback dataexchange-api:latest
docker tag dataexchange-web:v0.4e-rollback dataexchange-web:latest
cd ~/DataExchange
docker compose -p dataexchange -f docker-compose.fullstack.yml up -d --no-build api web
```

> 每次升版前，腳本推上去的新映像會同時帶 `:latest` 與 `:<git describe>` 標籤；
> 建議升版後**手動把被頂掉的舊映像標記成 `:<舊版>-rollback`**，保留一個版本的退路。

---

## 備份

```bash
# 主機端產生
ssh -i ~/.ssh/oci_key ubuntu@207.211.153.165 \
  'docker exec dataexchange-db-1 pg_dump -U app mediation > ~/backup_$(date +%Y%m%d_%H%M).sql'
# 立刻拉回本機（重要：只留在主機上的備份，等於沒有備份）
scp -i ~/.ssh/oci_key ubuntu@207.211.153.165:'~/backup_*.sql' ~/Desktop/DataExchange_backups/
```

還原：
```bash
docker exec -i dataexchange-db-1 psql -U app -d mediation < backup_YYYYMMDD_HHMM.sql
```

---

## 主機規格與後續

| 項目 | 現況 |
|---|---|
| Shape | `VM.Standard.E2.1.Micro`(x86_64、1 OCPU、954 MB) |
| swap | 4 GB(`/swapfile`，已持久化) |
| 公網 IP | `207.211.153.165`，**`lifetime: RESERVED`、`scope: REGION`** |

公網 IP 為**保留 IP**，可在同區域內改指到別台機器的 private IP，
因此若日後搬到 **Ampere A1(免費額度 2 OCPU / 12 GB)**，**DNS 完全不需要變更**：

```bash
oci network public-ip update \
  --public-ip-id ocid1.publicip.oc1.ap-melbourne-1.amaaaaaafq63b4aamin6swagxa5si4xjgzh7yzgk7bz3vvnde7sgzjz7dceq \
  --private-ip-id <新機器的 private IP OCID>
```

搬遷順序建議：新機器完整部署並以其臨時 IP 驗證通過 → 切 IP → Caddy 自動重簽憑證 →
**舊機器停機但不 terminate**，保留一週回滾窗口。
