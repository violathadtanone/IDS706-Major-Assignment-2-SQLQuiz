import os
import psycopg2
from psycopg2 import errors
from dotenv import load_dotenv

# Read database connection information from .env
load_dotenv()

DB_NAME = os.getenv("POSTGRES_DB", "school_database")
DB_USER = os.getenv("POSTGRES_USER", "vscode")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "vscode")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_SSLMODE = os.getenv("DB_SSLMODE", "prefer")


def main():
    print(f"Connecting to {DB_NAME} at {DB_HOST}:{DB_PORT} as {DB_USER} ...")

    conn = psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT,
        sslmode=DB_SSLMODE,
    )

    cur = conn.cursor()

    # --------------------------------------------------
    # READ
    # Show 10 recent meal records
    # --------------------------------------------------

    print("\n10 recent meals:")

    cur.execute("""
        SELECT
            meal_id,
            student_id,
            meal_date,
            meal_item,
            price
        FROM meals
        ORDER BY meal_date DESC, meal_id ASC
        LIMIT 10;
    """)

    for row in cur.fetchall():
        print(row)

    try:

        # --------------------------------------------------
        # CREATE
        # Add a new meal for an existing student
        # --------------------------------------------------

        print("\nInserting a new meal...")

        cur.execute("""
            INSERT INTO meals
                (meal_id, student_id, meal_date, meal_item, price)
            VALUES
                (%s, %s, %s, %s, %s)
            RETURNING
                meal_id,
                student_id,
                meal_date,
                meal_item,
                price;
        """, (
            "M_TEST_001",
            "student_001",
            "2026-10-20",
            "Cheese Pizza",
            4.25
        ))

        print("Inserted:", cur.fetchone())

        # --------------------------------------------------
        # UPDATE
        # Change the meal item and price
        # --------------------------------------------------

        print("\nUpdating M_TEST_001...")

        cur.execute("""
            UPDATE meals
            SET
                meal_item = %s,
                price = %s
            WHERE meal_id = %s
            RETURNING
                meal_id,
                student_id,
                meal_item,
                price;
        """, (
            "Chicken Rice Bowl",
            5.25,
            "M_TEST_001"
        ))

        print("Updated:", cur.fetchone())

        # --------------------------------------------------
        # DELETE
        # Remove the test meal
        # --------------------------------------------------

        print("\nDeleting M_TEST_001...")

        cur.execute("""
            DELETE FROM meals
            WHERE meal_id = %s
            RETURNING
                meal_id,
                student_id,
                meal_item,
                price;
        """, ("M_TEST_001",))

        print("Deleted:", cur.fetchone())

        # Save all changes
        conn.commit()

        print("\nChanges committed.")

    except errors.InsufficientPrivilege as e:

        conn.rollback()

        print(
            "\nWrite blocked by the database:",
            str(e).strip().splitlines()[0]
        )

        print(
            "This connection is read-only, so "
            "INSERT/UPDATE/DELETE are refused and nothing was changed."
        )

    cur.close()
    conn.close()

    print("\nDone.")


if __name__ == "__main__":
    main()