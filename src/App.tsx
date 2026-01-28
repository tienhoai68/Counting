import {
  DeleteOutlined,
  DownloadOutlined,
  MoonOutlined,
  PlusOutlined,
  ReloadOutlined,
  SunOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  ConfigProvider,
  Input,
  InputNumber,
  Layout,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Typography,
  theme,
} from 'antd'
import { saveAs } from 'file-saver'
import { useEffect, useMemo, useRef, useState } from 'react'

import * as XLSX from 'xlsx'
import './App.css'
import frameBg from './assets/Frame.svg'
import logo from './assets/logo.svg'
import useStickyState from './hooks/useStickyState'

const CrownIcon = ({ size = 14 }: { size?: number }) => (
  <span style={{ color: '#f59e0b', fontSize: size, lineHeight: 1 }}>♛</span>
)

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
  const [isPortrait, setIsPortrait] = useState(false)
  const [rounds, setRounds] = useStickyState<GameRound[]>([], 'poker-app-rounds')
  const [moneyStep, setMoneyStep] = useStickyState<number>(5000, 'poker-app-moneyStep')

  const [isResetModalOpen, setIsResetModalOpen] = useState(false)

  const trailsCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)

  const [isDarkMode, setIsDarkMode] = useStickyState<boolean>(false, 'poker-app-darkmode')

  useEffect(() => {
    document.body.setAttribute('data-theme', isDarkMode ? 'dark' : 'light')
  }, [isDarkMode])

  useEffect(() => {
    const compute = () => {
      // Prefer screen.orientation when available; fallback to viewport ratio.
      const so: any = (window.screen as any)?.orientation
      const isPortraitByApi = typeof so?.type === 'string' ? so.type.startsWith('portrait') : undefined
      const isPortraitByRatio = window.innerHeight > window.innerWidth
      setIsPortrait(isPortraitByApi ?? isPortraitByRatio)
    }

    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('orientationchange', compute)

    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('orientationchange', compute)
    }
  }, [])

  const [isCelebrating, setIsCelebrating] = useState(false)
  const celebrationIntervalRef = useRef<number | null>(null)

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

  const ranking = useMemo(() => {
    return players
      .map((p) => ({ personId: p.id, total: totals[p.id] ?? 0 }))
      .sort((a, b) => b.total - a.total)
  }, [players, totals])

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

  const resetGameNow = () => {
    setRounds([])
    setMoneyStep(5000)

    window.localStorage.removeItem('poker-app-rounds')
    window.localStorage.removeItem('poker-app-moneyStep')
  }

  const stopCelebration = () => {
    if (celebrationIntervalRef.current) {
      window.clearInterval(celebrationIntervalRef.current)
      celebrationIntervalRef.current = null
    }

    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    const trails = trailsCanvasRef.current
    const main = mainCanvasRef.current
    if (trails) {
      const ctx = trails.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, trails.width, trails.height)
    }
    if (main) {
      const ctx = main.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, main.width, main.height)
    }

    setIsCelebrating(false)
  }

  type FireworkParticle = {
    x: number
    y: number
    vx: number
    vy: number
    size: number
    hue: number
    sat: number
    light: number
    alpha: number
    decay: number
  }

  const startCelebration = () => {
    if (isCelebrating) return
    setIsCelebrating(true)

    const trailsCanvas = trailsCanvasRef.current
    const mainCanvas = mainCanvasRef.current
    if (!trailsCanvas || !mainCanvas) return

    let didCleanup = false

    const trailsCtx = trailsCanvas.getContext('2d')
    const mainCtx = mainCanvas.getContext('2d')
    if (!trailsCtx || !mainCtx) return

    const cleanupFns: Array<() => void> = []

    const palette: Array<[number, number, number]> = [
      [340, 95, 62],
      [20, 95, 60],
      [48, 95, 56],
      [120, 85, 50],
      [165, 90, 48],
      [200, 95, 58],
      [255, 92, 66],
      [285, 95, 64],
    ]

    const particles: FireworkParticle[] = []

    const resize = () => {
      const host = document.getElementById('cp-fireworks-canvas-host')
      if (!host) return

      const rect = host.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1

      trailsCanvas.width = Math.max(1, Math.floor(rect.width * dpr))
      trailsCanvas.height = Math.max(1, Math.floor(rect.height * dpr))
      mainCanvas.width = Math.max(1, Math.floor(rect.width * dpr))
      mainCanvas.height = Math.max(1, Math.floor(rect.height * dpr))

      trailsCanvas.style.width = `${rect.width}px`
      trailsCanvas.style.height = `${rect.height}px`
      mainCanvas.style.width = `${rect.width}px`
      mainCanvas.style.height = `${rect.height}px`

      trailsCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    const onResize = () => resize()
    window.addEventListener('resize', onResize)
    cleanupFns.push(() => window.removeEventListener('resize', onResize))

    const spawnExplosion = () => {
      const host = document.getElementById('cp-fireworks-canvas-host')
      if (!host) return
      const rect = host.getBoundingClientRect()

      const x = Math.random() * rect.width
      const y = rect.height * (0.15 + Math.random() * 0.45)

      const [h, s, l] = palette[Math.floor(Math.random() * palette.length)]
      const count = 60 + Math.floor(Math.random() * 60)

      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = 1.2 + Math.random() * 3.2
        particles.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          size: 1.5 + Math.random() * 2,
          hue: h,
          sat: s,
          light: l,
          alpha: 1,
          decay: 0.01 + Math.random() * 0.015,
        })
      }
    }

    spawnExplosion()
    celebrationIntervalRef.current = window.setInterval(spawnExplosion, 650)

    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(32, now - last)
      last = now

      const host = document.getElementById('cp-fireworks-canvas-host')
      if (!host) return
      const rect = host.getBoundingClientRect()

      trailsCtx.fillStyle = `rgba(0, 0, 0, 0.18)`
      trailsCtx.fillRect(0, 0, rect.width, rect.height)

      mainCtx.clearRect(0, 0, rect.width, rect.height)

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x += p.vx * (dt / 16)
        p.y += p.vy * (dt / 16)
        p.vy += 0.08 * (dt / 16)
        p.alpha -= p.decay * (dt / 16)

        if (p.alpha <= 0) {
          particles.splice(i, 1)
          continue
        }

        const fill = `hsla(${p.hue} ${p.sat}% ${p.light}% / ${p.alpha})`

        trailsCtx.fillStyle = fill
        trailsCtx.beginPath()
        trailsCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        trailsCtx.fill()

        mainCtx.fillStyle = fill
        mainCtx.beginPath()
        mainCtx.arc(p.x, p.y, Math.max(0.7, p.size * 0.85), 0, Math.PI * 2)
        mainCtx.fill()
      }

      rafRef.current = window.requestAnimationFrame(tick)
    }

    rafRef.current = window.requestAnimationFrame(tick)

    const cleanup = () => {
      if (didCleanup) return
      didCleanup = true
      cleanupFns.forEach((fn) => fn())
      cleanupFns.length = 0
    }

    return cleanup
  }

  const resetGame = () => {
    if (rounds.length === 0) {
      resetGameNow()
      return
    }
    setIsResetModalOpen(true)
  }

  useEffect(() => {
    if (!isResetModalOpen) return

    // Start after modal content has mounted so canvas refs exist.
    const t = window.setTimeout(() => {
      startCelebration()
    }, 0)

    return () => {
      window.clearTimeout(t)
      stopCelebration()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResetModalOpen])

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Select
            value={record.bankerId || undefined}
            onChange={(val) => updateRound(record.id, { bankerId: val })}
            style={{ width: '100%' }}
            placeholder="Chọn cái"
            options={players.map((p) => ({ value: p.id, label: p.name }))}
            size="middle"
          />
          {record.bankerId ? <CrownIcon size={16} /> : null}
        </div>
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
              controls={false}
              addonBefore={
                <Button
                  size="large"
                  type="text"
                  disabled={isBanker}
                  onClick={() => updateRoundValue(record.id, player.id, (record.values[player.id] ?? 0) - moneyStep)}
                  style={{ color: '#ef4444', fontWeight: 800, padding: 0, width: 22, height: 22, lineHeight: '22px' }}
                >
                  -
                </Button>
              }
              addonAfter={
                <Button
                  size="large"
                  type="text"
                  disabled={isBanker}
                  onClick={() => updateRoundValue(record.id, player.id, (record.values[player.id] ?? 0) + moneyStep)}
                  style={{ color: '#10b981', fontWeight: 800, padding: 0, width: 22, height: 22, lineHeight: '22px' }}
                >
                  +
                </Button>
              }
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
              style={{ width: '100%', textAlign: 'center', background: isBanker ? '#f3f4f6' : undefined }}
              className={`${className} cp-inputnumber-square-center`}
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
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#6366f1',
          colorInfo: '#6366f1',
          borderRadius: 10,
          colorBgContainer: isDarkMode ? '#111827' : '#ffffff',
          colorBgLayout: isDarkMode ? '#0b1220' : '#f7f8fc',
          colorBorderSecondary: isDarkMode ? 'rgba(148, 163, 184, 0.16)' : 'rgba(15,23,42,0.10)',
          colorText: isDarkMode ? 'rgba(255,255,255,0.88)' : 'rgba(15,23,42,0.92)',
          colorTextSecondary: isDarkMode ? 'rgba(226,232,240,0.72)' : 'rgba(51,65,85,0.80)',
          colorFillSecondary: isDarkMode ? 'rgba(148, 163, 184, 0.10)' : 'rgba(15,23,42,0.06)',
        },
        components: {
          Table: {
            headerBg: isDarkMode ? 'rgba(99, 102, 241, 0.14)' : 'rgba(79, 70, 229, 0.06)',
            headerColor: isDarkMode ? 'rgba(255,255,255,0.88)' : '#0f172a',
            rowHoverBg: isDarkMode ? 'rgba(99, 102, 241, 0.10)' : 'rgba(79, 70, 229, 0.05)',
            borderColor: isDarkMode ? 'rgba(148, 163, 184, 0.16)' : 'rgba(15,23,42,0.10)',
          },
          Modal: {
            contentBg: isDarkMode ? '#0f172a' : '#ffffff',
            headerBg: isDarkMode ? '#0f172a' : '#ffffff',
          },
          Tabs: {
            inkBarColor: '#6366f1',
          },
        },
      }}
    >
      <Layout
        style={{
          minHeight: '100vh',
          backgroundImage: isDarkMode
            ? `url(${frameBg}), radial-gradient(1200px 500px at 10% 0%, rgba(79,70,229,0.22) 0%, rgba(11,18,32,1) 55%)`
            : `url(${frameBg}), radial-gradient(1200px 500px at 10% 0%, rgba(79,70,229,0.12) 0%, rgba(247,248,252,1) 50%)`,
          // Make only the SVG background "faded" by blending it with a solid color.
          backgroundRepeat: 'no-repeat, no-repeat',
          backgroundPosition: 'center center, center center',
          backgroundSize: 'cover, cover',
          backgroundAttachment: 'fixed, fixed',
          backgroundColor: isDarkMode ? 'rgba(11,18,32,0.2)' : 'rgba(255,255,255,0.2)',
          backgroundBlendMode: 'multiply, normal',
        }}
      >
        {isPortrait ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10000,
              background: isDarkMode ? 'rgba(2, 6, 23, 0.92)' : 'rgba(15, 23, 42, 0.88)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                maxWidth: 420,
                width: '100%',
                borderRadius: 14,
                padding: 16,
                background: isDarkMode ? 'rgba(17, 24, 39, 0.92)' : 'rgba(255,255,255,0.98)',
                boxShadow: isDarkMode ? '0 12px 40px rgba(0,0,0,0.55)' : '0 12px 40px rgba(15,23,42,0.22)',
                border: isDarkMode ? '1px solid rgba(148, 163, 184, 0.16)' : '1px solid rgba(15,23,42,0.10)',
              }}
            >
              <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 8, color: isDarkMode ? 'rgba(255,255,255,0.92)' : '#0f172a' }}>
                Vui lòng xoay ngang màn hình
              </Typography.Title>
              <Typography.Text style={{ display: 'block', marginBottom: 12, color: isDarkMode ? 'rgba(226,232,240,0.75)' : 'rgba(51,65,85,0.88)' }}>
                Ứng dụng này được tối ưu cho chế độ ngang.
              </Typography.Text>
              <Button type="primary" onClick={() => (window.screen as any)?.orientation?.lock?.('landscape')}>
                Thử tự xoay
              </Button>
            </div>
          </div>
        ) : null}
        <Layout.Header
          style={{
            background: '#A329AE',
            padding: '0 24px',
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: isDarkMode ? '0 1px 3px rgba(0,0,0,0.5)' : '0 1px 3px rgba(0,0,0,0.1)',
            borderBottom: isDarkMode ? '1px solid rgba(148, 163, 184, 0.16)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <img
              src={logo}
              alt="Settlement"
              style={{ width: 28, height: 28, flex: '0 0 auto', display: 'block', verticalAlign: 'middle' }}
            />
            <div
              style={{
                color: 'white',
                fontSize: 20,
                fontWeight: 700,
                lineHeight: '28px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              MONEYTET
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              onClick={() => setIsDarkMode((v) => !v)}
              type="default"
              style={{
                padding: 0,
                width: 64,
                height: 34,
                borderRadius: 999,
                overflow: 'hidden',
                background: isDarkMode ? 'rgba(15, 23, 42, 0.35)' : 'rgba(255,255,255,0.95)',
                borderColor: isDarkMode ? 'rgba(226,232,240,0.35)' : 'rgba(15,23,42,0.18)',
                boxShadow: isDarkMode ? '0 6px 18px rgba(0,0,0,0.35)' : '0 6px 18px rgba(15,23,42,0.12)',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 10px',
                    fontSize: 14,
                    color: isDarkMode ? 'rgba(226,232,240,0.85)' : 'rgba(15,23,42,0.65)',
                  }}
                >
                  <MoonOutlined />
                  <SunOutlined />
                </div>
                <div
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: isDarkMode ? 33 : 3,
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: isDarkMode ? 'rgba(226,232,240,0.92)' : 'rgba(255,255,255,0.98)',
                    boxShadow: isDarkMode ? '0 6px 16px rgba(0,0,0,0.35)' : '0 6px 16px rgba(15,23,42,0.18)',
                    transition: 'left 180ms ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isDarkMode ? '#0f172a' : '#4f46e5',
                  }}
                >
                  {isDarkMode ? <SunOutlined /> : <MoonOutlined />}
                </div>
              </div>
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={resetGame}
              type="default"
              style={{
                background: isDarkMode ? 'rgba(15, 23, 42, 0.35)' : 'rgba(255,255,255,0.95)',
                borderColor: isDarkMode ? 'rgba(226,232,240,0.35)' : 'rgba(15,23,42,0.18)',
                color: isDarkMode ? 'rgba(255,255,255,0.92)' : 'rgba(15,23,42,0.92)',
                fontWeight: 650,
              }}
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
          </div>
        </Layout.Header>

        {isResetModalOpen ? (
          <div
            id="cp-fireworks-canvas-host"
            style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 900, overflow: 'hidden' }}
          >
            <canvas ref={trailsCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
            <canvas ref={mainCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          </div>
        ) : null}

        <Modal
          mask={false}
          modalRender={(node) => <div style={{ opacity: 0.9 }}>{node}</div>}
          title="Bảng xếp hạng"
          open={isResetModalOpen}
          onCancel={() => {
            setIsResetModalOpen(false)
            stopCelebration()
          }}
          onOk={() => {
            setIsResetModalOpen(false)
            stopCelebration()
            resetGameNow()
          }}
          okText="Làm mới"
          cancelText="Đóng"
          centered
        >
          <List
            size="small"
            dataSource={ranking}
            renderItem={(r, index) => {
              const isTop = index === 0
              const color = r.total > 0 ? '#10b981' : r.total < 0 ? '#ef4444' : isDarkMode ? 'rgba(226,232,240,0.82)' : '#0f172a'
              return (
                <List.Item style={{ padding: '10px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 12, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 999,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: isTop
                            ? 'rgba(245, 158, 11, 0.14)'
                            : isDarkMode
                              ? 'rgba(226,232,240,0.10)'
                              : 'rgba(15, 23, 42, 0.06)',
                          fontWeight: 800,
                          color: isTop ? '#f59e0b' : isDarkMode ? 'rgba(226,232,240,0.88)' : '#0f172a',
                        }}
                      >
                        {index + 1}
                      </div>
                      <div style={{ fontWeight: 700 }}>{nameById(players, r.personId)}</div>
                      {isTop ? <CrownIcon size={16} /> : null}
                    </div>
                    <div style={{ fontWeight: 900, color }}>{formatVnd(r.total)}</div>
                  </div>
                </List.Item>
              )
            }}
          />
        </Modal>

        <div className="cp-shell">
          <div className="cp-grid">
            <div>
              <Card
                title={<span style={{ fontWeight: 700 }}>Bảng ván</span>}
                extra={
                  <Space size={10}>
                    <Space size={6}>
                      <span style={{ fontSize: 12, fontWeight: 650, color: isDarkMode ? 'rgba(226,232,240,0.72)' : '#334155' }}>Bước nhảy</span>
                      <InputNumber
                        size="middle"
                        value={moneyStep}
                        onChange={(value) => setMoneyStep(value || 5000)}
                        step={1000}
                        min={0}
                        controls={false}
                        className="cp-inputnumber-square-center"
                        formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                        parser={(value) => Number((value ?? '').replace(/\./g, ''))}
                        style={{ width: 140 }}
                        addonBefore={
                          <Button
                            size="middle"
                            type="text"
                            onClick={() => setMoneyStep(Math.max(0, (moneyStep ?? 0) - 5000))}
                            style={{ color: '#ef4444', fontWeight: 800, padding: 0, width: 22, height: 22, lineHeight: '22px' }}
                          >
                            -
                          </Button>
                        }
                        addonAfter={
                          <Button
                            size="middle"
                            type="text"
                            onClick={() => setMoneyStep((moneyStep ?? 0) + 5000)}
                            style={{ color: '#10b981', fontWeight: 800, padding: 0, width: 22, height: 22, lineHeight: '22px' }}
                          >
                            +
                          </Button>
                        }
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
                  className="cp-table-bg"
                  style={{
                    ['--cp-table-bg-image' as any]: `url(${frameBg})`,
                  }}
                  columns={tableColumns as any}
                  dataSource={rounds}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  scroll={tableScroll}
                  sticky
                />
                {rounds.length === 0 && (
                  <div style={{ padding: 18, textAlign: 'center', color: isDarkMode ? 'rgba(226,232,240,0.6)' : '#64748b' }}>
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
                                  <div style={{ fontWeight: 650 }}>{p.name}</div>
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
                                <div style={{ fontWeight: 650 }}>
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
                                  <div style={{ fontWeight: 650 }}>{nameById(players, d.personId)}</div>
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
