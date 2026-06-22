import React, { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import logoPlaceholder from './assets/logo-placeholder.svg'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const APP_TIME_ZONE = import.meta.env.VITE_TIME_ZONE || 'Europe/Moscow'

const ROLE_LABELS = {
  employee: 'Сотрудник',
  manager: 'Менеджер',
  admin: 'Администратор',
}

const FIELD_LABELS = {
  username: 'Логин',
  password: 'Пароль',
  full_name: 'Имя',
  role: 'Роль',
  active: 'Активность',
  spot_id: 'Место',
  start_date: 'Дата начала',
  end_date: 'Дата окончания',
  number: 'Номер места',
  bookings_enabled: 'Бронирования',
}

const ERROR_TRANSLATIONS = {
  'Invalid token': 'Сессия истекла или токен недействителен',
  Forbidden: 'Недостаточно прав',
  'Incorrect username or password': 'Неверный логин или пароль',
  'end_date must be >= start_date': 'Дата окончания должна быть не раньше даты начала',
  'end must be >= start': 'Дата окончания должна быть не раньше даты начала',
  'Selected spot is unavailable': 'Выбранное место недоступно',
  'Spot is already booked for this period': 'Место уже забронировано на этот период',
  'You already have an overlapping booking': 'У вас уже есть пересекающееся бронирование',
  'Bookings must start and end on business days': 'Бронирование должно начинаться и заканчиваться в рабочие дни',
  'Booking range must not include weekends': 'Период бронирования не должен включать выходные',
  'Employee can have only one active booking': 'У сотрудника может быть только одно активное бронирование',
  'Employee booking opens at 18:00': 'Бронирование для сотрудника открывается в 18:00',
  'Manager booking must be between 1 and 5 business days': 'Бронирование менеджера должно длиться от 1 до 5 рабочих дней',
  'Manager can book only for current or next week': 'Менеджер может бронировать только текущую или следующую неделю',
  'Manager already has a booking for the current week': 'У менеджера уже есть бронирование на текущую неделю',
  'Manager already has a booking for the next week': 'У менеджера уже есть бронирование на следующую неделю',
  'Booking not found': 'Бронирование не найдено',
  'Username already exists': 'Пользователь с таким логином уже существует',
  'User not found': 'Пользователь не найден',
  'Cannot delete user with bookings; disable the account instead': 'Нельзя удалить пользователя с бронированиями; отключите аккаунт',
  'Spot number already exists': 'Место с таким номером уже существует',
  'Spot not found': 'Место не найдено',
  'Cannot delete spot with bookings; disable it instead': 'Нельзя удалить место с бронированиями; отключите его',
}

function translateErrorMessage(message) {
  if (!message) return ''
  if (ERROR_TRANSLATIONS[message]) return ERROR_TRANSLATIONS[message]
  if (message.includes('String should have at least')) return 'Слишком короткое значение'
  if (message.includes('String should have at most')) return 'Слишком длинное значение'
  if (message.includes('Input should be greater than or equal to')) return 'Значение меньше допустимого'
  if (message.includes('Input should be less than or equal to')) return 'Значение больше допустимого'
  if (message.includes('String should match pattern')) return 'Недопустимый формат'
  if (message.includes('Input should be a valid integer')) return 'Введите целое число'
  if (message.includes('Input should be a valid date')) return 'Введите дату в формате YYYY-MM-DD'
  if (message.includes('Value error,')) return message.replace('Value error,', '').trim()
  const employeeDate = message.match(/^Employee can book only for (.+)$/)
  if (employeeDate) return `Сотрудник может бронировать только на ${employeeDate[1]}`
  return message
}

function getErrorMessage(data, fallback) {
  if (!data?.detail) return fallback
  if (typeof data.detail === 'string') return translateErrorMessage(data.detail)
  if (Array.isArray(data.detail)) {
    return data.detail
      .map((item) => {
        const rawField = item.loc?.filter((part) => part !== 'body').join('.') || 'field'
        const field = FIELD_LABELS[rawField] || rawField
        return `${field}: ${translateErrorMessage(item.msg)}`
      })
      .join('; ')
  }
  return fallback
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function readJson(res) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function toISO(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromISO(s) {
  return new Date(`${s}T00:00:00`)
}

function nowInAppTimeZone() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  }).formatToParts(new Date())

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return new Date(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
}

function isBusinessDay(date) {
  const d = date.getDay()
  return d >= 1 && d <= 5
}

function addDays(date, days) {
  const x = new Date(date)
  x.setDate(x.getDate() + days)
  return x
}

function nextBusinessDay(date) {
  let x = addDays(date, 1)
  while (!isBusinessDay(x)) x = addDays(x, 1)
  return x
}

function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

function mondayOf(date) {
  const x = new Date(date)
  const day = x.getDay() || 7
  x.setDate(x.getDate() - day + 1)
  return x
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

function shiftMonth(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1)
}

function monthGrid(monthDate) {
  const start = startOfMonth(monthDate)
  const end = endOfMonth(monthDate)
  const gridStart = mondayOf(start)
  const gridEnd = addDays(mondayOf(end), 6)
  const days = []
  let cur = new Date(gridStart)
  while (cur <= gridEnd) {
    days.push(new Date(cur))
    cur = addDays(cur, 1)
  }
  return days
}

function Calendar({ role, value, onChange }) {
  const [month, setMonth] = useState(nowInAppTimeZone())
  const today = nowInAppTimeZone()

  useEffect(() => {
    setMonth(nowInAppTimeZone())
  }, [role])

  const days = useMemo(() => monthGrid(month), [month])

  const allowed = (date) => {
    const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    if (d < d0) return false
    if (!isBusinessDay(d)) return false

    if (role === 'employee') {
      if (toISO(d) === toISO(d0)) return true
      const nextDay = nextBusinessDay(d0)
      return nowInAppTimeZone().getHours() >= 18 && toISO(d) === toISO(nextDay)
    }
    if (role === 'manager') {
      const currentWeekStart = mondayOf(d0)
      const currentWeekEnd = addDays(currentWeekStart, 6)
      const nextWeekStart = addDays(currentWeekEnd, 1)
      const nextWeekEnd = addDays(nextWeekStart, 6)
      return (d >= currentWeekStart && d <= currentWeekEnd) || (d >= nextWeekStart && d <= nextWeekEnd)
    }
    return true
  }

  const label = `${month.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}`

  return (
    <div className="card">
      <div className="row space">
        <h3>Календарь</h3>
        <div className="row">
          <button onClick={() => setMonth(shiftMonth(month, -1))}>←</button>
          <button onClick={() => setMonth(shiftMonth(month, 1))}>→</button>
        </div>
      </div>
      <div className="muted">{label}</div>
      <div className="hint">
        Для бронирования, выберите даты начала и окончания. Бронирование на один день выполняется двойным нажатием на дату.
      </div>

      <div className="calendar">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((x) => (
          <div key={x} className="calendar-head">{x}</div>
        ))}
        {days.map((day) => {
          const iso = toISO(day)
          const selected = value.start && value.end && toISO(value.start) === iso && toISO(value.end) === iso
          const inRange = value.start && value.end && day >= value.start && day <= value.end
          const disabled = !allowed(day)
          return (
            <button
              key={iso}
              className={`calendar-cell ${sameMonth(day, month) ? '' : 'calendar-fade'} ${selected ? 'selected' : ''} ${inRange ? 'inrange' : ''}`}
              disabled={disabled}
              onClick={() => {
                onChange(day)
                if (!sameMonth(day, month)) setMonth(startOfMonth(day))
              }}
              data-date={iso}
              title={disabled ? 'Недоступно по правилам роли' : 'Выбрать дату'}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
      <div className="muted">
        {role === 'employee' && 'Сотруднику доступно бронирование на сегодня, а после 18:00 — также на следующий рабочий день.'}
        {role === 'manager' && 'Менеджеру доступны несколько непересекающихся бронирований в текущей и следующей неделе, каждое — максимум на 5 рабочих дней.'}
        {role === 'admin' && 'Администратор может бронировать любой свободный слот на любой срок.'}
      </div>
    </div>
  )
}

function SpotsGrid({ spots, selectedSpotId, onSelect }) {
  return (
    <div className="card spots-card">
      <div className="row space">
        <h3>Места</h3>
        <div className="muted">{spots.length} свободно</div>
      </div>
      {spots.length === 0 ? (
        <div className="empty-hint">Отображаются после выбора дат</div>
      ) : (
        <div className="spots">
          {spots.map((s) => (
            <button
            key={s.id}
            className={`spot ${selectedSpotId === s.id ? 'selected' : ''}`}
            onClick={() => onSelect(s.id)}
            title={`Место ${s.number}`}
          >
            {s.number}
          </button>
        ))}
      </div>
      )}
    </div>
  )
}

function BookingsList({ title, items, onDelete, admin }) {
  return (
    <div className="card">
      <div className="row space">
        <h3>{title}</h3>
        <div className="muted">{items.length} шт.</div>
      </div>
      <div className="list">
        {items.length === 0 && <div className="muted">Пока нет бронирований</div>}
        {items.map((b) => (
          <div className="list-item" key={b.id}>
            <div>
              <strong>{b.spot_number}</strong> · {b.start_date} → {b.end_date}
              <div className="muted">{admin ? `${b.username} (${b.role})` : ''}</div>
            </div>
            {onDelete && (
              <button className="icon-button danger" onClick={() => onDelete(b)} aria-label="Удалить бронирование">
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ConfirmDialog({ title, children, confirmText, danger, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button onClick={onCancel}>Отмена</button>
          <button className={danger ? 'danger-button' : 'primary-button'} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

function UserSummary({ user }) {
  return (
    <div className="user-summary">
      <div className="user-summary-main">{user.full_name || user.username}</div>
      <div className="user-summary-meta">
        {user.username} · {ROLE_LABELS[user.role] || user.role} · {user.active ? 'активен' : 'отключен'}
      </div>
    </div>
  )
}

function AppHeader({ user, title, onLogout, adminView }) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <img className="brand-logo" src={logoPlaceholder} alt="Parking Book" />
        <strong>{title}</strong>
        {user.role === 'admin' && (
          <Link className="nav-link" to={adminView ? '/' : '/menu'}>
            {adminView ? 'Бронирование' : 'Администрирование'}
          </Link>
        )}
      </div>
      <div className="topbar-right">
        <UserSummary user={user} />
        <button onClick={onLogout}>Выйти</button>
      </div>
    </div>
  )
}

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('employee')
  const [password, setPassword] = useState('password')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const body = new URLSearchParams()
    body.set('username', username)
    body.set('password', password)
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = await res.json()
    if (!res.ok) {
      setError(getErrorMessage(data, 'Ошибка входа'))
      return
    }
    onLogin(data.access_token, data.user)
  }

  return (
    <div className="page center">
      <div className="card auth">
        <div className="auth-brand">
          <img className="auth-logo" src={logoPlaceholder} alt="Парковка" />
          <div>
            <h1>Парковка</h1>
            <div className="muted">Бронирование парковочных мест</div>
          </div>
        </div>
        <h2>Вход</h2>
        <form onSubmit={submit} className="stack">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Логин" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Пароль" />
          <button type="submit">Войти</button>
          {error && <div className="error">{error}</div>}
        </form>
        <div className="muted">Тестовые учетные записи: employee / manager / admin, пароль: password</div>
      </div>
    </div>
  )
}

function UserMenuPage({ user, onLogout }) {
  if (user.role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="page">
      <AppHeader user={user} title="Администрирование" onLogout={onLogout} adminView />
      <AdminPanel />
    </div>
  )
}


function AdminPanel() {
  const token = localStorage.getItem('token') || ''
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const [users, setUsers] = useState([])
  const [spots, setSpots] = useState([])
  const [bookings, setBookings] = useState([])
  const [settings, setSettings] = useState({ bookings_enabled: true })
  const [newSpot, setNewSpot] = useState({ number: '' })
  const [newUser, setNewUser] = useState({ username: '', password: '', full_name: '', role: 'employee' })
  const [editUser, setEditUser] = useState(null)
  const [editBooking, setEditBooking] = useState(null)
  const [adminMessage, setAdminMessage] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminConfirm, setAdminConfirm] = useState(null)
  const [reportDate, setReportDate] = useState(toISO(nowInAppTimeZone()))

  const validateUserForm = (payload, requirePassword) => {
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(payload.username || '')) {
      return 'Логин: 3-64 символа, латиница, цифры, точка, дефис или подчеркивание'
    }
    if (payload.full_name && payload.full_name.length > 128) {
      return 'Имя: максимум 128 символов'
    }
    if (requirePassword || payload.password) {
      if (!payload.password || payload.password.length < 8 || payload.password.length > 128) {
        return 'Пароль: 8-128 символов'
      }
    }
    return ''
  }

  const load = async () => {
    const [u, s, b, cfg] = await Promise.all([
      fetch(`${API}/users`, { headers }).then(r => r.json()),
      fetch(`${API}/spots?include_inactive=true`, { headers }).then(r => r.json()),
      fetch(`${API}/bookings`, { headers }).then(r => r.json()),
      fetch(`${API}/booking-settings`, { headers }).then(r => r.json()),
    ])
    setUsers(u)
    setSpots(s)
    setBookings(b)
    setSettings(cfg)
  }

  useEffect(() => { load() }, [])

  const clearAdminStatus = () => {
    setAdminError('')
    setAdminMessage('')
  }

  const requestAdminConfirmation = (config) => {
    clearAdminStatus()
    setAdminConfirm(config)
  }

  const runAdminRequest = async ({ request, successMessage, fallbackError, afterSuccess }) => {
    clearAdminStatus()
    const res = await request()
    const data = await readJson(res)
    if (!res.ok) {
      setAdminError(getErrorMessage(data, fallbackError))
      return null
    }
    if (successMessage) {
      setAdminMessage(typeof successMessage === 'function' ? successMessage(data) : successMessage)
    }
    if (afterSuccess) afterSuccess(data)
    await load()
    return data
  }

  const toggleBookings = async () => {
    const nextEnabled = !settings.bookings_enabled
    requestAdminConfirmation({
      title: nextEnabled ? 'Включить бронирования?' : 'Отключить бронирования?',
      confirmText: nextEnabled ? 'Включить' : 'Отключить',
      danger: !nextEnabled,
      lines: [
        ['Действие', nextEnabled ? 'Включить бронирования для всех' : 'Отключить бронирования для всех'],
      ],
      onConfirm: () => runAdminRequest({
        request: () => fetch(`${API}/booking-settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ bookings_enabled: nextEnabled }),
        }),
        successMessage: nextEnabled ? 'Бронирования включены' : 'Бронирования отключены',
        fallbackError: 'Не удалось изменить настройки бронирования',
      }),
    })
  }

  const createSpot = async () => {
    const number = Number(newSpot.number)
    if (!Number.isInteger(number) || number < 1 || number > 10000) {
      setAdminError('Номер места должен быть целым числом от 1 до 10000')
      setAdminMessage('')
      return
    }
    requestAdminConfirmation({
      title: 'Добавить парковочное место?',
      confirmText: 'Добавить',
      lines: [['Номер места', number]],
      onConfirm: () => runAdminRequest({
        request: () => fetch(`${API}/spots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ ...newSpot, number }),
        }),
        successMessage: (data) => `Место ${data.number} добавлено`,
        fallbackError: 'Не удалось добавить место',
        afterSuccess: () => setNewSpot({ number: '' }),
      }),
    })
  }

  const saveSpot = async (spot, patch) => {
    const nextActive = patch.active
    requestAdminConfirmation({
      title: nextActive ? 'Включить парковочное место?' : 'Отключить парковочное место?',
      confirmText: nextActive ? 'Включить' : 'Отключить',
      danger: !nextActive,
      lines: [
        ['Место', spot.number],
        ['Новое состояние', nextActive ? 'активно' : 'отключено'],
      ],
      onConfirm: () => runAdminRequest({
        request: () => fetch(`${API}/spots/${spot.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(patch),
        }),
        successMessage: nextActive ? `Место ${spot.number} включено` : `Место ${spot.number} отключено`,
        fallbackError: 'Не удалось изменить место',
      }),
    })
  }

  const createUser = async () => {
    clearAdminStatus()
    const validationError = validateUserForm(newUser, true)
    if (validationError) {
      setAdminError(validationError)
      return
    }
    requestAdminConfirmation({
      title: 'Добавить пользователя?',
      confirmText: 'Добавить',
      lines: [
        ['Логин', newUser.username],
        ['Имя', newUser.full_name || 'Без имени'],
        ['Роль', ROLE_LABELS[newUser.role] || newUser.role],
      ],
      onConfirm: () => runAdminRequest({
        request: () => fetch(`${API}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(newUser),
        }),
        successMessage: (data) => `Пользователь ${data.username} добавлен`,
        fallbackError: 'Не удалось добавить пользователя',
        afterSuccess: () => setNewUser({ username: '', password: '', full_name: '', role: 'employee' }),
      }),
    })
  }

  const saveUser = async () => {
    if (!editUser) return
    clearAdminStatus()
    const payload = {
      username: editUser.username,
      full_name: editUser.full_name,
      role: editUser.role,
      active: editUser.active,
    }
    if (editUser.password) payload.password = editUser.password
    const validationError = validateUserForm(payload, false)
    if (validationError) {
      setAdminError(validationError)
      return
    }
    requestAdminConfirmation({
      title: 'Сохранить изменения пользователя?',
      confirmText: 'Сохранить',
      lines: [
        ['Логин', payload.username],
        ['Имя', payload.full_name || 'Без имени'],
        ['Роль', ROLE_LABELS[payload.role] || payload.role],
        ['Аккаунт', payload.active ? 'активен' : 'отключен'],
        ['Пароль', payload.password ? 'будет изменен' : 'без изменений'],
      ],
      onConfirm: () => runAdminRequest({
        request: () => fetch(`${API}/users/${editUser.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(payload),
        }),
        successMessage: (data) => `Пользователь ${data.username} сохранен`,
        fallbackError: 'Не удалось сохранить пользователя',
        afterSuccess: () => setEditUser(null),
      }),
    })
  }

  const deleteUser = async (id) => {
    const target = users.find((item) => item.id === id)
    requestAdminConfirmation({
      title: 'Удалить пользователя?',
      confirmText: 'Удалить',
      danger: true,
      lines: [
        ['Логин', target?.username || id],
        ['Имя', target?.full_name || 'Без имени'],
      ],
      onConfirm: () => runAdminRequest({
        request: () => fetch(`${API}/users/${id}`, { method: 'DELETE', headers }),
        successMessage: 'Пользователь удален',
        fallbackError: 'Не удалось удалить пользователя',
      }),
    })
  }

  const saveBooking = async () => {
    if (!editBooking) return
    const payload = {
      spot_id: Number(editBooking.spot_id),
      start_date: editBooking.start_date,
      end_date: editBooking.end_date,
    }
    if (!Number.isInteger(payload.spot_id) || payload.spot_id < 1) {
      setAdminError('ID места должен быть положительным числом')
      setAdminMessage('')
      return
    }
    if (!payload.start_date || !payload.end_date) {
      setAdminError('Укажите даты начала и окончания')
      setAdminMessage('')
      return
    }
    requestAdminConfirmation({
      title: 'Сохранить изменения бронирования?',
      confirmText: 'Сохранить',
      lines: [
        ['Бронь', `#${editBooking.id}`],
        ['ID места', payload.spot_id],
        ['Период', `${payload.start_date} → ${payload.end_date}`],
      ],
      onConfirm: () => runAdminRequest({
        request: () => fetch(`${API}/bookings/${editBooking.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(payload),
        }),
        successMessage: (data) => `Бронирование #${data.id} сохранено`,
        fallbackError: 'Не удалось сохранить бронирование',
        afterSuccess: () => setEditBooking(null),
      }),
    })
  }

  const deleteBooking = async (id) => {
    const target = bookings.find((item) => item.id === id)
    requestAdminConfirmation({
      title: 'Удалить бронирование?',
      confirmText: 'Удалить',
      danger: true,
      lines: [
        ['Бронь', `#${id}`],
        ['Пользователь', target?.username || 'неизвестно'],
        ['Место', target?.spot_number || 'неизвестно'],
        ['Период', target ? `${target.start_date} → ${target.end_date}` : 'неизвестно'],
      ],
      onConfirm: () => runAdminRequest({
        request: () => fetch(`${API}/bookings/${id}`, { method: 'DELETE', headers }),
        successMessage: 'Бронирование удалено',
        fallbackError: 'Не удалось удалить бронирование',
      }),
    })
  }

  const deleteSpot = async (id) => {
    const target = spots.find((item) => item.id === id)
    requestAdminConfirmation({
      title: 'Удалить парковочное место?',
      confirmText: 'Удалить',
      danger: true,
      lines: [['Место', target?.number || id]],
      onConfirm: () => runAdminRequest({
        request: () => fetch(`${API}/spots/${id}`, { method: 'DELETE', headers }),
        successMessage: 'Парковочное место удалено',
        fallbackError: 'Не удалось удалить место',
      }),
    })
  }

  const downloadBookingsReport = (dateIso) => {
    clearAdminStatus()
    if (!dateIso) {
      setAdminError('Выберите дату для отчета')
      return
    }

    const dayBookings = bookings.filter((booking) => (
      booking.start_date <= dateIso && dateIso <= booking.end_date
    ))

    const rows = dayBookings.map((booking) => [
      booking.id,
      booking.spot_number,
      booking.username,
      booking.full_name || '',
      ROLE_LABELS[booking.role] || booking.role,
      booking.start_date,
      booking.end_date,
      booking.created_at ? new Date(booking.created_at).toLocaleString('ru-RU') : '',
    ])

    const html = `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    table { border-collapse: collapse; font-family: Arial, sans-serif; }
    th, td { border: 1px solid #5a6673; padding: 6px 8px; white-space: nowrap; }
    th { background: #ff6a1a; color: #ffffff; font-weight: 700; }
    .empty { color: #5a6673; }
  </style>
</head>
<body>
  <h2>Бронирования на ${escapeHtml(dateIso)}</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Место</th>
        <th>Логин</th>
        <th>Имя</th>
        <th>Роль</th>
        <th>Начало</th>
        <th>Окончание</th>
        <th>Создано</th>
      </tr>
    </thead>
    <tbody>
      ${rows.length > 0
        ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
        : '<tr><td class="empty" colspan="8">На выбранную дату бронирований нет</td></tr>'}
    </tbody>
  </table>
</body>
</html>`

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `parking-bookings-${dateIso}.xls`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setAdminMessage(`Отчет за ${dateIso} сформирован`)
  }

  return (
    <>
    {(adminError || adminMessage) && (
      <div className={adminError ? 'status-message status-error' : 'status-message status-info'}>
        {adminError || adminMessage}
      </div>
    )}
    <section className="card reports-panel">
      <div className="reports-title">
        <h3>Отчетность</h3>
        <div className="muted">Excel-файл с бронированиями на выбранный день</div>
      </div>
      <div className="reports-actions">
        <button onClick={() => downloadBookingsReport(toISO(nowInAppTimeZone()))}>На сегодня</button>
        <div className="report-date-control">
          <input
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            type="date"
            aria-label="Дата отчета"
          />
          <button onClick={() => downloadBookingsReport(reportDate)}>На дату</button>
        </div>
      </div>
    </section>
    <div className="admin-grid">
      <section className="card admin-card">
        <div className="row space">
          <h3>Пользователи</h3>
          <div className="muted">{users.length} шт.</div>
        </div>
        <div className="admin-form">
          <input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="Логин" minLength={3} maxLength={64} pattern="[A-Za-z0-9_.-]+" required />
          <input value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} placeholder="Имя" />
          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
            <option value="employee">Сотрудник</option>
            <option value="manager">Менеджер</option>
            <option value="admin">Администратор</option>
          </select>
          <input value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} type="password" placeholder="Пароль" minLength={8} maxLength={128} required />
          <button onClick={createUser}>Добавить</button>
        </div>
        {editUser && (
          <div className="admin-edit">
            <strong>Редактирование пользователя #{editUser.id}</strong>
            <input value={editUser.username} onChange={(e) => setEditUser({ ...editUser, username: e.target.value })} placeholder="Логин" minLength={3} maxLength={64} pattern="[A-Za-z0-9_.-]+" required />
            <input value={editUser.full_name} onChange={(e) => setEditUser({ ...editUser, full_name: e.target.value })} placeholder="Имя" />
            <select value={editUser.role} onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}>
              <option value="employee">Сотрудник</option>
              <option value="manager">Менеджер</option>
              <option value="admin">Администратор</option>
            </select>
            <input value={editUser.password || ''} onChange={(e) => setEditUser({ ...editUser, password: e.target.value })} type="password" placeholder="Новый пароль" minLength={8} maxLength={128} />
            <label className="checkbox-row">
              <input type="checkbox" checked={editUser.active} onChange={(e) => setEditUser({ ...editUser, active: e.target.checked })} />
              Активен
            </label>
            <div className="row">
              <button onClick={saveUser}>Сохранить</button>
              <button onClick={() => setEditUser(null)}>Отмена</button>
            </div>
          </div>
        )}
        <div className="list compact-list">
          {users.map(u => (
            <div className="list-item" key={u.id}>
              <div>
                <strong>{u.username}</strong> · {u.role}
                <div className="muted">{u.full_name || 'Без имени'} · {u.active ? 'активен' : 'отключен'}</div>
              </div>
              <div className="row">
                <button onClick={() => { clearAdminStatus(); setEditUser({ ...u, password: '' }) }}>Редактировать</button>
                <button className="danger" onClick={() => deleteUser(u.id)}>Удалить</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card admin-card">
        <div className="row space">
          <h3>Бронирования</h3>
          <button onClick={toggleBookings}>{settings.bookings_enabled ? 'Отключить для всех' : 'Включить'}</button>
        </div>
        <div className={settings.bookings_enabled ? 'info' : 'error'}>
          {settings.bookings_enabled ? 'Бронирования включены' : 'Бронирования отключены для всех'}
        </div>
        {editBooking && (
          <div className="admin-edit">
            <strong>Редактирование брони #{editBooking.id}</strong>
            <input value={editBooking.spot_id} onChange={(e) => setEditBooking({ ...editBooking, spot_id: e.target.value })} placeholder="ID места" />
            <input value={editBooking.start_date} onChange={(e) => setEditBooking({ ...editBooking, start_date: e.target.value })} placeholder="YYYY-MM-DD" />
            <input value={editBooking.end_date} onChange={(e) => setEditBooking({ ...editBooking, end_date: e.target.value })} placeholder="YYYY-MM-DD" />
            <div className="row">
              <button onClick={saveBooking}>Сохранить</button>
              <button onClick={() => setEditBooking(null)}>Отмена</button>
            </div>
          </div>
        )}
        <div className="list compact-list">
          {bookings.length === 0 && <div className="muted">Бронирований пока нет</div>}
          {bookings.map(b => (
            <div className="list-item" key={b.id}>
              <div>
                <strong>Место {b.spot_number}</strong> · {b.start_date} → {b.end_date}
                <div className="muted">{b.username}</div>
              </div>
              <div className="row">
                <button onClick={() => { clearAdminStatus(); setEditBooking({
                  id: b.id,
                  spot_id: b.spot_id,
                  start_date: b.start_date,
                  end_date: b.end_date,
                }) }}>Редактировать</button>
                <button className="danger" onClick={() => deleteBooking(b.id)}>Удалить</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card admin-card">
        <div className="row space">
          <h3>Парковочные места</h3>
          <div className="muted">{spots.length} шт.</div>
        </div>
        <div className="admin-form">
          <input value={newSpot.number} onChange={(e) => setNewSpot({ ...newSpot, number: e.target.value })} placeholder="Номер места" />
          <button onClick={createSpot}>Добавить</button>
        </div>
        <div className="list compact-list">
          {spots.map(s => (
            <div className="list-item" key={s.id}>
              <div>
                <strong>Место {s.number}</strong>
                <div className="muted">{s.active ? 'активно' : 'отключено'}</div>
              </div>
              <div className="row">
                <button onClick={() => saveSpot(s, { active: !s.active })}>{s.active ? 'Отключить' : 'Включить'}</button>
                <button className="danger" onClick={() => deleteSpot(s.id)}>Удалить</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
    {adminConfirm && (
      <ConfirmDialog
        title={adminConfirm.title}
        confirmText={adminConfirm.confirmText}
        danger={adminConfirm.danger}
        onConfirm={async () => {
          const action = adminConfirm.onConfirm
          setAdminConfirm(null)
          await action()
        }}
        onCancel={() => setAdminConfirm(null)}
      >
        {adminConfirm.lines?.map(([label, value]) => (
          <div className="modal-line" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </ConfirmDialog>
    )}
    </>
  )
}
function BookingPage({ token, user, onLogout }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const [selectedRange, setSelectedRange] = useState({ start: null, end: null })
  const [spots, setSpots] = useState([])
  const [myBookings, setMyBookings] = useState([])
  const [selectedSpotId, setSelectedSpotId] = useState(null)
  const [message, setMessage] = useState('')
  const [bookingToConfirm, setBookingToConfirm] = useState(null)
  const [bookingToDelete, setBookingToDelete] = useState(null)

  const load = async (range = selectedRange) => {
    const mine = await fetch(`${API}/bookings/my`, { headers }).then(r => r.json())
    setMyBookings(mine)

    if (!range.start || !range.end) {
      setSpots([])
      setSelectedSpotId(null)
      return
    }

    const start = toISO(range.start)
    const end = toISO(range.end)
    const avail = await fetch(`${API}/availability?start=${start}&end=${end}`, { headers }).then(r => r.json())
    setSpots(avail.available_spots)
    if (!avail.available_spots.some(s => s.id === selectedSpotId)) {
      setSelectedSpotId(avail.available_spots[0]?.id || null)
    }
  }

  useEffect(() => {
    if (user.role === 'employee') {
      const today = nowInAppTimeZone()
      setSelectedRange(isBusinessDay(today) ? { start: today, end: today } : { start: null, end: null })
    }
  }, [user.role])

  useEffect(() => {
    load(selectedRange)
  }, [selectedRange.start, selectedRange.end])

  const pickDate = (day) => {
    if (user.role === 'employee') {
      setSelectedRange({ start: day, end: day })
      return
    }
    if (!selectedRange.start || (selectedRange.start && selectedRange.end)) {
      setSelectedRange({ start: day, end: null })
    } else {
      const start = selectedRange.start < day ? selectedRange.start : day
      const end = selectedRange.start < day ? day : selectedRange.start
      setSelectedRange({ start, end })
    }
  }

  const selectedSpot = spots.find((s) => s.id === selectedSpotId)

  const openBookingConfirm = () => {
    setMessage('')
    if (!selectedRange.start || !selectedRange.end || !selectedSpotId) {
      setMessage('Выберите период и место')
      return
    }
    setBookingToConfirm({
      spot_id: selectedSpotId,
      spot_number: selectedSpot?.number || selectedSpotId,
      start_date: toISO(selectedRange.start),
      end_date: toISO(selectedRange.end),
    })
  }

  const createBooking = async () => {
    setMessage('')
    if (!bookingToConfirm) return
    const res = await fetch(`${API}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        spot_id: bookingToConfirm.spot_id,
        start_date: bookingToConfirm.start_date,
        end_date: bookingToConfirm.end_date,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setMessage(getErrorMessage(data, 'Не удалось создать бронирование'))
      setBookingToConfirm(null)
      return
    }
    setMessage('Бронирование создано')
    setBookingToConfirm(null)
    setSelectedRange({ start: null, end: null })
    setSpots([])
    setSelectedSpotId(null)
    load({ start: null, end: null })
  }

  const deleteMyBooking = async () => {
    if (!bookingToDelete) return
    const res = await fetch(`${API}/bookings/${bookingToDelete.id}`, { method: 'DELETE', headers })
    if (!res.ok) {
      const data = await res.json()
      setMessage(getErrorMessage(data, 'Не удалось удалить бронирование'))
      setBookingToDelete(null)
      return
    }
    setBookingToDelete(null)
    setMessage('Бронирование удалено')
    load(selectedRange)
  }

  const myRangeLabel = selectedRange.start
    ? `${toISO(selectedRange.start)} → ${toISO(selectedRange.end || selectedRange.start)}`
    : 'не выбран'

  return (
    <div className="page">
      <AppHeader user={user} title="Бронирование парковки" onLogout={onLogout} />

      <div className="booking-layout">
        <div className="booking-calendar">
          <Calendar role={user.role} value={selectedRange} onChange={pickDate} />
        </div>
        <div className="booking-spots">
          <SpotsGrid spots={spots} selectedSpotId={selectedSpotId} onSelect={setSelectedSpotId} />
        </div>
        <div className="card period-card booking-period">
          <h3>Выбор периода</h3>
          <div>Текущий выбор: <strong>{myRangeLabel}</strong></div>
          <button onClick={openBookingConfirm}>Забронировать выбранное место</button>
          {message && <div className="info">{message}</div>}
        </div>
        <div className="booking-list">
          <BookingsList title="Мои бронирования" items={myBookings} onDelete={setBookingToDelete} />
        </div>
      </div>

      {bookingToConfirm && (
        <ConfirmDialog
          title="Подтвердить бронирование"
          confirmText="Забронировать"
          onConfirm={createBooking}
          onCancel={() => setBookingToConfirm(null)}
        >
          <div className="modal-line"><span>Место</span><strong>{bookingToConfirm.spot_number}</strong></div>
          <div className="modal-line"><span>Начало</span><strong>{bookingToConfirm.start_date}</strong></div>
          <div className="modal-line"><span>Окончание</span><strong>{bookingToConfirm.end_date}</strong></div>
        </ConfirmDialog>
      )}

      {bookingToDelete && (
        <ConfirmDialog
          title="Удалить бронирование?"
          confirmText="Удалить"
          danger
          onConfirm={deleteMyBooking}
          onCancel={() => setBookingToDelete(null)}
        >
          <div className="modal-line"><span>Место</span><strong>{bookingToDelete.spot_number}</strong></div>
          <div className="modal-line"><span>Период</span><strong>{bookingToDelete.start_date} → {bookingToDelete.end_date}</strong></div>
        </ConfirmDialog>
      )}
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setLoading(false)
        return
      }
      const res = await fetch(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setToken('')
        setUser(null)
        localStorage.removeItem('token')
        localStorage.removeItem('user')
      } else {
        const me = await res.json()
        setUser(me)
      }
      setLoading(false)
    }
    run()
  }, [])

  const login = (newToken, me) => {
    setToken(newToken)
    setUser(me)
    localStorage.setItem('token', newToken)
    localStorage.setItem('user', JSON.stringify(me))
  }

  const logout = () => {
    setToken('')
    setUser(null)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  if (loading) return <div className="page center">Загрузка...</div>
  if (!token || !user) return <LoginPage onLogin={login} />

  return (
    <Routes>
      <Route path="/" element={<BookingPage token={token} user={user} onLogout={logout} />} />
      <Route path="/menu" element={<UserMenuPage user={user} onLogout={logout} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
