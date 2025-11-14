import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";
import cron from "node-cron";
dotenv.config();
const { Pool } = pg;

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

const app = express();
app.use(cors());
app.use(express.json());

// Create table if not exists

const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS classrooms (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      total_seats INT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seats (
      id SERIAL PRIMARY KEY,
      classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,
      seat_number INT NOT NULL,
      availability VARCHAR(10) DEFAULT 'available',
      occupant_name VARCHAR(100),
      occupant_email VARCHAR(100),
      UNIQUE (classroom_id, seat_number)
    );
    CREATE TABLE IF NOT EXISTS class_schedules (
      id SERIAL PRIMARY KEY,
      classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,
      course_name VARCHAR(100) NOT NULL,
      instructor_name VARCHAR(100),
      day_of_week VARCHAR(10) NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL
  );

    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      seat_id INT REFERENCES seats(id) ON DELETE CASCADE,
      classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,
      occupant_name VARCHAR(100),
      occupant_email VARCHAR(100),
      reservation_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL
    );
  `);

  // Insert Room A if no classrooms exist
  const result = await pool.query("SELECT COUNT(*) FROM classrooms");
  if (parseInt(result.rows[0].count) === 0) {
    console.log("Initializing classrooms and seats...");

    await pool.query(`
      INSERT INTO classrooms (name, total_seats)
      VALUES ('Room A', 30);
    `);

    await pool.query(`
      INSERT INTO seats (classroom_id, seat_number)
      SELECT 1, generate_series(1, 30);
    `);

    
    await pool.query(`
      INSERT INTO class_schedules (classroom_id, course_name, instructor_name, day_of_week, start_time, end_time)
      VALUES
      (1, 'ECE1528 Internet of Things - From Protocols to Applications ', 'Dr. Jorg Liebeherr ', 'Monday', '17:30', '20:30')
      
      
      ON CONFLICT DO NOTHING;
