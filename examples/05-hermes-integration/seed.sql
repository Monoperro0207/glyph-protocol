-- Seed data for the SQL tool. Loaded into an in-memory SQLite at server start.
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  signup_date TEXT
);
INSERT INTO customers (id, name, email, signup_date) VALUES
  (1, 'Alice Chen',  'alice@example.com',  '2025-01-15'),
  (2, 'Bob Patel',   'bob@example.com',    '2025-02-03'),
  (3, 'Carla Diaz',  'carla@example.com',  '2025-03-22');

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL
);
INSERT INTO orders (id, customer_id, amount_cents, status) VALUES
  (101, 1, 4999,  'paid'),
  (102, 1, 12500, 'paid'),
  (103, 2,  799,  'refunded'),
  (104, 3, 3200,  'paid');
