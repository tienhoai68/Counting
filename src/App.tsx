import { DeleteOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined, UserAddOutlined } from '@ant-design/icons'
import {
  Button,
  Card,
  ConfigProvider,
  Input,
  InputNumber,
  Layout,
  List,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Typography,
  theme,
} from 'antd'
import { saveAs } from 'file-saver'
import { useMemo } from 'react'

const CrownIcon = ({ size = 14 }: { size?: number }) => (
  <span style={{ color: '#f59e0b', fontSize: size, lineHeight: 1 }}>♛</span>
)

import * as XLSX from 'xlsx'
import './App.css'
import useStickyState from './hooks/useStickyState'

// --- TYPES ---
type Player = { id: string; name: string }
type RoundValues = Record<string, number>
type GameRound = { id: string; bankerId: string; values: RoundValues }

type DebtItem = {
  roundIndex: number
  bankerId: string
  fromId: string
  toId: string
  amount: number
}

// --- HELPERS ---
const formatVnd = (amount: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount)
const uid = () => `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`

// --- CONSTANTS ---
const DEFAULT_PLAYERS: Player[] = Array.from({ length: 3 }, (_, i) => ({
  id: uid(),
  name: `Người chơi ${i + 1}`,
}))

function getMoneyClass(value: number | undefined, isBanker: boolean) {
  if (isBanker) return ''
  const v = value ?? 0
  if (v > 0) return 'cp-input-pos'
  if (v < 0) return 'cp-input-neg'
  return 'cp-input-zero'
}

function nameById(players: Player[], id: string) {
  return players.find((p) => p.id === id)?.name ?? id
}

