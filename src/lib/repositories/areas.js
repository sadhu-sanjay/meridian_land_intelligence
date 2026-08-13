import pool from "@/lib/db";

// Returns [{ value, label }] shaped to match Sidebar's areaOptions prop directly.
export async function getAreas() {
  const result = await pool.query(
    `SELECT id, city_name FROM cities ORDER BY city_name`
  );
  return result.rows.map((row) => ({
    value: row.id,
    label: row.city_name,
  }));
}