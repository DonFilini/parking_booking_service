from __future__ import annotations

from datetime import date, datetime, timedelta, time
from enum import Enum
from typing import Annotated, Optional, List
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import jwt, JWTError
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from pydantic import BaseModel, ConfigDict
from sqlalchemy import (
    create_engine, String, Integer, Boolean, Date, DateTime, ForeignKey, select, func
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker, Session, Mapped, mapped_column

DATABASE_URL = "sqlite:///./parking.db"
SECRET_KEY = "change-me-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 12
TZ = ZoneInfo("Europe/Amsterdam")

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}, future=True
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
ph = PasswordHasher()

app = FastAPI(title="Office Parking Booking Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Role(str, Enum):
    employee = "employee"
    manager = "manager"
    admin = "admin"


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(128), default="")
    role: Mapped[str] = mapped_column(String(20), default=Role.employee.value)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(TZ))

    bookings: Mapped[list["Booking"]] = relationship(back_populates="user")


class ParkingSpot(Base):
    __tablename__ = "spots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    floor: Mapped[str] = mapped_column(String(32), default="A")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(TZ))

    bookings: Mapped[list["Booking"]] = relationship(back_populates="spot")


class Booking(Base):
    __tablename__ = "bookings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    spot_id: Mapped[int] = mapped_column(ForeignKey("spots.id"), index=True)
    start_date: Mapped[date] = mapped_column(Date, index=True)
    end_date: Mapped[date] = mapped_column(Date, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(TZ))

    user: Mapped[User] = relationship(back_populates="bookings")
    spot: Mapped[ParkingSpot] = relationship(back_populates="bookings")


class UserCreate(BaseModel):
    username: str
    password: str
    full_name: str = ""
    role: Role = Role.employee


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[Role] = None
    active: Optional[bool] = None
    password: Optional[str] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: str
    role: Role
    active: bool
    created_at: datetime


class SpotCreate(BaseModel):
    code: str
    floor: str = "A"
    active: bool = True


class SpotUpdate(BaseModel):
    code: Optional[str] = None
    floor: Optional[str] = None
    active: Optional[bool] = None


class SpotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    floor: str
    active: bool
    created_at: datetime


class BookingCreate(BaseModel):
    spot_id: int
    start_date: date
    end_date: date


class BookingUpdate(BaseModel):
    spot_id: Optional[int] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class BookingOut(BaseModel):
    id: int
    user_id: int
    username: str
    full_name: str
    role: Role
    spot_id: int
    spot_code: str
    start_date: date
    end_date: date
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AvailabilityOut(BaseModel):
    date: date
    available_spots: list[SpotOut]
    booked_spots: list[BookingOut]


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return ph.hash(password)

def verify_password(password: str, hashed: str) -> bool:
    try:
        ph.verify(hashed, password)
        return True
    except VerifyMismatchError:
        return False


def create_token(user: User) -> str:
    expires = datetime.now(TZ) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user.id),
        "exp": expires,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_today() -> date:
    return datetime.now(TZ).date()


def get_now() -> datetime:
    return datetime.now(TZ)


def is_business_day(d: date) -> bool:
    return d.weekday() < 5


def next_business_day(d: date) -> date:
    candidate = d + timedelta(days=1)
    while not is_business_day(candidate):
        candidate += timedelta(days=1)
    return candidate


def business_days_count(start: date, end: date) -> int:
    if end < start:
        return 0
    count = 0
    cur = start
    while cur <= end:
        if is_business_day(cur):
            count += 1
        cur += timedelta(days=1)
    return count


def contains_weekend(start: date, end: date) -> bool:
    cur = start
    while cur <= end:
        if not is_business_day(cur):
            return True
        cur += timedelta(days=1)
    return False


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def week_range(d: date) -> tuple[date, date]:
    start = week_start(d)
    return start, start + timedelta(days=6)


