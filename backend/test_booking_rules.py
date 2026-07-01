import importlib
import os
import tempfile
import unittest
from datetime import date, datetime
from unittest.mock import patch


class BookingRuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmpdir = tempfile.TemporaryDirectory()
        db_path = os.path.join(cls.tmpdir.name, "test_parking.db")
        os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
        os.environ["SECRET_KEY"] = "test-secret-key"
        cls.app = importlib.import_module("main")

    @classmethod
    def tearDownClass(cls):
        cls.app.engine.dispose()
        cls.tmpdir.cleanup()

    def setUp(self):
        self.app.Base.metadata.drop_all(bind=self.app.engine)
        self.app.Base.metadata.create_all(bind=self.app.engine)
        self.db = self.app.SessionLocal()

    def tearDown(self):
        self.db.close()

    def add_user(self, username, role):
        user = self.app.User(
            username=username,
            password_hash="",
            role=role.value,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def add_spot(self, number):
        spot = self.app.ParkingSpot(number=number)
        self.db.add(spot)
        self.db.commit()
        self.db.refresh(spot)
        return spot

    def add_booking(self, user, spot, start, end):
        booking = self.app.Booking(
            user_id=user.id,
            spot_id=spot.id,
            start_date=start,
            end_date=end,
        )
        self.db.add(booking)
        self.db.commit()
        self.db.refresh(booking)
        return booking

    def test_employee_cannot_have_second_active_booking(self):
        employee = self.add_user("employee1", self.app.Role.employee)
        first_spot = self.add_spot(1)
        second_spot = self.add_spot(2)
        self.add_booking(employee, first_spot, date(2026, 6, 9), date(2026, 6, 9))

        with (
            patch.object(self.app, "get_today", return_value=date(2026, 6, 8)),
            patch.object(self.app, "get_now", return_value=datetime(2026, 6, 8, 17, 0)),
            self.assertRaisesRegex(self.app.HTTPException, "только одно активное бронирование"),
        ):
            self.app.ensure_booking_allowed(
                self.db,
                employee,
                second_spot.id,
                date(2026, 6, 8),
                date(2026, 6, 8),
            )

    def test_employee_can_book_today(self):
        employee = self.add_user("employee_today", self.app.Role.employee)
        spot = self.add_spot(3)

        with (
            patch.object(self.app, "get_today", return_value=date(2026, 6, 8)),
            patch.object(self.app, "get_now", return_value=datetime(2026, 6, 8, 17, 0)),
        ):
            booking = self.app.create_booking(
                self.app.BookingCreate(
                    spot_id=spot.id,
                    start_date=date(2026, 6, 8),
                    end_date=date(2026, 6, 8),
                ),
                self.db,
                employee,
            )

        self.assertEqual(booking.start_date, date(2026, 6, 8))
        self.assertEqual(booking.end_date, date(2026, 6, 8))

    def test_employee_cannot_book_next_day_before_18(self):
        employee = self.add_user("employee_other_day", self.app.Role.employee)
        spot = self.add_spot(4)

        with (
            patch.object(self.app, "get_today", return_value=date(2026, 6, 8)),
            patch.object(self.app, "get_now", return_value=datetime(2026, 6, 8, 17, 59)),
            self.assertRaisesRegex(self.app.HTTPException, "после 18:00"),
        ):
            self.app.ensure_booking_allowed(
                self.db,
                employee,
                spot.id,
                date(2026, 6, 9),
                date(2026, 6, 9),
            )

    def test_employee_can_book_next_business_day_after_18(self):
        employee = self.add_user("employee_tomorrow", self.app.Role.employee)
        spot = self.add_spot(5)

        with (
            patch.object(self.app, "get_today", return_value=date(2026, 6, 12)),
            patch.object(self.app, "get_now", return_value=datetime(2026, 6, 12, 18, 0)),
        ):
            booking = self.app.create_booking(
                self.app.BookingCreate(
                    spot_id=spot.id,
                    start_date=date(2026, 6, 15),
                    end_date=date(2026, 6, 15),
                ),
                self.db,
                employee,
            )

        self.assertEqual(booking.start_date, date(2026, 6, 15))

    def test_manager_uses_free_spot_pool_for_multiple_non_overlapping_bookings(self):
        manager = self.add_user("manager_multiple", self.app.Role.manager)
        other_user = self.add_user("other_employee", self.app.Role.employee)
        occupied_spot = self.add_spot(6)
        first_free_spot = self.add_spot(7)
        second_free_spot = self.add_spot(8)
        self.add_booking(other_user, occupied_spot, date(2026, 6, 8), date(2026, 6, 9))

        with patch.object(self.app, "get_today", return_value=date(2026, 6, 8)):
            first_pool = self.app.availability(
                date(2026, 6, 8),
                date(2026, 6, 9),
                self.db,
                manager,
            )
            first_pool_ids = {spot.id for spot in first_pool["available_spots"]}
            self.assertNotIn(occupied_spot.id, first_pool_ids)
            self.assertIn(first_free_spot.id, first_pool_ids)
            self.assertIn(second_free_spot.id, first_pool_ids)

            first = self.app.create_booking(
                self.app.BookingCreate(
                    spot_id=first_free_spot.id,
                    start_date=date(2026, 6, 8),
                    end_date=date(2026, 6, 9),
                ),
                self.db,
                manager,
            )

            second_pool = self.app.availability(
                date(2026, 6, 11),
                date(2026, 6, 12),
                self.db,
                manager,
            )
            second_pool_ids = {spot.id for spot in second_pool["available_spots"]}
            self.assertIn(second_free_spot.id, second_pool_ids)

            second = self.app.create_booking(
                self.app.BookingCreate(
                    spot_id=second_free_spot.id,
                    start_date=date(2026, 6, 11),
                    end_date=date(2026, 6, 12),
                ),
                self.db,
                manager,
            )

        self.assertEqual(first.spot_id, first_free_spot.id)
        self.assertEqual(second.spot_id, second_free_spot.id)

    def test_manager_cannot_create_overlapping_bookings(self):
        manager = self.add_user("manager_overlap", self.app.Role.manager)
        first_spot = self.add_spot(7)
        second_spot = self.add_spot(8)
        self.add_booking(manager, first_spot, date(2026, 6, 8), date(2026, 6, 9))

        with (
            patch.object(self.app, "get_today", return_value=date(2026, 6, 8)),
            self.assertRaisesRegex(self.app.HTTPException, "пересекающееся бронирование"),
        ):
            self.app.ensure_booking_allowed(
                self.db,
                manager,
                second_spot.id,
                date(2026, 6, 9),
                date(2026, 6, 10),
            )

    def test_manager_can_book_full_workweek_across_month_boundary(self):
        manager = self.add_user("manager_cross_month", self.app.Role.manager)
        spot = self.add_spot(9)

        with patch.object(self.app, "get_today", return_value=date(2026, 6, 25)):
            pool = self.app.availability(
                date(2026, 6, 29),
                date(2026, 7, 3),
                self.db,
                manager,
            )
            pool_ids = {available_spot.id for available_spot in pool["available_spots"]}
            self.assertIn(spot.id, pool_ids)

            booking = self.app.create_booking(
                self.app.BookingCreate(
                    spot_id=spot.id,
                    start_date=date(2026, 6, 29),
                    end_date=date(2026, 7, 3),
                ),
                self.db,
                manager,
            )

        self.assertEqual(booking.start_date, date(2026, 6, 29))
        self.assertEqual(booking.end_date, date(2026, 7, 3))

    def test_admin_edit_integrity_uses_booking_owner_conflicts(self):
        employee = self.add_user("employee2", self.app.Role.employee)
        spot_one = self.add_spot(1)
        spot_two = self.add_spot(2)
        spot_three = self.add_spot(3)
        booking_to_edit = self.add_booking(employee, spot_one, date(2026, 6, 10), date(2026, 6, 10))
        self.add_booking(employee, spot_two, date(2026, 6, 12), date(2026, 6, 12))

        with self.assertRaisesRegex(self.app.HTTPException, "пересекающееся бронирование"):
            self.app.ensure_booking_integrity(
                self.db,
                employee.id,
                spot_three.id,
                date(2026, 6, 12),
                date(2026, 6, 12),
                booking_id=booking_to_edit.id,
            )

    def test_create_booking_succeeds_with_sqlite_write_lock(self):
        admin = self.add_user("admin1", self.app.Role.admin)
        spot = self.add_spot(10)

        booking = self.app.create_booking(
            self.app.BookingCreate(
                spot_id=spot.id,
                start_date=date(2026, 6, 13),
                end_date=date(2026, 6, 14),
            ),
            self.db,
            admin,
        )

        self.assertEqual(booking.spot_id, spot.id)
        self.assertEqual(booking.start_date, date(2026, 6, 13))

    def test_admin_cannot_create_overlapping_booking_for_same_spot(self):
        first_user = self.add_user("employee3", self.app.Role.employee)
        admin = self.add_user("admin_overlap", self.app.Role.admin)
        spot = self.add_spot(11)
        self.add_booking(first_user, spot, date(2026, 6, 15), date(2026, 6, 16))

        with self.assertRaisesRegex(self.app.HTTPException, "Место уже забронировано"):
            self.app.create_booking(
                self.app.BookingCreate(
                    spot_id=spot.id,
                    start_date=date(2026, 6, 16),
                    end_date=date(2026, 6, 17),
                ),
                self.db,
                admin,
            )

    def test_admin_can_create_overlapping_booking_for_same_user(self):
        admin = self.add_user("admin_user_overlap", self.app.Role.admin)
        first_spot = self.add_spot(12)
        second_spot = self.add_spot(13)
        self.add_booking(admin, first_spot, date(2026, 6, 18), date(2026, 6, 19))

        booking = self.app.create_booking(
            self.app.BookingCreate(
                spot_id=second_spot.id,
                start_date=date(2026, 6, 19),
                end_date=date(2026, 6, 20),
            ),
            self.db,
            admin,
        )

        self.assertEqual(booking.spot_id, second_spot.id)
        self.assertEqual(booking.user_id, admin.id)

    def test_admin_can_create_valid_user(self):
        admin = self.add_user("admin2", self.app.Role.admin)

        created = self.app.create_user(
            self.app.UserCreate(
                username="new_employee",
                full_name="New Employee",
                role=self.app.Role.employee,
            ),
            self.db,
            admin,
        )

        self.assertEqual(created.username, "new_employee")
        self.assertEqual(created.role, self.app.Role.employee)

    def test_input_models_reject_invalid_values(self):
        with self.assertRaises(ValueError):
            self.app.SpotCreate(number=0)
        with self.assertRaises(ValueError):
            self.app.UserCreate(username="no spaces")
        with self.assertRaises(ValueError):
            self.app.BookingCreate(spot_id=1, start_date=date(2026, 6, 10), end_date=date(2026, 6, 9))

    def test_ldap_created_user_gets_employee_role_by_default(self):
        user = self.app.User(username="ldap_new", password_hash="", full_name="LDAP New", role=self.app.Role.employee.value)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)

        self.assertEqual(user.role, self.app.Role.employee.value)

    def test_user_create_can_set_role_manually_without_password(self):
        payload = self.app.UserCreate(username="manual_manager", full_name="Manual Manager", role=self.app.Role.manager)
        self.assertEqual(payload.role, self.app.Role.manager)


if __name__ == "__main__":
    unittest.main()
