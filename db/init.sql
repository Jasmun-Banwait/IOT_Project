-- Database initialization
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  fullname VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
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

CREATE TABLE IF NOT EXISTS class_schedules (
  id SERIAL PRIMARY KEY,
  classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,
  course_name VARCHAR(100) NOT NULL,
  instructor_name VARCHAR(100),
  day_of_week VARCHAR(10) NOT NULL, -- e.g. 'Monday', 'Tuesday'
  start_time TIME NOT NULL,
  end_time TIME NOT NULL
);

CREATE TABLE IF NOT EXISTS seat_occupancy (
  id SERIAL PRIMARY KEY,
  classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,
  seat_id INT REFERENCES seats(id) ON DELETE CASCADE,
  course_name VARCHAR(100),
  date_of_class DATE NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sensor_status VARCHAR(10) NOT NULL, -- 'occupied' or 'empty'                  -- optional, if you have model-based detection
  source VARCHAR(50) DEFAULT 'sensor' -- e.g. 'sensor', 'manual', 'system'
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  seat_id INT REFERENCES seats(id) ON DELETE CASCADE,
  classroom_id INT REFERENCES classrooms(id) ON DELETE CASCADE,
  course_name VARCHAR(100),
  date_of_class DATE NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, seat_id, date_of_class)
);