`);
  }

  console.log("Classroom and seat tables initialized");
};


// Get all seats in a specific classroom
app.post("/api/seats/reserve", async (req, res) => {
  const {
    classroom_id,
    seat_number,
    name,
    email,
    reservation_date,
    start_time,
    end_time,
    course_name,
  } = req.body;

  try {
    // 1️⃣ Determine day of the week from reservation date
    const dayOfWeekResult = await pool.query(
      `SELECT TRIM(TO_CHAR($1::date, 'Day')) AS day`,
      [reservation_date]
    );
    const dayOfWeek = dayOfWeekResult.rows[0].day;

    // 2️⃣ Validate that a class is scheduled
    const schedule = await pool.query(
      `SELECT * FROM class_schedules
       WHERE classroom_id = $1
       AND day_of_week = $2
       AND course_name = $3
       AND start_time <= $4::time
       AND end_time >= $5::time`,
      [classroom_id, dayOfWeek, course_name, start_time, end_time]
    );

    if (schedule.rows.length === 0) {
      return res.status(400).json({
        message: "No scheduled class found for this course, classroom, and time.",
      });
    }

    // 3️⃣ Check if user already has a seat
    const existingSeat = await pool.query(
      "SELECT * FROM seats WHERE occupant_email = $1 AND availability = 'taken'",
      [email]
    );

    if (existingSeat.rows.length > 0) {
      const s = existingSeat.rows[0];
      return res.status(400).json({
        message: `You already reserved Seat ${s.seat_number} in Classroom ${s.classroom_id}. Only one reservation is allowed per user.`,
      });
    }

    // 4️⃣ Verify seat availability
    const seat = await pool.query(
      "SELECT * FROM seats WHERE classroom_id = $1 AND seat_number = $2",
      [classroom_id, seat_number]
    );

    if (seat.rows.length === 0)
      return res.status(404).json({ message: "Seat not found." });

    if (seat.rows[0].availability === "taken")
      return res.status(400).json({ message: "Seat already taken." });

    // 5️⃣ Reserve seat
    await pool.query(
      `UPDATE seats
       SET availability = 'taken',
           occupant_name = $1,
           occupant_email = $2
       WHERE classroom_id = $3 AND seat_number = $4`,
      [name, email, classroom_id, seat_number]
    );

    // 6️⃣ Record reservation
    await pool.query(
      `INSERT INTO reservations
       (seat_id, classroom_id, occupant_name, occupant_email, reservation_date, start_time, end_time)
       VALUES (
         (SELECT id FROM seats WHERE classroom_id = $1 AND seat_number = $2),
         $1, $3, $4, $5, $6, $7
       )`,
      [classroom_id, seat_number, name, email, reservation_date, start_time, end_time]
    );

    // 7️⃣ Automatically record attendance if reservation is for "today" during an active class
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    if (reservation_date === today) {
      const currentTime = now.toTimeString().split(" ")[0]; // HH:MM:SS

      const isDuringClass = await pool.query(
        `SELECT * FROM class_schedules
         WHERE classroom_id = $1
         AND course_name = $2
         AND start_time <= $3::time
         AND end_time >= $3::time`,
        [classroom_id, course_name, currentTime]
      );

      if (isDuringClass.rows.length > 0) {
        await pool.query(
          `INSERT INTO attendance (user_id, seat_id, classroom_id, course_name, date_of_class)
           VALUES (
             (SELECT id FROM users WHERE email = $1),
             (SELECT id FROM seats WHERE classroom_id = $2 AND seat_number = $3),
             $2, $4, $5
           )
           ON CONFLICT (user_id, seat_id, date_of_class) DO NOTHING`,
          [email, classroom_id, seat_number, course_name, today]
        );

        console.log(`Attendance marked for ${email} in ${course_name}`);
      }
    }

    res.json({
      message: `Seat ${seat_number} reserved successfully for ${course_name} on ${reservation_date} (${start_time} - ${end_time}).`,
    });
  } catch (err) {
    console.error("Reservation error:", err.message);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});



// Fetch seats with reservation info for a given date
app.get("/api/classrooms/:id/seats/:date", async (req, res) => {
  const { id, date } = req.params;

  try {
    const seatData = await pool.query(
      `SELECT s.id, s.seat_number,
              CASE WHEN r.id IS NOT NULL THEN 'taken' ELSE 'available' END AS availability,
              r.occupant_name, r.occupant_email
       FROM seats s
       LEFT JOIN reservations r
         ON s.id = r.seat_id AND r.reservation_date = $2
       WHERE s.classroom_id = $1
       ORDER BY s.seat_number`,
      [id, date]
    );

    res.json(seatData.rows);
  } catch (err) {
    console.error("Error fetching seats by date:", err.message);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});





// Registration endpoint
app.post("/api/auth/register", async (req, res) => {
  const { fullname, email, password } = req.body;

  if (!fullname || !email || !password) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    await pool.query(
      "INSERT INTO users (fullname, email, password) VALUES ($1, $2, $3)",
      [fullname, email, password]
    );
    res.json({ message: "Registration successful" });
  } catch (err) {
    if (err.code === "23505") {
      res.status(400).json({ message: "Email already registered" });
    } else {
      console.error("DB Error:", err);
      res.status(500).json({ message: "Database error", error: err.message });
    }
  }
});

// Login endpoint with attendance integration
app.post("/api/auth/login", async (req, res) => {
  const { email, password, seat_id } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: "Missing email or password" });

  try {
    // 1️⃣ Verify user credentials
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0)
      return res.status(404).json({ message: "User not found" });

    const user = result.rows[0];

    if (user.password !== password)
      return res.status(401).json({ message: "Invalid credentials" });

    console.log(`User ${user.email} logged in.`);

    // 2️⃣ If login came from QR scan (seat_id exists), record attendance
    if (seat_id) {
      try {
        const seatRes = await pool.query("SELECT classroom_id FROM seats WHERE id = $1", [seat_id]);
        if (seatRes.rows.length > 0) {
          const classroomId = seatRes.rows[0].classroom_id;

          const now = new Date();
          const currentDay = now.toLocaleString("en-US", { weekday: "long" });
          const currentTime = now.toTimeString().split(" ")[0]; // HH:MM:SS

          // Check if there's an active class in that room
          const classRes = await pool.query(
            `SELECT course_name FROM class_schedules
             WHERE classroom_id = $1
             AND day_of_week = $2
             AND start_time <= $3::time
             AND end_time >= $3::time`,
            [classroomId, currentDay, currentTime]
          );

          if (classRes.rows.length > 0) {
            const courseName = classRes.rows[0].course_name;
            const today = now.toISOString().split("T")[0];

            // Insert attendance (ignore duplicates for same day)
            await pool.query(
              `INSERT INTO attendance (user_id, seat_id, classroom_id, course_name, date_of_class)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (user_id, seat_id, date_of_class) DO NOTHING`,
              [user.id, seat_id, classroomId, courseName, today]
            );

            console.log(`Attendance recorded for ${user.email} at seat ${seat_id}`);
          } else {
            console.log(`No active class found for seat ${seat_id} at this time.`);
          }
        } else {
          console.log(`Seat ${seat_id} not found.`);
        }
      } catch (err) {
        console.error("Attendance error:", err.message);
      }
    }

    // 3️⃣ Send standard login response
    res.json({ message: "Login successful", user });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});


app.get("/api/classrooms/:id/schedule", async (req, res) => {
  const classroomId = parseInt(req.params.id);
  try {
    const result = await pool.query(
      "SELECT * FROM class_schedules WHERE classroom_id = $1 ORDER BY day_of_week, start_time",
      [classroomId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Schedule fetch error:", err.message);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});


app.post("/api/seat/update", async (req, res) => {
  const { classroom_id, seat_number, course_name, date_of_class, sensor_status } = req.body;

  try {
    const seatResult = await pool.query(
      "SELECT id FROM seats WHERE classroom_id = $1 AND seat_number = $2",
      [classroom_id, seat_number]
    );
    if (seatResult.rows.length === 0) {
      return res.status(404).json({ message: "Seat not found in this classroom." });
    }
    const seat_id = seatResult.rows[0].id;

    // Log occupancy (no schedule validation here, since you said sensors only send during class)
    await pool.query(
      `INSERT INTO seat_occupancy
       (classroom_id, seat_id, course_name, date_of_class, sensor_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [classroom_id, seat_id, course_name, date_of_class, sensor_status]
    );

    // Update live state for dashboard
    await pool.query(
      `UPDATE seats
       SET availability = $1
       WHERE classroom_id = $2 AND seat_number = $3`,
      [sensor_status === "occupied" ? "taken" : "available", classroom_id, seat_number]
    );

    res.json({ message: "Seat occupancy recorded successfully." });
  } catch (err) {
    console.error("Error updating seat:", err.message);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});