def booking_overlaps(a_start: date, a_end: date, b_start: date, b_end: date) -> bool:
    return a_start <= b_end and b_start <= a_end


def user_to_out(user: User) -> UserOut:
    return UserOut.model_validate(user)


def spot_to_out(spot: ParkingSpot) -> SpotOut:
    return SpotOut.model_validate(spot)


def booking_to_out(booking: Booking) -> BookingOut:
    return BookingOut(
        id=booking.id,
        user_id=booking.user_id,
        username=booking.user.username,
        full_name=booking.user.full_name,
        role=Role(booking.user.role),
        spot_id=booking.spot_id,
        spot_code=booking.spot.code,
        start_date=booking.start_date,
        end_date=booking.end_date,
        created_at=booking.created_at,
    )


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.scalar(select(User).where(User.username == username))


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def get_spot_by_id(db: Session, spot_id: int) -> ParkingSpot | None:
    return db.get(ParkingSpot, spot_id)


def current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise exc
    user = get_user_by_id(db, user_id)
    if not user or not user.active:
        raise exc
    return user


def require_role(*roles: Role):
    def _checker(user: Annotated[User, Depends(current_user)]) -> User:
        if user.role not in {r.value for r in roles}:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return _checker


def ensure_booking_allowed(db: Session, user: User, spot_id: int, start_date: date, end_date: date, booking_id: int | None = None) -> None:
    today = get_today()
    role = Role(user.role)

    if end_date < start_date:
        raise HTTPException(400, "end_date must be >= start_date")

    # Admin may book any date range, including weekends.
    if role != Role.admin:
        if not is_business_day(start_date) or not is_business_day(end_date):
            raise HTTPException(400, "Bookings must start and end on business days")
        if contains_weekend(start_date, end_date):
            raise HTTPException(400, "Booking range must not include weekends")

    spot = get_spot_by_id(db, spot_id)
    if not spot or not spot.active:
        raise HTTPException(400, "Selected spot is unavailable")

    # prevent spot conflicts
    stmt = select(Booking).where(Booking.spot_id == spot_id)
    if booking_id is not None:
        stmt = stmt.where(Booking.id != booking_id)
    existing_spot_bookings = db.scalars(stmt).all()
    for b in existing_spot_bookings:
        if booking_overlaps(start_date, end_date, b.start_date, b.end_date):
            raise HTTPException(400, "Spot is already booked for this period")

    # prevent user conflicts for everyone
    stmt = select(Booking).where(Booking.user_id == user.id)
    if booking_id is not None:
        stmt = stmt.where(Booking.id != booking_id)
    existing_user_bookings = db.scalars(stmt).all()
    for b in existing_user_bookings:
        if booking_overlaps(start_date, end_date, b.start_date, b.end_date):
            raise HTTPException(400, "You already have an overlapping booking")

    if role == Role.employee:
        if get_now().time() < time(18, 0):
            raise HTTPException(403, "Employee booking opens at 18:00")
        expected = next_business_day(today)
        if start_date != expected or end_date != expected:
            raise HTTPException(400, f"Employee can book only for {expected.isoformat()}")
    elif role == Role.manager:
        bd = business_days_count(start_date, end_date)
        if bd < 1 or bd > 5:
            raise HTTPException(400, "Manager booking must be between 1 and 5 business days")
        current_w_start, current_w_end = week_range(today)
        next_w_start = current_w_end + timedelta(days=1)
        next_w_end = next_w_start + timedelta(days=6)
        start_in_current = current_w_start <= start_date <= current_w_end
        start_in_next = next_w_start <= start_date <= next_w_end
        if not (start_in_current or start_in_next):
            raise HTTPException(400, "Manager can book only for current or next week")
        # one booking per week
        week_bookings = db.scalars(select(Booking).where(Booking.user_id == user.id)).all()
        current_has = any(current_w_start <= b.start_date <= current_w_end for b in week_bookings if booking_id is None or b.id != booking_id)
        next_has = any(next_w_start <= b.start_date <= next_w_end for b in week_bookings if booking_id is None or b.id != booking_id)
        if start_in_current and current_has:
            raise HTTPException(400, "Manager already has a booking for the current week")
        if start_in_next and next_has:
            raise HTTPException(400, "Manager already has a booking for the next week")


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    seed_data()


