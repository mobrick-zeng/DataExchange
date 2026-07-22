import { Button } from './Button'
import { Modal } from './Modal'

interface AccountHelpModalProps {
  open: boolean
  onClose: () => void
}

/** 帳號協助彈窗：Demo 階段為靜態說明內容，正式版可串接真實客服工單系統 */
export function AccountHelpModal({ open, onClose }: AccountHelpModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="帳號協助" footer={<Button onClick={onClose}>關閉</Button>}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="font-medium text-slate-900">常見問題</p>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-slate-500">
            <li>沒有收到驗證信？請確認 Email 是否輸入正確，或點擊「開啟 Demo 信箱」查看模擬驗證信。</li>
            <li>忘記所屬銀行？請聯絡貴行內部系統窗口，或洽平台管理員確認核准紀錄。</li>
            <li>帳號一直顯示待審核？請耐心等候平台管理員審核，審核完成將可正常登入。</li>
          </ul>
        </div>
        <div>
          <p className="font-medium text-slate-900">聯絡平台客服（Demo 模擬）</p>
          <p className="mt-1 text-slate-500">Email：support@platform-demo.local</p>
          <p className="text-slate-500">服務時間：週一至週五 09:00–18:00（Demo 環境無真實客服回覆）</p>
        </div>
      </div>
    </Modal>
  )
}
