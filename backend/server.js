import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";

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
  `);

  // Insert Room A if no classrooms exist
  const result = await pool.query("SELECT COUNT(*) FROM classrooms");
  if (parseInt(result.rows[0].count) === 0) {
    console.log("🌟 Initializing classrooms and seats...");

    await pool.query(`
      INSERT INTO classrooms (name, total_seats)
      VALUES ('Room A', 10), ('Room B', 8);
    `);

    await pool.query(`
      INSERT INTO seats (classroom_id, seat_number)
      SELECT 1, generate_series(1, 10);
    `);

    await pool.query(`
      INSERT INTO seats (classroom_id, seat_number)
      SELECT 2, generate_series(1, 8);
    `);
  }

  console.log("✅ Classroom and seat tables initialized");
};


// Get all seats in a specific classroom
app.get("/api/classrooms/:id/seats", async (req, res) => {
  try {
    const classroomId = parseInt(req.params.id);
    const result = await pool.query(
      "SELECT * FROM seats WHERE classroom_id = $1 ORDER BY seat_number ASC",
      [classroomId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching seats:", err.message);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});

// Reserve a seat
app.post("/api/seats/reserve", async (req, res) => {
  const { classroom_id, seat_number, name, email } = req.body;

  try {
    // Check if seat exists and is available
    const seat = await pool.query(
      "SELECT * FROM seats WHERE classroom_id = $1 AND seat_number = $2",
      [classroom_id, seat_number]
    );

    if (seat.rows.length === 0)
      return res.status(404).json({ message: "Seat not found" });

    if (seat.rows[0].availability === "taken")
      return res.status(400).json({ message: "Seat already taken" });

    // Update the seat record
    await pool.query(
      `UPDATE seats
       SET availability = 'taken',
           occupant_name = $1,
           occupant_email = $2
       WHERE classroom_id = $3 AND seat_number = $4`,
      [name, email, classroom_id, seat_number]
    );

    res.json({ message: `Seat ${seat_number} reserved successfully.` });
  } catch (err) {
    console.error("❌ Error reserving seat:", err.message);
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
      console.error("❌ DB Error:", err);
      res.status(500).json({ message: "Database error", error: err.message });
    }
  }
});

// Login endpoint
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: "Missing email or password" });

  try {
    // Look for user in the database
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

    if (result.rows.length === 0)
      return res.status(404).json({ message: "User not found" });

    const user = result.rows[0];

    // (For now, compare plain text. We'll hash later with bcrypt.)
    if (user.password !== password)
      return res.status(401).json({ message: "Invalid credentials" });

    // Success → send confirmation
    res.json({ message: "Login successful", user });
  } catch (err) {
    console.error("❌ Login error:", err.message);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});

app.listen(process.env.PORT || 3000, "0.0.0.0", async () => {
  await initDB();
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});

