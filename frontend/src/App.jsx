import React, { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const APP_TIME_ZONE = import.meta.env.VITE_TIME_ZONE || 'Europe/Amsterdam'

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

function mondayOf(date) {
  const x = new Date(date)
  const day = x.getDay() || 7
  x.setDate(x.getDate() - day + 1)
  return x
}

function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
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
      const target = nextBusinessDay(d0)
      const now = nowInAppTimeZone()
      const after18 = now.getHours() >= 18
      return after18 && toISO(d) === toISO(target)
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
          <button onClick={() => setMonth(addDays(month, -35))}>←</button>
          <button onClick={() => setMonth(addDays(month, 35))}>→</button>
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
              onClick={() => onChange(day)}
              title={disabled ? 'Недоступно по правилам роли' : 'Выбрать дату'}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
      <div className="muted">
        {role === 'employee' && 'Сотруднику доступен только следующий рабочий день после 18:00 текущего дня.'}
        {role === 'manager' && 'Менеджеру доступны текущая и следующая неделя, максимум 5 рабочих дней.'}
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
      setError(data.detail || 'Ошибка входа')
      return
    }
    onLogin(data.access_token, data.user)
  }

  return (
    <div className="page center">
      <div className="card auth">
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
  return (
    <div className="page">
      <div className="topbar">
        <Link to="/">Бронирование</Link>
        <strong>Меню пользователя</strong>
        <button onClick={onLogout}>Выйти</button>
      </div>
      <div className="menu-profile">
        <div className="card">
          <h3>Профиль</h3>
          <div><strong>{user.full_name || user.username}</strong></div>
          <div className="muted">{user.username}</div>
          <div>Роль: {user.role}</div>
          <div>Аккаунт: {user.active ? 'активен' : 'отключен'}</div>
        </div>
      </div>
      {user.role === 'admin' && <AdminPanel />}
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

  const toggleBookings = async () => {
    await fetch(`${API}/booking-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ bookings_enabled: !settings.bookings_enabled }),
    })
    load()
  }

  const createSpot = async () => {
    await fetch(`${API}/spots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ ...newSpot, number: Number(newSpot.number) }),
    })
    setNewSpot({ number: '' })
    load()
  }

  const saveSpot = async (spot, patch) => {
    await fetch(`${API}/spots/${spot.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(patch),
    })
    load()
  }

  const createUser = async () => {
    await fetch(`${API}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(newUser),
    })
    setNewUser({ username: '', password: '', full_name: '', role: 'employee' })
    load()
  }

  const saveUser = async () => {
    if (!editUser) return
    const payload = {
      username: editUser.username,
      full_name: editUser.full_name,
      role: editUser.role,
      active: editUser.active,
    }
    if (editUser.password) payload.password = editUser.password
    await fetch(`${API}/users/${editUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    })
    setEditUser(null)
    load()
  }

  const deleteUser = async (id) => {
    await fetch(`${API}/users/${id}`, { method: 'DELETE', headers })
    load()
  }

  const saveBooking = async () => {
    if (!editBooking) return
    await fetch(`${API}/bookings/${editBooking.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        spot_id: Number(editBooking.spot_id),
        start_date: editBooking.start_date,
        end_date: editBooking.end_date,
      }),
    })
    setEditBooking(null)
    load()
  }

  const deleteBooking = async (id) => {
    await fetch(`${API}/bookings/${id}`, { method: 'DELETE', headers })
    load()
  }

  const deleteSpot = async (id) => {
    await fetch(`${API}/spots/${id}`, { method: 'DELETE', headers })
    load()
  }

  return (
    <div className="admin-grid">
      <section className="card admin-card">
        <div className="row space">
          <h3>Пользователи</h3>
          <div className="muted">{users.length} шт.</div>
        </div>
        <div className="admin-form">
          <input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="Логин" />
          <input value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} placeholder="Имя" />
          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
            <option value="employee">employee</option>
            <option value="manager">manager</option>
            <option value="admin">admin</option>
          </select>
          <input value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="Пароль" />
          <button onClick={createUser}>Добавить</button>
        </div>
        {editUser && (
          <div className="admin-edit">
            <strong>Редактирование пользователя #{editUser.id}</strong>
            <input value={editUser.username} onChange={(e) => setEditUser({ ...editUser, username: e.target.value })} placeholder="Логин" />
            <input value={editUser.full_name} onChange={(e) => setEditUser({ ...editUser, full_name: e.target.value })} placeholder="Имя" />
            <select value={editUser.role} onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}>
              <option value="employee">employee</option>
              <option value="manager">manager</option>
              <option value="admin">admin</option>
            </select>
            <input value={editUser.password || ''} onChange={(e) => setEditUser({ ...editUser, password: e.target.value })} placeholder="Новый пароль" />
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
                <button onClick={() => setEditUser({ ...u, password: '' })}>Редактировать</button>
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
                <button onClick={() => setEditBooking({
                  id: b.id,
                  spot_id: b.spot_id,
                  start_date: b.start_date,
                  end_date: b.end_date,
                })}>Редактировать</button>
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
      const now = nowInAppTimeZone()
      if (now.getHours() >= 18) {
        const d = nextBusinessDay(now)
        setSelectedRange({ start: d, end: d })
      } else {
        setSelectedRange({ start: null, end: null })
      }
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
      setMessage(data.detail || 'Не удалось создать бронирование')
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
      setMessage(data.detail || 'Не удалось удалить бронирование')
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
      <div className="topbar">
        <Link to="/menu">Меню</Link>
        <strong>Бронирование парковки</strong>
        <button onClick={onLogout}>Выйти</button>
      </div>

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
