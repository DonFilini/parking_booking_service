import React, { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function toISO(d) {
  return d.toISOString().slice(0, 10)
}

function fromISO(s) {
  return new Date(`${s}T00:00:00`)
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
  const [month, setMonth] = useState(new Date())
  const today = new Date()

  useEffect(() => {
    setMonth(new Date())
  }, [role])

  const days = useMemo(() => monthGrid(month), [month])

  const allowed = (date) => {
    const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    if (d < d0) return false
    if (!isBusinessDay(d)) return false

    if (role === 'employee') {
      const target = nextBusinessDay(d0)
      const now = new Date()
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
    <div className="card">
      <h3>Места</h3>
      <div className="spots">
        {spots.map((s) => (
          <button
            key={s.id}
            className={`spot ${selectedSpotId === s.id ? 'selected' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <div>{s.code}</div>
            <small>Этаж {s.floor}</small>
          </button>
        ))}
      </div>
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
              <strong>{b.spot_code}</strong> · {b.start_date} → {b.end_date}
              <div className="muted">{admin ? `${b.username} (${b.role})` : ''}</div>
            </div>
            {onDelete && <button onClick={() => onDelete(b.id)}>Удалить</button>}
          </div>
        ))}
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
      <div className="grid-2">
        <div className="card">
          <h3>Профиль</h3>
          <div><strong>{user.full_name || user.username}</strong></div>
          <div className="muted">{user.username}</div>
          <div>Роль: {user.role}</div>
          <div>Аккаунт: {user.active ? 'активен' : 'отключен'}</div>
        </div>
        <div className="card">
          <h3>Навигация</h3>
          <div className="stack">
            <Link to="/">Главная — бронирования</Link>
            {user.role === 'admin' && <a href="#admin">Администрирование</a>}
          </div>
        </div>
      </div>
    </div>
  )
}


function AdminPanel({ token }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const [users, setUsers] = useState([])
  const [spots, setSpots] = useState([])
  const [bookings, setBookings] = useState([])
  const [newSpot, setNewSpot] = useState({ code: '', floor: 'A' })
  const [newUser, setNewUser] = useState({ username: '', password: '', full_name: '', role: 'employee' })
  const [editBooking, setEditBooking] = useState(null)

  const load = async () => {
    const [u, s, b] = await Promise.all([
      fetch(`${API}/users`, { headers }).then(r => r.json()),
      fetch(`${API}/spots?include_inactive=true`, { headers }).then(r => r.json()),
      fetch(`${API}/bookings`, { headers }).then(r => r.json()),
    ])
    setUsers(u)
    setSpots(s)
    setBookings(b)
  }

  useEffect(() => { load() }, [])

  const createSpot = async () => {
    await fetch(`${API}/spots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(newSpot),
    })
    setNewSpot({ code: '', floor: 'A' })
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

  const toggleSpot = async (spot) => {
    await fetch(`${API}/spots/${spot.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ active: !spot.active }),
    })
    load()
  }

  const deleteSpot = async (id) => {
    await fetch(`${API}/spots/${id}`, { method: 'DELETE', headers })
    load()
  }

  return (
    <div className="card" id="admin">
      <h3>Администрирование</h3>
      <div className="grid-2">
        <div>
          <h4>Добавить место</h4>
          <div className="stack">
            <input value={newSpot.code} onChange={(e) => setNewSpot({ ...newSpot, code: e.target.value })} placeholder="P-31" />
            <input value={newSpot.floor} onChange={(e) => setNewSpot({ ...newSpot, floor: e.target.value })} placeholder="A" />
            <button onClick={createSpot}>Добавить</button>
          </div>

          <h4>Пользователи</h4>
          <div className="stack">
            <input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="username" />
            <input value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="password" />
            <input value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} placeholder="ФИО" />
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
              <option value="employee">employee</option>
              <option value="manager">manager</option>
              <option value="admin">admin</option>
            </select>
            <button onClick={createUser}>Создать пользователя</button>
          </div>
        </div>
        <div>
          <h4>Список мест</h4>
          <div className="list">
            {spots.map(s => (
              <div className="list-item" key={s.id}>
                <div>
                  <strong>{s.code}</strong> · {s.floor}
                  <div className="muted">{s.active ? 'active' : 'inactive'}</div>
                </div>
                <div className="row">
                  <button onClick={() => toggleSpot(s)}>{s.active ? 'Отключить' : 'Включить'}</button>
                  <button onClick={() => deleteSpot(s.id)}>Удалить</button>
                </div>
              </div>
            ))}
          </div>

          <h4>Список пользователей</h4>
          <div className="list">
            {users.map(u => (
              <div className="list-item" key={u.id}>
                <div>
                  <strong>{u.username}</strong> · {u.role}
                  <div className="muted">{u.full_name}</div>
                </div>
              </div>
            ))}
          </div>

          <h4>Бронирования</h4>
          {editBooking && (
            <div className="stack card" style={{ marginBottom: 12 }}>
              <strong>Редактирование брони #{editBooking.id}</strong>
              <input
                value={editBooking.spot_id}
                onChange={(e) => setEditBooking({ ...editBooking, spot_id: e.target.value })}
                placeholder="spot_id"
              />
              <input
                value={editBooking.start_date}
                onChange={(e) => setEditBooking({ ...editBooking, start_date: e.target.value })}
                placeholder="YYYY-MM-DD"
              />
              <input
                value={editBooking.end_date}
                onChange={(e) => setEditBooking({ ...editBooking, end_date: e.target.value })}
                placeholder="YYYY-MM-DD"
              />
              <div className="row">
                <button onClick={saveBooking}>Сохранить</button>
                <button onClick={() => setEditBooking(null)}>Отмена</button>
              </div>
            </div>
          )}
          <div className="list">
            {bookings.map(b => (
              <div className="list-item" key={b.id}>
                <div>
                  <strong>{b.spot_code}</strong> · {b.username} · {b.start_date} → {b.end_date}
                </div>
                <div className="row">
                  <button onClick={() => setEditBooking({
                    id: b.id,
                    spot_id: b.spot_id,
                    start_date: b.start_date,
                    end_date: b.end_date,
                  })}>Редактировать</button>
                  <button onClick={() => deleteBooking(b.id)}>Удалить</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
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
  const navigate = useNavigate()

  const load = async (range = selectedRange) => {
    if (!range.start) return
    const start = toISO(range.start)
    const end = toISO(range.end || range.start)
    const [avail, mine] = await Promise.all([
      fetch(`${API}/availability?start=${start}&end=${end}`, { headers }).then(r => r.json()),
      fetch(`${API}/bookings/my`, { headers }).then(r => r.json()),
    ])
    setSpots(avail.available_spots)
    setMyBookings(mine)
    if (!avail.available_spots.some(s => s.id === selectedSpotId)) {
      setSelectedSpotId(avail.available_spots[0]?.id || null)
    }
  }

  useEffect(() => {
    if (user.role === 'employee') {
      const now = new Date()
      if (now.getHours() >= 18) {
        const d = nextBusinessDay(now)
        setSelectedRange({ start: d, end: d })
      } else {
        setSelectedRange({ start: null, end: null })
      }
    }
  }, [user.role])

  useEffect(() => {
    if (selectedRange.start) load(selectedRange)
  }, [selectedRange.start, selectedRange.end])

  const pickDate = (day) => {
    if (user.role === 'employee') {
      setSelectedRange({ start: day, end: day })
      return
    }
    if (!selectedRange.start || (selectedRange.start && selectedRange.end)) {
      setSelectedRange({ start: day, end: day })
    } else {
      const start = selectedRange.start < day ? selectedRange.start : day
      const end = selectedRange.start < day ? day : selectedRange.start
      setSelectedRange({ start, end })
    }
  }

  const createBooking = async () => {
    setMessage('')
    if (!selectedRange.start || !selectedRange.end || !selectedSpotId) return
    const res = await fetch(`${API}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        spot_id: selectedSpotId,
        start_date: toISO(selectedRange.start),
        end_date: toISO(selectedRange.end),
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setMessage(data.detail || 'Не удалось создать бронирование')
      return
    }
    setMessage('Бронирование создано')
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

      <div className="grid-2">
        <div className="stack">
          <Calendar role={user.role} value={selectedRange} onChange={pickDate} />
          <div className="card">
            <h3>Выбор периода</h3>
            <div>Текущий выбор: <strong>{myRangeLabel}</strong></div>
            <button onClick={createBooking}>Забронировать выбранное место</button>
            {message && <div className="info">{message}</div>}
          </div>
          <BookingsList title="Мои бронирования" items={myBookings} />
        </div>

        <div className="stack">
          <SpotsGrid spots={spots} selectedSpotId={selectedSpotId} onSelect={setSelectedSpotId} />
          <div className="card">
            <h3>Подсказка</h3>
            <div className="muted">
              Сетка показывает только свободные места для выбранного периода.
              При смене даты список обновляется автоматически.
            </div>
            <button onClick={() => navigate('/menu')}>Открыть меню пользователя</button>
          </div>
        </div>
      </div>

      {user.role === 'admin' && <AdminPanel token={token} />}
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