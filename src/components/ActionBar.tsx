import { DownloadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Space } from 'antd'

type ActionBarProps = {
  onReset: () => void
  onExportExcel: () => void
  onAddPlayer: () => void
  exportDisabled?: boolean
}

export default function ActionBar({
  onReset,
  onExportExcel,
  onAddPlayer,
  exportDisabled,
}: ActionBarProps) {
  return (
    <Space size={10}>
      <Button icon={<ReloadOutlined />} onClick={onReset} danger>
        Reset
      </Button>
      <Button
        icon={<DownloadOutlined />}
        onClick={onExportExcel}
        type="primary"
        disabled={exportDisabled}
      >
        Xuất Excel
      </Button>
      <Button icon={<PlusOutlined />} onClick={onAddPlayer} type="default">
        Thêm người chơi
      </Button>
    </Space>
  )
}