// Clears seat reservations and availability after classes end
async function clearSeatsAfterClasses() {
  const now = new Date();
  const currentDay = now.toLocaleString("en-US", { weekday: "long" });
  const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

  try {
    // Classrooms with no active class at this moment
    const classroomsToClear = await pool.query(
      `
      SELECT c.id AS classroom_id
      FROM classrooms c
      WHERE NOT EXISTS (
        SELECT 1
        FROM class_schedules s
        WHERE s.classroom_id = c.id
          AND s.day_of_week = $1
          AND s.start_time <= $2::time
          AND s.end_time >= $2::time
      )
      `,
      [currentDay, currentTime]
    );

    for (const row of classroomsToClear.rows) {
      await pool.query(
        `UPDATE seats
         SET availability = 'available',
             occupant_name = NULL,
             occupant_email = NULL
         WHERE classroom_id = $1`,
        [row.classroom_id]
      );

      await pool.query(
        `DELETE FROM reservations
         WHERE classroom_id = $1`,
        [row.classroom_id]
      );

      console.log(`Cleared seats and reservations for classroom ${row.classroom_id}`);
    }
  } catch (err) {
    console.error("Error clearing seats after classes:", err.message);
  }
}

app.get("/api/classrooms/:id/seats", async (req, res) => {
  const classroomId = parseInt(req.params.id);
  try {
    const result = await pool.query(
      "SELECT * FROM seats WHERE classroom_id = $1 ORDER BY seat_number",
      [classroomId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching seats:", err.message);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});

app.post("/api/attendance", async (req, res) => {
  const { email, seat_id } = req.body;

  try {
    const userRes = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userRes.rows.length === 0)
      return res.status(404).json({ message: "User not found" });

    const user = userRes.rows[0];
    const seatRes = await pool.query("SELECT classroom_id FROM seats WHERE id = $1", [seat_id]);
    if (seatRes.rows.length === 0)
      return res.status(404).json({ message: "Seat not found" });

    const classroomId = seatRes.rows[0].classroom_id;
    const now = new Date();
    const currentDay = now.toLocaleString("en-US", { weekday: "long" });
    const currentTime = now.toTimeString().split(" ")[0];

    const classRes = await pool.query(
      `SELECT course_name FROM class_schedules
       WHERE classroom_id = $1
       AND day_of_week = $2
       AND start_time <= $3::time
       AND end_time >= $3::time`,
      [classroomId, currentDay, currentTime]
    );

    if (classRes.rows.length === 0)
      return res.status(400).json({ message: "No active class right now." });

    const courseName = classRes.rows[0].course_name;
    const today = now.toISOString().split("T")[0];

    await pool.query(
      `INSERT INTO attendance (user_id, seat_id, classroom_id, course_name, date_of_class)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, seat_id, date_of_class) DO NOTHING`,
      [user.id, seat_id, classroomId, courseName, today]
    );

    res.json({ message: "Attendance recorded", seat_id, courseName });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});




app.listen(process.env.PORT || 3000, "0.0.0.0", async () => {
  await initDB();
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});
// Run every 5 minutes
cron.schedule("*/5 * * * *", () => {
  clearSeatsAfterClasses();
});

