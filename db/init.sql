-- Database initialization
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'student'
);

-- 1. Classrooms table
CREATE TABLE IF NOT EXISTS classrooms (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  total_seats INT NOT NULL
);

-- 2. Seats table
CREATE TABLE IF NOT EXISTS seats (
  id SERIAL PRIMARY KEY,
  classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,
  seat_number INT NOT NULL,
  availability VARCHAR(10) DEFAULT 'available',  -- 'available' or 'taken'
  occupant_name VARCHAR(100),
  occupant_email VARCHAR(100),
  UNIQUE (classroom_id, seat_number)
);