// --- COMPONENT ---
export default function App() {
  const [players, setPlayers] = useStickyState<Player[]>(DEFAULT_PLAYERS, 'poker-app-players')
  const [rounds, setRounds] = useStickyState<GameRound[]>([], 'poker-app-rounds')
  const [moneyStep, setMoneyStep] = useStickyState<number>(10000, 'poker-app-moneyStep')

  // --- COMPUTED STATE ---
  const totals = useMemo(() => {
    const acc: Record<string, number> = {}
    players.forEach((p) => (acc[p.id] = 0))
    rounds.forEach((round) => {
      if (!round.bankerId) return
      const sumParticipants = players
        .filter((p) => p.id !== round.bankerId)
        .reduce((s, p) => s + (round.values[p.id] ?? 0), 0)
      const finalValues = { ...round.values, [round.bankerId]: -sumParticipants }
      for (const [pid, v] of Object.entries(finalValues)) {
        if (acc[pid] !== undefined) acc[pid] += Number.isFinite(v) ? v : 0
      }
    })
    return acc
  }, [players, rounds])

  const debtsByRound = useMemo((): DebtItem[] => {
    const items: DebtItem[] = []

    rounds.forEach((round, idx) => {
      const bankerId = round.bankerId
      if (!bankerId) return

      for (const p of players) {
        if (p.id === bankerId) continue
        const v = round.values[p.id] ?? 0
        if (!Number.isFinite(v) || v === 0) continue

        if (v > 0) {
          // banker pays player
          items.push({ roundIndex: idx + 1, bankerId, fromId: bankerId, toId: p.id, amount: v })
        } else {
          // player pays banker
          items.push({ roundIndex: idx + 1, bankerId, fromId: p.id, toId: bankerId, amount: Math.abs(v) })
        }
      }
    })

    return items
  }, [players, rounds])

  const finalSettlement = useMemo(() => {
    const balances = { ...totals }
    const debtors = Object.entries(balances)
      .filter(([, amount]) => amount < 0)
      .map(([id, amount]) => ({ id, amount: -amount }))
      .sort((a, b) => a.amount - b.amount)

    const creditors = Object.entries(balances)
      .filter(([, amount]) => amount > 0)
      .map(([id, amount]) => ({ id, amount }))
      .sort((a, b) => a.amount - b.amount)

    const transactions: Array<{ fromId: string; toId: string; amount: number }> = []

    let debtorIndex = 0
    let creditorIndex = 0

    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const debtor = debtors[debtorIndex]
      const creditor = creditors[creditorIndex]
      const amount = Math.min(debtor.amount, creditor.amount)

      if (amount > 0) {
        transactions.push({ fromId: debtor.id, toId: creditor.id, amount })
        debtor.amount -= amount
        creditor.amount -= amount
      }

      if (debtor.amount === 0) debtorIndex++
      if (creditor.amount === 0) creditorIndex++
    }

    return transactions.sort((a, b) => b.amount - a.amount)
  }, [totals])

  const settlementByPerson = useMemo(() => {
    return players
      .map((p) => {
        const pay = finalSettlement.filter((t) => t.fromId === p.id).reduce((s, t) => s + t.amount, 0)
        const receive = finalSettlement.filter((t) => t.toId === p.id).reduce((s, t) => s + t.amount, 0)
        return { personId: p.id, pay, receive, net: receive - pay }
      })
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
  }, [finalSettlement, players])

  // --- HANDLERS ---
  const addPlayer = () => setPlayers((prev) => [...prev, { id: uid(), name: `Người chơi ${prev.length + 1}` }])
  const removePlayer = (id: string) => {
    setPlayers((prev) => prev.filter((p) => p.id !== id))
    setRounds((prev) =>
      prev.map((r) => {
        const nextValues = { ...r.values }
        delete nextValues[id]
        return { ...r, values: nextValues, bankerId: r.bankerId === id ? '' : r.bankerId }
      }),
    )
  }
  const renamePlayer = (id: string, name: string) =>
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))

  const addRound = () => {
    const lastBankerId = rounds.length > 0 ? rounds[rounds.length - 1].bankerId : ''
    setRounds((prev) => [...prev, { id: uid(), bankerId: lastBankerId, values: {} }])
  }

  const updateRound = (roundId: string, newRoundData: Partial<GameRound>) =>
    setRounds((prev) => prev.map((r) => (r.id === roundId ? { ...r, ...newRoundData } : r)))

  const updateRoundValue = (roundId: string, playerId: string, value: number | null) => {
    const round = rounds.find((r) => r.id === roundId)
    if (!round || playerId === round.bankerId) return
    updateRound(roundId, { values: { ...round.values, [playerId]: value ?? 0 } })
  }

  const removeRound = (roundId: string) => setRounds((prev) => prev.filter((r) => r.id !== roundId))
  const resetGame = () => {
    setRounds([])
    setMoneyStep(10000)

    window.localStorage.removeItem('poker-app-rounds')
    window.localStorage.removeItem('poker-app-moneyStep')
  }

  const exportExcel = () => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const fileName = `ket-qua-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.xlsx`

    const summaryData = players.map((p) => ({ 'Tên': p.name, 'Tổng kết (VND)': totals[p.id] ?? 0 }))

    const historyData = rounds.map((r, i) => {
      const bankerName = players.find((p) => p.id === r.bankerId)?.name ?? 'N/A'
      const sumParticipants = players
        .filter((p) => p.id !== r.bankerId)
        .reduce((s, p) => s + (r.values[p.id] ?? 0), 0)
      const finalValues = { ...r.values, [r.bankerId]: -sumParticipants }
      const row: Record<string, string | number> = { 'Ván': i + 1, 'Người làm cái': bankerName }
      players.forEach((p) => {
        row[p.name] = finalValues[p.id] ?? 0
      })
      return row
    })

    const debtsByRoundData = debtsByRound.map((d) => {
      return {
        'Ván': d.roundIndex,
        'Người làm cái (ván đó)': nameById(players, d.bankerId),
        'Bên trả': nameById(players, d.fromId),
        'Bên nhận': nameById(players, d.toId),
        'Số tiền': d.amount,
      }
    })

    const debtsSummaryData = finalSettlement.map((t) => {
      return {
        'Bên trả': nameById(players, t.fromId),
        'Bên nhận': nameById(players, t.toId),
        'Tổng số tiền': t.amount,
      }
    })

    const debtsSummaryByPersonData = settlementByPerson.map((d) => {
      return {
        'Người': nameById(players, d.personId),
        'Tổng trả': d.pay,
        'Tổng nhận': d.receive,
        'Ròng (nhận - trả)': d.net,
      }
    })

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), 'Tong ket')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(historyData), 'Lich su van')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(debtsByRoundData), 'Cong no (Theo van)')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(debtsSummaryData), 'Cong no (Tong)')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(debtsSummaryByPersonData), 'Cong no (Tong theo nguoi)')

    saveAs(
      new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      fileName,
    )
  }

  // --- TABLE COLUMNS ---
  const playerCount = players.length
  const playerColWidth = Math.max(88, Math.min(120, Math.floor(800 / Math.max(1, playerCount))))
  const tableMinWidth = 54 + 140 + playerColWidth * playerCount + 44

  // --- TABLE COLUMNS ---
  const tableColumns = (() => {
    const cols: Array<{
      title: React.ReactNode
      dataIndex?: any
      key: string
      width?: number
      align?: 'left' | 'right' | 'center'
      fixed?: 'left' | 'right'
      render?: (value: unknown, record: GameRound, index: number) => React.ReactNode
    }> = []

    cols.push({
      title: 'Ván',
      key: 'van',
      width: 54,
      align: 'center',
      fixed: 'left',
      render: (_: unknown, __: GameRound, i: number) => (
        <div
          style={{
            background: 'rgba(79, 70, 229, 0.08)',
            borderRadius: 6,
            padding: '2px 6px',
            display: 'inline-block',
            fontWeight: 700,
            color: '#4f46e5',
          }}
        >
          {i + 1}
        </div>
      ),
    })

    cols.push({
      title: <div className="cp-player-col-title">Cái</div>,
      key: 'banker',
      width: 140,
      fixed: 'left',
      render: (_: unknown, record: GameRound) => (
        <Select
          value={record.bankerId || undefined}
          onChange={(val) => updateRound(record.id, { bankerId: val })}
          style={{ width: '100%' }}
          placeholder="Chọn cái"
          options={players.map((p) => ({ value: p.id, label: p.name }))}
          size="middle"
        />
      ),
    })

    for (const player of players) {
      cols.push({
        title: (
          <div className="cp-player-col-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {player.name}
            <span style={{ visibility: 'hidden' }}>
              <CrownIcon />
            </span>
          </div>
        ),
        key: player.id,
        width: playerColWidth,
        align: 'right',
        render: (_: unknown, record: GameRound) => {
          const isBanker = record.bankerId === player.id

          // no-op: title is derived elsewhere
          const sumParticipants = players
            .filter((p) => p.id !== record.bankerId)
            .reduce((s, p) => s + (record.values[p.id] ?? 0), 0)
          const bankerValue = -sumParticipants

          const value = isBanker ? bankerValue : record.values[player.id]
          const className = getMoneyClass(record.values[player.id], isBanker)

          return (
            <InputNumber
              value={value}
              disabled={isBanker}
              onChange={(val) => updateRoundValue(record.id, player.id, val)}
              step={moneyStep}
              formatter={(v) => {
                if (v === undefined || v === null) return ''
                const n = Number(v)
                if (!Number.isFinite(n)) return ''
                return new Intl.NumberFormat('vi-VN').format(n)
              }}
              parser={(v) => {
                const raw = (v ?? '').toString().replace(/\./g, '').replace(/₫/g, '').trim()
                const n = Number(raw)
                return Number.isFinite(n) ? n : 0
              }}
              style={{ width: '100%', textAlign: 'right', background: isBanker ? '#f3f4f6' : undefined }}
              className={className}
              placeholder="0"
              size="middle"
            />
          )
        },
      })
    }

    cols.push({
      title: '',
      key: 'action',
      width: 44,
      fixed: 'right',
      align: 'center',
      render: (_: unknown, record: GameRound) => (
        <Popconfirm title="Xóa ván này?" onConfirm={() => removeRound(record.id)} okText="Xóa" cancelText="Hủy">
          <Button type="text" icon={<DeleteOutlined style={{ color: '#ef4444' }} />} />
        </Popconfirm>
      ),
    })

    return cols
  })()

  // Highlight banker (người làm cái) in player column headers
  for (const col of tableColumns) {
    const pid = col.key as string
    if (!pid || pid === 'van' || pid === 'banker' || pid === 'action') continue
    const isBanker = rounds.some((r) => r.bankerId === pid)
    if (!isBanker) continue
    if (typeof col.title === 'string') continue
    col.title = (
      <div className="cp-player-col-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {nameById(players, pid)}
        <CrownIcon />
      </div>
    )
  }

  const tableScroll = useMemo(() => {
    const y = rounds.length > 10 ? 520 : undefined
    // Force horizontal scroll once there are many player columns
    const x = playerCount > 6 ? tableMinWidth : 'max-content'
    return y ? ({ x, y } as const) : ({ x } as const)
  }, [rounds.length, playerCount, tableMinWidth])

  // --- RENDER ---
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#4f46e5',
          colorInfo: '#4f46e5',
          borderRadius: 10,
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f7f8fc',
          colorBorderSecondary: 'rgba(15,23,42,0.10)',
        },
        components: {
          Table: {
            headerBg: 'rgba(79, 70, 229, 0.06)',
            headerColor: '#0f172a',
            rowHoverBg: 'rgba(79, 70, 229, 0.05)',
            borderColor: 'rgba(15,23,42,0.10)',
          },
        },
      }}
    >
      <Layout style={{ minHeight: '100vh', background: 'radial-gradient(1200px 500px at 10% 0%, rgba(79,70,229,0.12) 0%, rgba(247,248,252,1) 50%)' }}>
        <Layout.Header
          style={{
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            padding: '0 24px',
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Typography.Title level={4} style={{ margin: 0, color: 'white' }}>
              Tính tiền
            </Typography.Title>
          </div>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={resetGame}
              type="default"
              style={{ background: 'rgba(255,255,255,0.9)', fontWeight: 500 }}
            >
              Làm mới
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={exportExcel}
              type="primary"
              disabled={rounds.length === 0}
              style={{ background: '#10b981', borderColor: '#10b981' }}
            >
              Xuất Excel
            </Button>
          </Space>
        </Layout.Header>

        <div className="cp-shell">
          <div className="cp-grid">
            <div>
              <Card
                title={<span style={{ fontWeight: 700 }}>Bảng ván</span>}
                extra={
                  <Space size={10}>
                    <Space size={6}>
                      <span style={{ fontSize: 12, fontWeight: 650, color: '#334155' }}>Bước nhảy</span>
                      <InputNumber
                        size="middle"
                        value={moneyStep}
                        onChange={(value) => setMoneyStep(value || 1000)}
                        step={1000}
                        min={0}
                        formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                        parser={(value) => Number((value ?? '').replace(/\./g, ''))}
                        style={{ width: 140 }}
                      />
                    </Space>
                    <Button type="primary" icon={<PlusOutlined />} onClick={addRound} size="middle" style={{ background: '#4f46e5' }}>
                      Thêm ván
                    </Button>
                  </Space>
                }
                style={{ borderRadius: 14, boxShadow: '0 8px 28px rgba(15,23,42,0.06)' }}
                bodyStyle={{ padding: 0 }}
              >
                <Table
                  columns={tableColumns as any}
                  dataSource={rounds}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  scroll={tableScroll}
                  sticky
                />
                {rounds.length === 0 && (
                  <div style={{ padding: 18, textAlign: 'center', color: '#64748b' }}>
                    <div style={{ fontWeight: 600 }}>Chưa có ván nào</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Bấm “Thêm ván” để bắt đầu.</div>
                  </div>
                )}
              </Card>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Card style={{ borderRadius: 14, boxShadow: '0 8px 28px rgba(15,23,42,0.06)' }}>
                <Tabs
                  size="small"
                  items={[
                    {
                      key: 'balance',
                      label: 'Tổng kết',
                      children: (
                        <List
                          size="small"
                          dataSource={players}
                          renderItem={(p) => {
                            const total = totals[p.id] ?? 0
                            const isPositive = total > 0
                            const isNegative = total < 0
                            return (
                              <List.Item style={{ padding: '8px 0' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 12 }}>
                                  <div style={{ fontWeight: 650, color: '#0f172a' }}>{p.name}</div>
                                  <div
                                    style={{
                                      fontWeight: 800,
                                      color: isPositive ? '#10b981' : isNegative ? '#ef4444' : '#0f172a',
                                    }}
                                  >
                                    {formatVnd(total)}
                                  </div>
                                </div>
                              </List.Item>
                            )
                          }}
                        />
                      ),
                    },

                    {
                      key: 'pay',
                      label: 'Ai trả ai',
                      children: (
                        <List
                          size="small"
                          dataSource={finalSettlement}
                          locale={{ emptyText: 'Không có công nợ' }}
                          renderItem={(t) => (
                            <List.Item style={{ padding: '8px 0' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 12 }}>
                                <div style={{ fontWeight: 650, color: '#0f172a' }}>
                                  {nameById(players, t.fromId)} → {nameById(players, t.toId)}
                                </div>
                                <div style={{ fontWeight: 800, color: '#ef4444' }}>{formatVnd(t.amount)}</div>
                              </div>
                            </List.Item>
                          )}
                        />
                      ),
                    },
                    {
                      key: 'person',
                      label: 'Theo người',
                      children: (
                        <List
                          size="small"
                          dataSource={settlementByPerson}
                          locale={{ emptyText: 'Chưa có thanh toán' }}
                          renderItem={(d) => (
                            <List.Item style={{ padding: '8px 0' }}>
                              <div style={{ width: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                                  <div style={{ fontWeight: 650, color: '#0f172a' }}>{nameById(players, d.personId)}</div>
                                  <div style={{ fontWeight: 800, color: d.net >= 0 ? '#10b981' : '#ef4444' }}>
                                    {d.net >= 0 ? `+${formatVnd(d.net)}` : formatVnd(d.net)}
                                  </div>
                                </div>
                                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                                  Trả: <b style={{ color: '#ef4444' }}>{formatVnd(d.pay)}</b> | Nhận:{' '}
                                  <b style={{ color: '#10b981' }}>{formatVnd(d.receive)}</b>
                                </div>
                              </div>
                            </List.Item>
                          )}
                        />
                      ),
                    },
                  ]}
                />
              </Card>

              <Card
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700 }}>Người chơi</span>
                    <Button type="text" icon={<UserAddOutlined />} onClick={addPlayer} size="small" style={{ color: '#4f46e5' }}>
                      Thêm
                    </Button>
                  </div>
                }
                style={{ borderRadius: 14, boxShadow: '0 8px 28px rgba(15,23,42,0.06)' }}
                bodyStyle={{ padding: 0 }}
              >
                <List
                  size="small"
                  dataSource={players}
                  renderItem={(p) => (
                    <List.Item
                      style={{ padding: '8px 12px' }}
                      actions={[
                        <Popconfirm title={`Xóa ${p.name}?`} onConfirm={() => removePlayer(p.id)} okText="Xóa" cancelText="Hủy">
                          <Button type="text" icon={<DeleteOutlined style={{ color: '#ef4444' }} />} size="small" />
                        </Popconfirm>,
                      ]}
                    >
                      <Input defaultValue={p.name} onBlur={(e) => renamePlayer(p.id, e.target.value)} variant="borderless" />
                    </List.Item>
                  )}
                />
              </Card>
            </div>
          </div>
        </div>
      </Layout>
    </ConfigProvider>
  )
}