def seed_data():
    db = SessionLocal()
    try:
        if db.scalar(select(func.count(User.id))) == 0:
            users = [
                User(username="admin", password_hash=hash_password("password"), full_name="System Admin", role=Role.admin.value),
                User(username="manager", password_hash=hash_password("password"), full_name="Office Manager", role=Role.manager.value),
                User(username="employee", password_hash=hash_password("password"), full_name="Regular Employee", role=Role.employee.value),
            ]
            db.add_all(users)
        if db.scalar(select(func.count(ParkingSpot.id))) == 0:
            spots = [ParkingSpot(code=f"P-{i:02d}", floor="A" if i <= 15 else "B") for i in range(1, 31)]
            db.add_all(spots)
        db.commit()
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/login", response_model=TokenOut)
def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[Session, Depends(get_db)],
):
    user = get_user_by_username(db, form.username)
    if not user or not user.active or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    token = create_token(user)
    return TokenOut(access_token=token, user=user_to_out(user))


@app.get("/auth/me", response_model=UserOut)
def me(user: Annotated[User, Depends(current_user)]):
    return user_to_out(user)


@app.get("/spots", response_model=list[SpotOut])
def list_spots(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
    include_inactive: bool = False,
):
    q = select(ParkingSpot)
    if not include_inactive:
        q = q.where(ParkingSpot.active == True)  # noqa: E712
    return [spot_to_out(s) for s in db.scalars(q.order_by(ParkingSpot.code)).all()]


@app.get("/availability", response_model=dict)
def availability(
    start: date,
    end: date,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
):
    if end < start:
        raise HTTPException(400, "end must be >= start")
    spots = db.scalars(select(ParkingSpot).where(ParkingSpot.active == True)).all()  # noqa: E712
    bookings = db.scalars(select(Booking).join(Booking.spot).where(ParkingSpot.active == True)).all()  # noqa: E712
    available = []
    booked = []
    for spot in spots:
        conflict = False
        for b in bookings:
            if b.spot_id == spot.id and booking_overlaps(start, end, b.start_date, b.end_date):
                conflict = True
                booked.append(booking_to_out(b))
                break
        if not conflict:
            available.append(spot_to_out(spot))
    return {
        "start": start,
        "end": end,
        "available_spots": available,
        "booked_spots": booked,
    }


@app.get("/bookings/my", response_model=list[BookingOut])
def my_bookings(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
):
    bookings = db.scalars(
        select(Booking).where(Booking.user_id == user.id).order_by(Booking.start_date.desc(), Booking.id.desc())
    ).all()
    return [booking_to_out(b) for b in bookings]


@app.get("/bookings", response_model=list[BookingOut])
def all_bookings(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_role(Role.admin))],
):
    bookings = db.scalars(
        select(Booking).order_by(Booking.start_date.desc(), Booking.id.desc())
    ).all()
    return [booking_to_out(b) for b in bookings]


@app.post("/bookings", response_model=BookingOut)
def create_booking(
    payload: BookingCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
):
    ensure_booking_allowed(db, user, payload.spot_id, payload.start_date, payload.end_date)
    booking = Booking(
        user_id=user.id,
        spot_id=payload.spot_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    db.add(booking)
    db.commit()
    db.refresh(booking)
    return booking_to_out(booking)


@app.patch("/bookings/{booking_id}", response_model=BookingOut)
def update_booking(
    booking_id: int,
    payload: BookingUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_role(Role.admin))],
):
    booking = db.get(Booking, booking_id)
    if not booking:
        raise HTTPException(404, "Booking not found")
    spot_id = payload.spot_id if payload.spot_id is not None else booking.spot_id
    start_date = payload.start_date if payload.start_date is not None else booking.start_date
    end_date = payload.end_date if payload.end_date is not None else booking.end_date
    # Admin may edit any booking; we enforce only non-overlap integrity.
    temp_admin = user
    ensure_booking_allowed(db, temp_admin, spot_id, start_date, end_date, booking_id=booking.id)
    booking.spot_id = spot_id
    booking.start_date = start_date
    booking.end_date = end_date
    db.commit()
    db.refresh(booking)
    return booking_to_out(booking)


@app.delete("/bookings/{booking_id}")
def delete_booking(
    booking_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_role(Role.admin))],
):
    booking = db.get(Booking, booking_id)
    if not booking:
        raise HTTPException(404, "Booking not found")
    db.delete(booking)
    db.commit()
    return {"ok": True}


@app.get("/users", response_model=list[UserOut])
def list_users(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_role(Role.admin))],
):
    users = db.scalars(select(User).order_by(User.id)).all()
    return [user_to_out(u) for u in users]


@app.post("/users", response_model=UserOut)
def create_user(
    payload: UserCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_role(Role.admin))],
):
    if get_user_by_username(db, payload.username):
        raise HTTPException(400, "Username already exists")
    new_user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role.value,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return user_to_out(new_user)


@app.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_role(Role.admin))],
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if payload.full_name is not None:
        target.full_name = payload.full_name
    if payload.role is not None:
        target.role = payload.role.value
    if payload.active is not None:
        target.active = payload.active
    if payload.password:
        target.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(target)
    return user_to_out(target)


@app.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_role(Role.admin))],
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if db.scalar(select(func.count(Booking.id)).where(Booking.user_id == user_id)):
        raise HTTPException(400, "Cannot delete user with bookings; disable the account instead")
    db.delete(target)
    db.commit()
    return {"ok": True}


@app.post("/spots", response_model=SpotOut)
def create_spot(
    payload: SpotCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_role(Role.admin))],
):
    if db.scalar(select(ParkingSpot).where(ParkingSpot.code == payload.code)):
        raise HTTPException(400, "Spot code already exists")
    spot = ParkingSpot(code=payload.code, floor=payload.floor, active=payload.active)
    db.add(spot)
    db.commit()
    db.refresh(spot)
    return spot_to_out(spot)


@app.patch("/spots/{spot_id}", response_model=SpotOut)
def update_spot(
    spot_id: int,
    payload: SpotUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_role(Role.admin))],
):
    spot = db.get(ParkingSpot, spot_id)
    if not spot:
        raise HTTPException(404, "Spot not found")
    if payload.code is not None:
        spot.code = payload.code
    if payload.floor is not None:
        spot.floor = payload.floor
    if payload.active is not None:
        spot.active = payload.active
    db.commit()
    db.refresh(spot)
    return spot_to_out(spot)


@app.delete("/spots/{spot_id}")
def delete_spot(
    spot_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_role(Role.admin))],
):
    spot = db.get(ParkingSpot, spot_id)
    if not spot:
        raise HTTPException(404, "Spot not found")
    if db.scalar(select(func.count(Booking.id)).where(Booking.spot_id == spot_id)):
        raise HTTPException(400, "Cannot delete spot with bookings; disable it instead")
    db.delete(spot)
    db.commit()
    return {"ok": True}


@app.get("/admin/dashboard")
def admin_dashboard(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_role(Role.admin))],
):
    return {
        "users": db.scalar(select(func.count(User.id))),
        "spots": db.scalar(select(func.count(ParkingSpot.id))),
        "bookings": db.scalar(select(func.count(Booking.id))),
        "active_spots": db.scalar(select(func.count(ParkingSpot.id)).where(ParkingSpot.active == True)),  # noqa: E712
    }